"""
Construct Agent API — FastAPI server

Exposes the ChromaDB-backed semantic memory AND the autonomous agent
execution system over HTTP so the Tauri/Rust backend can call them
via REST.

Autonomous mode endpoints (new):
    POST /autonomous/start      — Start background worker
    POST /autonomous/stop       — Stop background worker
    GET  /autonomous/status     — Get worker status + current goal + queue
    POST /autonomous/pause      — Pause worker
    POST /autonomous/resume     — Resume worker
    POST /autonomous/goal       — Add a goal to the queue
    GET  /autonomous/goals      — List all goals in queue
    POST /autonomous/checkpoint/{session_id}  — Force save checkpoint
    GET  /autonomous/checkpoints              — List available checkpoints
    GET  /autonomous/checkpoints/{session_id} — Load checkpoint

Notification endpoints (new):
    POST /notifications         — Send a test notification
    GET  /notifications/recent  — Get recent notifications

Run with:
    uvicorn app:app --host 127.0.0.1 --port 8000 --reload
"""

from __future__ import annotations

import os
import sys
import json
import time
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Sidecar configuration (set by Rust parent process)
# ---------------------------------------------------------------------------

PORT = int(os.getenv("CONSTRUCT_PORT", "8000"))
DATA_DIR = os.getenv("CONSTRUCT_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
LOG_LEVEL = os.getenv("CONSTRUCT_LOG_LEVEL", "info")

# Ensure data directory exists
os.makedirs(DATA_DIR, exist_ok=True)

# Override ChromaDB persistence path
os.environ["CHROMA_PERSIST_DIRECTORY"] = os.path.join(DATA_DIR, "chroma")

# Override any hardcoded paths
CHROMA_PERSIST_PATH = os.path.join(DATA_DIR, "chroma")
CHECKPOINT_PATH = os.path.join(DATA_DIR, "checkpoints")
os.makedirs(CHECKPOINT_PATH, exist_ok=True)

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper()),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(DATA_DIR, "backend.log")),
    ],
)

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
import time
from collections import defaultdict


class RateLimiter:
    """Simple in-memory rate limiter per client IP."""

    def __init__(self, requests_per_minute: int = 60) -> None:
        self.requests_per_minute = requests_per_minute
        # Map: client_ip -> list of timestamps
        self._requests: defaultdict[str, list[float]] = defaultdict(list)

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        window_start = now - 60.0
        # Keep only requests within the last minute
        self._requests[client_ip] = [
            ts for ts in self._requests[client_ip] if ts > window_start
        ]
        if len(self._requests[client_ip]) >= self.requests_per_minute:
            return False
        self._requests[client_ip].append(now)
        return True


# Global rate limiter: 60 requests per minute per IP
_rate_limiter = RateLimiter(requests_per_minute=60)


async def rate_limit_middleware(request: Request, call_next):
    """FastAPI middleware to enforce rate limiting."""
    client_ip = request.client.host if request.client else "unknown"
    if not _rate_limiter.is_allowed(client_ip):
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded. Try again later."},
        )
    return await call_next(request)

from memory import (
    store_conversation_message,
    store_code_event,
    query_similar,
    query_conversations,
    query_code_events,
    get_collection_stats,
    get_recent_memories,
    delete_memory,
    hybrid_search,
    SearchResult,
)

# ---------------------------------------------------------------------------
# Logging (already configured in sidecar config section above)
# ---------------------------------------------------------------------------
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MEMORY_API_HOST = os.environ.get("MEMORY_API_HOST", "127.0.0.1")
MEMORY_API_PORT = PORT  # Set by CONSTRUCT_PORT env var in sidecar config above

# ---------------------------------------------------------------------------
# Global service references (initialised in lifespan)
# ---------------------------------------------------------------------------
_llm_service = None
_tool_registry = None
_agent_executor = None
_session_store = None

# Multi-agent orchestrator
_orchestrator: Optional[Any] = None

# Autonomous mode services
_background_worker: Optional[Any] = None
_checkpoint_manager: Optional[Any] = None
_safety_monitor: Optional[Any] = None
_resource_monitor: Optional[Any] = None
_notification_service: Optional[Any] = None


# ---------------------------------------------------------------------------
# Lifespan — warm up embedding model + init agent + autonomous services
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Construct Agent API starting up …")

    # NOTE: Embedding model is now lazy-loaded on first use to prevent
    # OOM crashes when ChromaDB + Ollama + sentence-transformers all
    # compete for memory at startup.  The model will be loaded
    # automatically when the first semantic search or store is performed.
    # Set CONSTRUCT_OFFLINE=1 to disable embeddings entirely.
    logger.info(
        "Embedding model: lazy-loaded (will load on first use). "
        "Set CONSTRUCT_OFFLINE=1 to disable."
    )

    # Initialise agent services
    global _llm_service, _tool_registry, _agent_executor, _session_store
    global _background_worker, _checkpoint_manager, _safety_monitor
    global _resource_monitor, _notification_service

    from core.llm_service import LLMService
    from tools import ToolRegistry
    from core.executor import AgentExecutor, MemoryClient
    from core.agent_session import SessionStore

    # Core agent
    _llm_service = LLMService()
    _tool_registry = ToolRegistry()
    _memory_client = MemoryClient(enabled=True)
    _agent_executor = AgentExecutor(
        llm_service=_llm_service,
        tool_registry=_tool_registry,
        memory_client=_memory_client,
    )
    _session_store = SessionStore()

    logger.info(
        "Agent services initialised. Available tools: %s",
        ", ".join(_tool_registry.get_tool_names()),
    )
    logger.info(
        "Configured LLM providers: %s",
        ", ".join(p.value for p in _llm_service.configs.keys()),
    )

    # Autonomous services
    from core.checkpoint import CheckpointManager
    from core.safety import SafetyMonitor, SafetySettings
    from core.notifications import NotificationService
    from core.background_worker import (
        BackgroundWorker, ResourceMonitor, GoalPriority,
    )

    _checkpoint_manager = CheckpointManager()
    _safety_monitor = SafetyMonitor(settings=SafetySettings())
    _resource_monitor = ResourceMonitor(
        max_cpu_percent=float(os.environ.get("AGENT_MAX_CPU", "30.0")),
        max_memory_mb=float(os.environ.get("AGENT_MAX_MEMORY", "2048.0")),
    )
    _notification_service = NotificationService(
        tauri_port=int(os.environ.get("TAURI_PORT", "3000")),
    )
    _background_worker = BackgroundWorker(
        agent_executor=_agent_executor,
        checkpoint_manager=_checkpoint_manager,
        safety_monitor=_safety_monitor,
        resource_monitor=_resource_monitor,
        notification_service=_notification_service,
    )

    logger.info(
        "Autonomous services initialised (safety=%s, resources=cpu:%s%%/mem:%sMB)",
        _safety_monitor.settings.require_approval_for,
        _resource_monitor.max_cpu,
        _resource_monitor.max_memory,
    )

    yield

    # Shutdown
    logger.info("Shutting down autonomous worker …")
    if _background_worker is not None:
        try:
            await asyncio.wait_for(_background_worker.stop(), timeout=15.0)
        except Exception:
            pass

    # Shutdown MCP connections
    logger.info("Shutting down MCP connections …")
    if _tool_registry is not None:
        try:
            manager = _tool_registry._get_mcp_manager()
            await manager.disconnect_all()
        except Exception:
            pass

    logger.info("Closing LLM service connections...")
    if _llm_service is not None:
        try:
            asyncio.create_task(_llm_service.close())
        except Exception:
            pass
    logger.info("Construct Agent API shut down.")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Construct Agent API",
    description="Autonomous AI agent with vector-backed semantic memory",
    version="0.3.0",
    lifespan=lifespan,
)

# CORS — allow Tauri frontend / local dev origins only
# SECURITY: restrict to known origins; do NOT use "*" in production
_cors_origins = [
    "http://localhost:5173",   # Tauri dev server
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "tauri://localhost",
]

# Allow additional origins from environment (for custom setups)
_extra_origins = os.environ.get("CORS_EXTRA_ORIGINS", "")
if _extra_origins:
    _cors_origins.extend(o.strip() for o in _extra_origins.split(",") if o.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],  # Explicit method list
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],  # Explicit headers
)

# Add rate limiting middleware
app.middleware("http")(rate_limit_middleware)


# ===========================================================================
# Pydantic request / response models — Memory
# ===========================================================================

class StoreMessageRequest(BaseModel):
    role: str = Field(..., description="Speaker role — user or assistant")
    content: str = Field(..., description="Message body")
    conversation_id: Optional[str] = Field(
        None, description="Optional conversation thread UUID"
    )


class StoreCodeEventRequest(BaseModel):
    file_path: str = Field(..., description="Path of the affected file")
    change_type: str = Field(
        ..., description="One of: create, modify, delete, rename"
    )
    summary: str = Field(..., description="Human-readable change description")
    diff: Optional[str] = Field(None, description="Optional diff/patch text")


class QueryRequest(BaseModel):
    query: str = Field(..., description="Search query text")
    source: Optional[str] = Field(None, description="Filter by source")
    n_results: int = Field(5, ge=1, le=50, description="Number of results")


class HybridQueryRequest(BaseModel):
    query: str = Field(..., description="Search query text")
    sqlite_results: List[dict] = Field(
        default_factory=list,
        description="SQLite full-text search results for fusion",
    )
    n_results: int = Field(5, ge=1, le=50, description="Number of results")


class SearchResultItem(BaseModel):
    id: str
    text: str
    source: str
    distance: float
    metadata: dict
    relevance_score: float


class StatsResponse(BaseModel):
    total_memories: int
    collections: dict
    chroma_path: str
    embedding_model: str
    version: str


class MessageResponse(BaseModel):
    memory_id: str
    status: str = "stored"


# ===========================================================================
# Pydantic request / response models — Agent
# ===========================================================================

class StartAgentRequest(BaseModel):
    goal: str = Field(..., description="The agent's goal or task description")
    project_path: str = Field(
        ".", description="Path to the project directory"
    )
    mode: str = Field(
        "code",
        description=(
            "Agent mode: code, architect, debug, review, security, devops. "
            "Each mode configures system prompt, available tools, verification "
            "strategy, and iteration limits."
        ),
    )


class StartAgentResponse(BaseModel):
    session_id: str
    goal: str
    status: str
    mode: str
    message: str


class SessionStatusResponse(BaseModel):
    session_id: str
    goal: str
    status: str
    tasks: list
    task_summary: dict
    current_task_index: int
    project_path: str
    updated_at: float


class ControlResponse(BaseModel):
    session_id: str
    action: str
    status: str
    message: str


class OutputResponse(BaseModel):
    session_id: str
    events: List[dict]
    has_more: bool


class SessionsListResponse(BaseModel):
    sessions: List[dict]
    total: int


class ToolExecuteRequest(BaseModel):
    tool_name: str = Field(..., description="Name of the tool to execute")
    arguments: dict = Field(
        default_factory=dict, description="Tool arguments as a JSON object"
    )


class ToolExecuteResponse(BaseModel):
    tool_name: str
    result: dict


# ===========================================================================
# Pydantic request / response models — Autonomous
# ===========================================================================

class AutonomousStartRequest(BaseModel):
    immediate_goal: Optional[str] = Field(
        None, description="Optional goal to start working on immediately"
    )
    project_path: str = Field(".", description="Project path for immediate goal")


class AutonomousGoalRequest(BaseModel):
    description: str = Field(..., description="Goal description")
    priority: str = Field("normal", description="One of: critical, high, normal, low")
    deadline: Optional[float] = Field(
        None, description="Unix timestamp deadline (optional)"
    )
    project_path: str = Field(".", description="Path to the project directory")


class AutonomousControlResponse(BaseModel):
    action: str
    status: str
    message: str
    worker_status: Optional[dict] = None


class WorkerStatusResponse(BaseModel):
    status: str
    current_goal: Optional[dict]
    queue_size: int
    goals_completed: int
    goals_failed: int
    error_retries: int


class GoalListResponse(BaseModel):
    goals: List[dict]
    total: int


class CheckpointListResponse(BaseModel):
    checkpoints: List[dict]
    total: int


class CheckpointLoadResponse(BaseModel):
    session_id: str
    goal: str
    status: str
    task_count: int
    saved_at: float
    tasks: List[dict]


# ===========================================================================
# Pydantic request / response models — Notifications
# ===========================================================================

class SendNotificationRequest(BaseModel):
    title: str = Field(..., description="Notification title")
    body: str = Field(..., description="Notification body text")
    actions: List[str] = Field(default_factory=list, description="Action buttons")
    urgency: str = Field("normal", description="One of: low, normal, critical")


class NotificationListResponse(BaseModel):
    notifications: List[dict]
    total: int


# ===========================================================================
# Pydantic request / response models — Context Compression
# ===========================================================================

class CompactContextRequest(BaseModel):
    session_id: str = Field(..., description="Session ID whose context should be compacted")
    max_tokens: int = Field(4096, ge=256, le=16384, description="Target max token count")
    strategy: str = Field("summary", description="One of: summary, truncate, archive")


class CompactContextResponse(BaseModel):
    session_id: str
    original_messages: int
    compacted_messages: int
    strategy: str
    tokens_saved: int


class ContextStatsResponse(BaseModel):
    session_id: str
    total_messages: int
    total_tokens: int
    context_window_used: float  # 0.0 - 1.0
    strategies_available: List[str]


# ===========================================================================
# Pydantic request / response models — Skill Installer
# ===========================================================================

class InstallSkillGithubRequest(BaseModel):
    owner: str = Field(..., description="GitHub repository owner/organisation")
    repo: str = Field(..., description="GitHub repository name")
    skill_name: Optional[str] = Field(None, description="Override skill name (defaults to repo name)")
    branch: str = Field("main", description="Git branch to install from")


class InstallSkillUrlRequest(BaseModel):
    url: str = Field(..., description="URL to the skill package (zip / tar.gz)")
    skill_name: Optional[str] = Field(None, description="Override skill name")


class SkillResponse(BaseModel):
    name: str
    version: str
    description: str
    installed_at: float
    source: str
    status: str  # active | disabled | error


class SkillListResponse(BaseModel):
    skills: List[SkillResponse]
    total: int


class SkillSearchResponse(BaseModel):
    results: List[dict]
    total: int
    query: str


# ===========================================================================
# Pydantic request / response models — LLM Metrics
# ===========================================================================

class LLMMetricsResponse(BaseModel):
    tokens_per_second: float
    avg_latency_ms: float
    buffer_efficiency: float
    active_streams: int
    total_tokens: int
    total_batches: int


# ===========================================================================
# Pydantic request / response models — Thinking Mode
# ===========================================================================

class ThinkingModeRequest(BaseModel):
    session_id: str = Field(..., description="Session ID to configure")
    enabled: bool = Field(True, description="Enable or disable deep thinking mode")
    depth: str = Field("standard", description="One of: light, standard, deep")


class ThinkingModeResponse(BaseModel):
    session_id: str
    thinking_enabled: bool
    depth: str
    message: str


# ===========================================================================
# Pydantic request / response models — Agent Event
# ===========================================================================

class AgentEventResponse(BaseModel):
    session_id: str
    type: str
    content: str
    timestamp: int


# ===========================================================================
# Health check
# ===========================================================================

@app.get("/health")
async def health() -> dict:
    """Health check endpoint."""
    providers = []
    if _llm_service is not None:
        providers = [p.value for p in _llm_service.configs.keys()]

    worker_status = None
    if _background_worker is not None:
        worker_status = _background_worker.get_status()

    # Determine if at least one LLM provider is actually reachable
    llm_ready = False
    if _llm_service is not None:
        from core.llm_service import LLMProvider
        # Check if Ollama (the default fallback) is reachable
        ollama_config = _llm_service.configs.get(LLMProvider.OLLAMA)
        if ollama_config:
            try:
                import aiohttp
                async with aiohttp.ClientSession() as sess:
                    async with sess.get(
                        f"{ollama_config.base_url}/api/tags",
                        timeout=aiohttp.ClientTimeout(total=2),
                    ) as resp:
                        llm_ready = resp.status == 200
            except Exception:
                # Ollama not reachable — check if any cloud provider is configured
                cloud_providers = [
                    p for p in _llm_service.configs
                    if p.value in ("openai", "anthropic", "google")
                ]
                llm_ready = len(cloud_providers) > 0

    # Check sandbox availability
    sandbox_info = {"available": False, "mode": "direct_unsafe"}
    try:
        from core.sandbox import DockerSandbox
        docker_available = DockerSandbox.is_available()
        sandbox_info = {
            "docker_available": docker_available,
            "mode": "docker" if docker_available else "process_fallback",
        }
    except Exception:
        pass

    return {
        "status": "ok",
        "service": "construct-agent-api",
        "version": "0.3.0",
        "llm_ready": llm_ready,
        "llm_providers": providers,
        "memory": _agent_executor.memory.get_stats() if _agent_executor else {"enabled": False},
        "sandbox": sandbox_info,
        "autonomous": {
            "available": _background_worker is not None,
            "worker_status": worker_status,
        },
    }


# ===========================================================================
# Memory Endpoints
# ===========================================================================

@app.post("/memory/message", response_model=MessageResponse)
async def api_store_message(req: StoreMessageRequest) -> dict:
    """Store a conversation message."""
    try:
        mid = store_conversation_message(
            role=req.role,
            content=req.content,
            conversation_id=req.conversation_id,
        )
        return {"memory_id": mid, "status": "stored"}
    except Exception as exc:
        logger.error("Failed to store message: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/memory/code", response_model=MessageResponse)
async def api_store_code_event(req: StoreCodeEventRequest) -> dict:
    """Store a code event."""
    try:
        mid = store_code_event(
            file_path=req.file_path,
            change_type=req.change_type,
            summary=req.summary,
            diff=req.diff,
        )
        return {"memory_id": mid, "status": "stored"}
    except Exception as exc:
        logger.error("Failed to store code event: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/memory/query", response_model=List[SearchResultItem])
async def api_query_similar(req: QueryRequest) -> List[dict]:
    """Semantic search across all collections."""
    try:
        results = query_similar(
            query_text=req.query,
            source_filter=req.source,
            n_results=req.n_results,
        )
        return [
            {
                "id": r.id,
                "text": r.text,
                "source": r.source,
                "distance": r.distance,
                "metadata": r.metadata,
                "relevance_score": r.relevance_score,
            }
            for r in results
        ]
    except Exception as exc:
        logger.error("Query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/memory/query/conversations", response_model=List[SearchResultItem])
async def api_query_conversations(req: QueryRequest) -> List[dict]:
    """Semantic search restricted to the conversation collection."""
    try:
        results = query_conversations(
            query_text=req.query,
            n_results=req.n_results,
        )
        return [
            {
                "id": r.id,
                "text": r.text,
                "source": r.source,
                "distance": r.distance,
                "metadata": r.metadata,
                "relevance_score": r.relevance_score,
            }
            for r in results
        ]
    except Exception as exc:
        logger.error("Conversation query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/memory/query/code", response_model=List[SearchResultItem])
async def api_query_code_events(req: QueryRequest) -> List[dict]:
    """Semantic search restricted to the code-events collection."""
    try:
        results = query_code_events(
            query_text=req.query,
            n_results=req.n_results,
        )
        return [
            {
                "id": r.id,
                "text": r.text,
                "source": r.source,
                "distance": r.distance,
                "metadata": r.metadata,
                "relevance_score": r.relevance_score,
            }
            for r in results
        ]
    except Exception as exc:
        logger.error("Code query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/memory/stats", response_model=StatsResponse)
async def api_stats() -> dict:
    """Return collection statistics."""
    try:
        return get_collection_stats()
    except Exception as exc:
        logger.error("Stats query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/memory/recent", response_model=List[SearchResultItem])
async def api_recent_memories(limit: int = 20) -> List[dict]:
    """Retrieve the most recent memories across all collections.

    This endpoint is used by the MemoryPanel to browse recent memories
    without requiring a search query.  Results are sorted by timestamp
    (newest first).
    """
    try:
        results = get_recent_memories(n_results=limit)
        return [
            {
                "id": r.id,
                "text": r.text,
                "source": r.source,
                "distance": r.distance,
                "metadata": r.metadata,
                "relevance_score": r.relevance_score,
            }
            for r in results
        ]
    except Exception as exc:
        logger.error("Recent memories query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/memory/{memory_id}")
async def api_delete_memory(
    memory_id: str = Path(..., description="The UUID of the memory to delete"),
    source: str = "conversation",
) -> dict:
    """Delete a memory entry by ID."""
    try:
        ok = delete_memory(memory_id=memory_id, source=source)
        if not ok:
            raise HTTPException(status_code=404, detail="Memory not found")
        return {"memory_id": memory_id, "deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Delete failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/memory/hybrid", response_model=List[SearchResultItem])
async def api_hybrid_search(req: HybridQueryRequest) -> List[dict]:
    """
    Hybrid search: fuse SQLite full-text results with vector similarity.

    *sql_results* should be the raw output from a SQLite FTS query, each
    dict containing at least ``id`` and ``text`` keys.
    """
    try:
        results = hybrid_search(
            query_text=req.query,
            sqlite_results=req.sqlite_results,
            n_results=req.n_results,
        )
        return [
            {
                "id": r.id,
                "text": r.text,
                "source": r.source,
                "distance": r.distance,
                "metadata": r.metadata,
                "relevance_score": r.relevance_score,
            }
            for r in results
        ]
    except Exception as exc:
        logger.error("Hybrid search failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# Agent Endpoints
# ===========================================================================

def _get_executor():
    """Return the executor, raising 503 if not initialised."""
    if _agent_executor is None:
        raise HTTPException(
            status_code=503, detail="Agent services not yet initialised"
        )
    return _agent_executor


def _get_session_store():
    """Return the session store, raising 503 if not initialised."""
    if _session_store is None:
        raise HTTPException(
            status_code=503, detail="Agent services not yet initialised"
        )
    return _session_store


def _get_autonomous_services():
    """Return autonomous services, raising 503 if not initialised."""
    if _background_worker is None:
        raise HTTPException(
            status_code=503, detail="Autonomous services not yet initialised"
        )
    return _background_worker, _checkpoint_manager, _safety_monitor, _resource_monitor, _notification_service


@app.post("/agent/start", response_model=StartAgentResponse)
async def agent_start(req: StartAgentRequest) -> dict:
    """
    Start a new agent session with the given goal.

    The agent will automatically begin executing in the background,
    observing the project state, planning tasks, and acting on them.
    The optional ``mode`` parameter selects an agent mode that configures
    system prompt, available tools, verification strategy, and limits.
    """
    executor = _get_executor()
    try:
        session = await executor.start_session(
            goal=req.goal,
            project_path=req.project_path,
            mode=req.mode,
        )
        return {
            "session_id": session.id,
            "goal": session.goal,
            "status": session.status.value,
            "mode": session.mode,
            "message": f"Agent session started in {session.mode} mode",
        }
    except Exception as exc:
        logger.error("Failed to start agent session: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/agent/{session_id}/status", response_model=SessionStatusResponse)
async def agent_status(
    session_id: str = Path(..., description="The session ID"),
) -> dict:
    """Get the current status of an agent session including all tasks."""
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session.id,
        "goal": session.goal,
        "status": session.status.value,
        "tasks": [t.to_dict() for t in session.tasks],
        "task_summary": {
            "total": len(session.tasks),
            "pending": sum(1 for t in session.tasks if t.status.value == "pending"),
            "in_progress": sum(
                1 for t in session.tasks if t.status.value == "in_progress"
            ),
            "completed": sum(
                1 for t in session.tasks if t.status.value == "completed"
            ),
            "failed": sum(1 for t in session.tasks if t.status.value == "failed"),
        },
        "current_task_index": session.current_task_index,
        "project_path": session.project_path,
        "updated_at": session.updated_at,
    }


@app.post("/agent/{session_id}/pause", response_model=ControlResponse)
async def agent_pause(
    session_id: str = Path(..., description="The session ID"),
) -> dict:
    """Pause a running agent session."""
    executor = _get_executor()
    ok = executor.pause_session(session_id)
    if not ok:
        raise HTTPException(
            status_code=400, detail="Session not found or not running"
        )
    return {
        "session_id": session_id,
        "action": "pause",
        "status": "paused",
        "message": "Session paused",
    }


@app.post("/agent/{session_id}/resume", response_model=ControlResponse)
async def agent_resume(
    session_id: str = Path(..., description="The session ID"),
) -> dict:
    """Resume a paused agent session."""
    executor = _get_executor()
    ok = executor.resume_session(session_id)
    if not ok:
        raise HTTPException(
            status_code=400, detail="Session not found or not paused"
        )
    return {
        "session_id": session_id,
        "action": "resume",
        "status": "running",
        "message": "Session resumed",
    }


@app.post("/agent/{session_id}/stop", response_model=ControlResponse)
async def agent_stop(
    session_id: str = Path(..., description="The session ID"),
) -> dict:
    """Stop (fail) an agent session."""
    executor = _get_executor()
    ok = executor.stop_session(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session_id,
        "action": "stop",
        "status": "stopped",
        "message": "Session stopped",
    }


@app.get("/agent/{session_id}/output", response_model=OutputResponse)
async def agent_output(
    session_id: str = Path(..., description="The session ID"),
    since: int = 0,
) -> dict:
    """
    Get new output events for a session (since-last-check semantics).

    Each call returns only events that have not been returned before.
    Poll this endpoint to get real-time updates from the agent.

    The ``since`` parameter is the index of the last event already seen.
    Events starting from that index are returned.
    """
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Read directly from the executor's output_log (real events)
    all_events = session.output_log
    new_events = all_events[since:] if since > 0 else all_events

    return {
        "session_id": session_id,
        "events": new_events,
        "has_more": len(new_events) > 0,
    }


@app.get("/agent/{session_id}/stream")
async def stream_session(
    session_id: str = Path(..., description="The session ID"),
):
    """
    SSE stream of agent events AND token-level LLM output.

    This endpoint keeps the HTTP connection open and pushes events in
    real-time as the agent executes.  Two event types are streamed:

    1. **output_log events** — thoughts, tool calls, task transitions, etc.
       These are the same events available via ``/agent/{id}/output`` but
       pushed instantly instead of requiring polling.

    2. **token events** — individual token batches from the LLM as they
       are generated, enabling "Cursor-killer" real-time text streaming.

    The stream terminates with a ``done`` event when the session reaches
    a terminal state (completed / failed / waiting).
    """
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    async def event_stream():
        last_event_index = 0
        last_token_len = 0
        idle_ticks = 0
        MAX_IDLE_TICKS = 200  # 200 * 50ms = 10s idle → close stream

        while True:
            # 1. Stream new output_log events
            current_log = session.output_log
            new_events = current_log[last_event_index:]
            for event in new_events:
                yield f"data: {json.dumps(event)}\n\n"
                last_event_index += 1
                idle_ticks = 0

            # 2. Stream token-level content from LLM service token buffer
            token_buffer = None
            if _llm_service is not None:
                token_buffer = _llm_service._token_buffers.get(session_id)
            if token_buffer is not None and len(token_buffer) > last_token_len:
                new_tokens = token_buffer[last_token_len:]
                if new_tokens:
                    yield f"data: {json.dumps({
                        'type': 'token',
                        'content': new_tokens,
                        'timestamp': time.time(),
                    })}\n\n"
                    last_token_len = len(token_buffer)
                    idle_ticks = 0
                else:
                    idle_ticks += 1
            else:
                idle_ticks += 1

            # 3. Check if session is in a terminal state
            if session.status.value in ("completed", "failed", "waiting"):
                # Flush any remaining output_log events
                current_log = session.output_log
                final_events = current_log[last_event_index:]
                for event in final_events:
                    yield f"data: {json.dumps(event)}\n\n"

                # Flush remaining tokens
                token_buffer = None
                if _llm_service is not None:
                    token_buffer = _llm_service._token_buffers.get(session_id)
                if token_buffer is not None and len(token_buffer) > last_token_len:
                    new_tokens = token_buffer[last_token_len:]
                    if new_tokens:
                        yield f"data: {json.dumps({
                            'type': 'token',
                            'content': new_tokens,
                            'timestamp': time.time(),
                        })}\n\n"

                yield f"data: {json.dumps({
                    'type': 'done',
                    'status': session.status.value,
                    'timestamp': time.time(),
                })}\n\n"

                # Clean up token buffer
                if _llm_service is not None:
                    _llm_service._token_buffers.pop(session_id, None)
                break

            # 4. Close stream if idle too long (session might be stuck)
            if idle_ticks >= MAX_IDLE_TICKS:
                yield f"data: {json.dumps({
                    'type': 'stream_timeout',
                    'message': 'Stream idle timeout (10s)',
                    'timestamp': time.time(),
                })}\n\n"
                break

            await asyncio.sleep(0.05)  # 50ms = 20 updates/sec

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/agent/modes")
async def agent_list_modes() -> dict:
    """List all available agent modes with descriptions, icons, and colors.

    Returns a list of mode objects suitable for rendering a mode selector
    in the frontend UI.
    """
    from core.modes import list_modes as _list_modes
    return {"modes": _list_modes(), "default": "code"}


@app.get("/agent/sessions", response_model=SessionsListResponse)
async def agent_list_sessions() -> dict:
    """List all agent sessions, most recently updated first."""
    executor = _get_executor()
    sessions = executor.list_sessions()
    return {
        "sessions": [s.to_dict() for s in sessions],
        "total": len(sessions),
    }


# ===========================================================================
# Tool Execution Endpoints (direct tool access)
# ===========================================================================

@app.get("/tools")
async def list_tools() -> dict:
    """List all available tools with their schemas."""
    if _tool_registry is None:
        raise HTTPException(status_code=503, detail="Tool registry not initialised")
    return {
        "tools": _tool_registry.get_tool_schemas(),
        "count": len(_tool_registry.get_tool_names()),
    }


@app.post("/tools/execute", response_model=ToolExecuteResponse)
async def execute_tool(req: ToolExecuteRequest) -> dict:
    """
    Execute a tool directly by name with JSON arguments.

    This is useful for ad-hoc tool use without starting a full agent session.
    """
    if _tool_registry is None:
        raise HTTPException(status_code=503, detail="Tool registry not initialised")

    if not _tool_registry.has_tool(req.tool_name):
        available = ", ".join(sorted(_tool_registry.get_tool_names()))
        raise HTTPException(
            status_code=400,
            detail=f"Unknown tool: '{req.tool_name}'. Available: {available}",
        )

    try:
        result = _tool_registry.execute_tool(req.tool_name, req.arguments)
        return {"tool_name": req.tool_name, "result": result}
    except Exception as exc:
        logger.error("Tool execution failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# LLM Endpoints (direct LLM access)
# ===========================================================================

class LLMCompleteRequest(BaseModel):
    prompt: str = Field(..., description="The prompt to send to the LLM")
    model: str = Field("auto", description="Model identifier or 'auto' for routing")
    system_prompt: Optional[str] = Field(None, description="Override system prompt")
    stream: bool = Field(False, description="Stream the response")


class LLMCompleteResponse(BaseModel):
    response: str
    model_used: str
    provider: str


@app.post("/llm/complete", response_model=LLMCompleteResponse)
async def llm_complete(req: LLMCompleteRequest) -> dict:
    """
    Send a prompt directly to the LLM and get a response.

    Uses smart routing when model="auto" (default).
    """
    if _llm_service is None:
        raise HTTPException(status_code=503, detail="LLM service not initialised")

    from core.llm_service import Message, assemble_messages

    try:
        messages = assemble_messages(
            req.prompt,
            system_prompt=req.system_prompt,
        )

        if req.stream:
            response = await _llm_service.complete(messages, model=req.model)
        else:
            response = await _llm_service.complete(messages, model=req.model)

        # Determine which provider was actually used
        provider = _llm_service.route_by_complexity(req.prompt)
        if req.model != "auto":
            from core.llm_service import LLMProvider
            try:
                provider = LLMProvider(req.model)
            except ValueError:
                pass

        return {
            "response": response,
            "model_used": _llm_service.configs.get(provider, type('obj', (object,), {'model': 'unknown'})).model,
            "provider": provider.value,
        }
    except Exception as exc:
        logger.error("LLM completion failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/llm/stats")
async def llm_stats() -> dict:
    """Return LLM usage statistics."""
    if _llm_service is None:
        raise HTTPException(status_code=503, detail="LLM service not initialised")
    return _llm_service.get_stats()


@app.get("/llm/stream")
async def llm_stream(prompt: str = "Hello"):
    """
    Direct SSE streaming from the LLM.

    Useful for testing the SSE pipe end-to-end without starting
    a full agent session.  Tokens are streamed in real-time as
    the LLM generates them.
    """
    if _llm_service is None:
        raise HTTPException(status_code=503, detail="LLM service not initialised")

    from core.llm_service import Message, assemble_messages

    messages = assemble_messages(prompt)

    async def token_stream():
        try:
            async for batch in _llm_service.stream_complete(messages):
                yield f"data: {json.dumps({
                    'type': 'token',
                    'content': batch,
                    'timestamp': time.time(),
                })}\n\n"
            yield f"data: {json.dumps({
                'type': 'done',
                'status': 'completed',
                'timestamp': time.time(),
            })}\n\n"
        except Exception as exc:
            logger.error("LLM stream failed: %s", exc)
            yield f"data: {json.dumps({
                'type': 'error',
                'content': str(exc),
                'timestamp': time.time(),
            })}\n\n"

    return StreamingResponse(
        token_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ===========================================================================
# Autonomous Endpoints — Background Worker Control
# ===========================================================================

@app.post("/autonomous/start", response_model=AutonomousControlResponse)
async def autonomous_start(req: AutonomousStartRequest) -> dict:
    """Start the background worker.

    If *immediate_goal* is provided, it is added to the queue and the worker
    will begin processing it immediately.
    """
    worker, _, _, _, notifier = _get_autonomous_services()

    try:
        await worker.start()

        # Optionally queue an immediate goal
        if req.immediate_goal:
            goal_id = await worker.queue.add_goal(
                description=req.immediate_goal,
                priority=GoalPriority.HIGH,
                project_path=req.project_path,
            )
            logger.info("Immediate goal queued: %s", goal_id)

        status = worker.get_status()
        return {
            "action": "start",
            "status": "started",
            "message": "Background worker started" + (f" with goal '{req.immediate_goal[:60]}'" if req.immediate_goal else ""),
            "worker_status": status,
        }
    except Exception as exc:
        logger.error("Failed to start background worker: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/autonomous/stop", response_model=AutonomousControlResponse)
async def autonomous_stop() -> dict:
    """Stop the background worker gracefully."""
    worker, _, _, _, _ = _get_autonomous_services()

    try:
        await worker.stop()
        return {
            "action": "stop",
            "status": "stopped",
            "message": "Background worker stopped",
        }
    except Exception as exc:
        logger.error("Failed to stop background worker: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/autonomous/status", response_model=WorkerStatusResponse)
async def autonomous_status() -> dict:
    """Get the current worker status, including the active goal and queue size."""
    worker, _, _, _, _ = _get_autonomous_services()
    return worker.get_status()


@app.post("/autonomous/pause", response_model=AutonomousControlResponse)
async def autonomous_pause() -> dict:
    """Pause the background worker and any active session."""
    worker, _, _, _, _ = _get_autonomous_services()

    try:
        await worker.pause()
        return {
            "action": "pause",
            "status": "paused",
            "message": "Background worker paused",
        }
    except Exception as exc:
        logger.error("Failed to pause background worker: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/autonomous/resume", response_model=AutonomousControlResponse)
async def autonomous_resume() -> dict:
    """Resume the background worker from paused/throttled/error state."""
    worker, _, _, _, _ = _get_autonomous_services()

    try:
        await worker.resume()
        return {
            "action": "resume",
            "status": "running",
            "message": "Background worker resumed",
        }
    except Exception as exc:
        logger.error("Failed to resume background worker: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# Autonomous Endpoints — Goal Management
# ===========================================================================

@app.post("/autonomous/goal")
async def autonomous_add_goal(req: AutonomousGoalRequest) -> dict:
    """Add a new goal to the worker's priority queue."""
    worker, _, _, _, _ = _get_autonomous_services()

    # Map string priority to enum
    priority_map = {
        "critical": GoalPriority.CRITICAL,
        "high": GoalPriority.HIGH,
        "normal": GoalPriority.NORMAL,
        "low": GoalPriority.LOW,
    }
    priority = priority_map.get(req.priority.lower(), GoalPriority.NORMAL)

    try:
        goal_id = await worker.queue.add_goal(
            description=req.description,
            priority=priority,
            deadline=req.deadline,
            project_path=req.project_path,
        )
        return {
            "goal_id": goal_id,
            "status": "queued",
            "priority": req.priority,
            "message": f"Goal added to queue: {req.description[:80]}",
        }
    except Exception as exc:
        logger.error("Failed to add goal: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/autonomous/goals", response_model=GoalListResponse)
async def autonomous_list_goals() -> dict:
    """List all goals in the queue with their status."""
    worker, _, _, _, _ = _get_autonomous_services()

    try:
        goals = await worker.queue.list_goals()
        return {
            "goals": [g.to_dict() for g in goals],
            "total": len(goals),
        }
    except Exception as exc:
        logger.error("Failed to list goals: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# Autonomous Endpoints — Checkpoint Management
# ===========================================================================

@app.post("/autonomous/checkpoint/{session_id}")
async def autonomous_force_checkpoint(
    session_id: str = Path(..., description="The session ID to checkpoint"),
) -> dict:
    """Force an immediate checkpoint save for a session."""
    _, checkpoint_mgr, _, _, _ = _get_autonomous_services()

    try:
        executor = _get_executor()
        session = executor.get_session(session_id)
        if not session:
            # Try restoring from checkpoint
            raise HTTPException(status_code=404, detail="Session not found")

        filepath = await checkpoint_mgr.save_checkpoint(session)
        return {
            "session_id": session_id,
            "checkpoint_file": filepath,
            "status": "saved",
            "task_count": len(session.tasks),
            "message": f"Checkpoint saved to {filepath}",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to save checkpoint: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/autonomous/checkpoints", response_model=CheckpointListResponse)
async def autonomous_list_checkpoints() -> dict:
    """List all available checkpoints."""
    _, checkpoint_mgr, _, _, _ = _get_autonomous_services()

    try:
        checkpoints = await checkpoint_mgr.list_checkpoints()
        return {
            "checkpoints": checkpoints,
            "total": len(checkpoints),
        }
    except Exception as exc:
        logger.error("Failed to list checkpoints: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/autonomous/checkpoints/{session_id}")
async def autonomous_load_checkpoint(
    session_id: str = Path(..., description="The session ID to load"),
) -> dict:
    """Load a checkpoint by session ID and return its contents."""
    _, checkpoint_mgr, _, _, _ = _get_autonomous_services()

    try:
        checkpoint = await checkpoint_mgr.load_checkpoint(session_id)
        if checkpoint is None:
            raise HTTPException(status_code=404, detail="Checkpoint not found")

        return {
            "session_id": checkpoint.session_id,
            "goal": checkpoint.goal,
            "status": checkpoint.status,
            "project_path": checkpoint.project_path,
            "current_task_index": checkpoint.current_task_index,
            "saved_at": checkpoint.saved_at,
            "task_count": len(checkpoint.tasks),
            "tasks": checkpoint.tasks,
            "output_log_length": len(checkpoint.output_log),
            "file_hash_count": len(checkpoint.file_hashes),
            "git_state": checkpoint.git_state.to_dict() if checkpoint.git_state else None,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to load checkpoint: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/autonomous/checkpoints/{session_id}")
async def autonomous_delete_checkpoint(
    session_id: str = Path(..., description="The session ID to delete"),
) -> dict:
    """Delete a checkpoint by session ID."""
    _, checkpoint_mgr, _, _, _ = _get_autonomous_services()

    try:
        deleted = await checkpoint_mgr.delete_checkpoint(session_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Checkpoint not found")
        return {"session_id": session_id, "deleted": True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to delete checkpoint: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# Autonomous Endpoints — Safety
# ===========================================================================

@app.get("/autonomous/safety/stats")
async def autonomous_safety_stats() -> dict:
    """Return safety monitor statistics."""
    _, _, safety, _, _ = _get_autonomous_services()
    return safety.get_stats()


@app.post("/autonomous/safety/reset")
async def autonomous_safety_reset() -> dict:
    """Reset safety monitor counters (failure counts, deletion counts)."""
    _, _, safety, _, _ = _get_autonomous_services()
    safety.reset_deletion_count()
    return {"status": "reset", "message": "Safety counters reset"}


# ===========================================================================
# Autonomous Endpoints — Resource Monitor
# ===========================================================================

@app.get("/autonomous/resources")
async def autonomous_resources() -> dict:
    """Return current system resource usage."""
    _, _, _, resources, _ = _get_autonomous_services()
    return resources.check_resources()


# ===========================================================================
# Notification Endpoints
# ===========================================================================

@app.post("/notifications")
async def notifications_send(req: SendNotificationRequest) -> dict:
    """Send a notification (test endpoint or manual send)."""
    _, _, _, _, notifier = _get_autonomous_services()

    try:
        ok = await notifier.send(
            title=req.title,
            body=req.body,
            actions=req.actions,
            urgency=req.urgency,
        )
        return {
            "sent": ok,
            "title": req.title,
            "urgency": req.urgency,
        }
    except Exception as exc:
        logger.error("Failed to send notification: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/notifications/recent", response_model=NotificationListResponse)
async def notifications_recent(limit: int = 10) -> dict:
    """Get recent notifications."""
    _, _, _, _, notifier = _get_autonomous_services()

    try:
        recent = await notifier.get_recent(limit=limit)
        return {
            "notifications": recent,
            "total": len(recent),
        }
    except Exception as exc:
        logger.error("Failed to get recent notifications: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/notifications/stats")
async def notifications_stats() -> dict:
    """Return notification service statistics."""
    _, _, _, _, notifier = _get_autonomous_services()
    return notifier.get_stats()


@app.post("/notifications/flush")
async def notifications_flush() -> dict:
    """Attempt to re-send all queued notifications."""
    _, _, _, _, notifier = _get_autonomous_services()

    try:
        delivered = await notifier.flush_queue()
        return {
            "delivered": delivered,
            "message": f"Flushed {delivered} queued notifications",
        }
    except Exception as exc:
        logger.error("Failed to flush notifications: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/notifications/clear")
async def notifications_clear() -> dict:
    """Clear all notification history."""
    _, _, _, _, notifier = _get_autonomous_services()

    try:
        await notifier.clear_history()
        return {"status": "cleared", "message": "Notification history cleared"}
    except Exception as exc:
        logger.error("Failed to clear notifications: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# Context Compression Endpoints
# ===========================================================================

@app.post("/context/compact", response_model=CompactContextResponse)
async def compact_context(req: CompactContextRequest) -> dict:
    """
    Compact conversation context for a session.

    Reduces the number of messages while preserving semantic meaning
    using the selected strategy (summary, truncate, or archive).
    """
    try:
        executor = _get_executor()
        session = executor.get_session(req.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # session.messages is a List[Dict[str, str]] (each has "role", "content", "timestamp")
        original_count = len(session.messages)

        if original_count == 0:
            return {
                "session_id": req.session_id,
                "original_messages": 0,
                "compacted_messages": 0,
                "strategy": req.strategy,
                "tokens_saved": 0,
            }

        # Calculate current token estimate
        total_chars = sum(len(m.get("content", "")) for m in session.messages)
        estimated_tokens = total_chars // 4  # Rough: ~4 chars per token

        # Strategy-based compaction
        if req.strategy == "summary" and original_count > 10:
            # Summarize older messages, keep recent ones verbatim
            if _llm_service is None:
                # LLM not available — fall back to truncate instead of crashing
                logger.warning("LLM service unavailable for summary compaction, falling back to truncate")
                keep_count = max(10, req.max_tokens // 200)
                session.messages = session.messages[-keep_count:]
            else:
                from core.llm_service import Message, assemble_messages
                half = original_count // 2
                older = session.messages[:half]
                summary_prompt = (
                    "Summarize the following conversation concisely, "
                    "preserving key decisions, context, and action items:\n\n"
                    + "\n".join(f"{m.get('role', '?')}: {m.get('content', '')[:500]}" for m in older)
                )
                summary_messages = assemble_messages(user_prompt=summary_prompt)
                try:
                    summary = await _llm_service.complete(summary_messages)
                except Exception as llm_exc:
                    logger.warning("LLM summary failed (%s), falling back to truncate", llm_exc)
                    keep_count = max(10, req.max_tokens // 200)
                    session.messages = session.messages[-keep_count:]
                else:
                    # Replace older messages with a single summary dict
                    summary_dict = {
                        "role": "system",
                        "content": f"[Context Summary] {summary}",
                        "timestamp": str(time.time()),
                    }
                    session.messages = [summary_dict] + session.messages[half:]

        elif req.strategy == "truncate" and original_count > 20:
            # Keep only the N most recent messages
            keep_count = max(10, req.max_tokens // 200)
            session.messages = session.messages[-keep_count:]

        elif req.strategy == "archive" and original_count > 10:
            # Move older messages to long-term memory
            archive = session.messages[:-10]
            archive_text = "\n".join(
                f"{m.get('role', '?')}: {m.get('content', '')}" for m in archive
            )
            # Store in memory using the memory client
            if _agent_executor is not None and _agent_executor.memory is not None:
                _agent_executor.memory.store_conversation(
                    session_id=req.session_id,
                    role="system",
                    content=f"[Context Archive] {archive_text[:2000]}",
                    phase="archive",
                )
            session.messages = session.messages[-10:]

        compacted_count = len(session.messages)
        new_total_chars = sum(len(m.get("content", "")) for m in session.messages)
        new_estimated_tokens = new_total_chars // 4
        tokens_saved = max(0, estimated_tokens - new_estimated_tokens)

        return {
            "session_id": req.session_id,
            "original_messages": original_count,
            "compacted_messages": compacted_count,
            "strategy": req.strategy,
            "tokens_saved": tokens_saved,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to compact context: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/context/stats", response_model=ContextStatsResponse)
async def get_context_stats(session_id: str) -> dict:
    """Get current context usage statistics for a session."""
    try:
        executor = _get_executor()
        session = executor.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        msg_count = len(session.messages)
        # Better token estimation: ~4 chars per token instead of flat 150/msg
        total_chars = sum(len(m.get("content", "")) for m in session.messages)
        estimated_tokens = total_chars // 4 if total_chars > 0 else msg_count * 150
        max_context = 8192  # typical context window

        return {
            "session_id": session_id,
            "total_messages": msg_count,
            "total_tokens": estimated_tokens,
            "context_window_used": round(min(1.0, estimated_tokens / max_context), 2),
            "strategies_available": ["summary", "truncate", "archive"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to get context stats: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# Skill Installer Endpoints
# ===========================================================================

# Lazy-initialised skill installer (uses real git clone + file extraction)
_skill_installer = None


def _get_skill_installer():
    """Return (creating if needed) the shared SkillInstaller instance."""
    global _skill_installer
    if _skill_installer is None:
        from skills.installer import SkillInstaller
        _skill_installer = SkillInstaller()
    return _skill_installer


def _skill_to_dict(skill) -> dict:
    """Convert a Skill dataclass to a dict suitable for SkillResponse."""
    # Convert ISO timestamp to unix float for SkillResponse compatibility
    installed_at = skill.installed_at
    if isinstance(installed_at, str):
        try:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(installed_at)
            installed_at = dt.timestamp()
        except (ValueError, TypeError):
            installed_at = 0.0
    elif not isinstance(installed_at, (int, float)):
        installed_at = 0.0

    return {
        "name": skill.name,
        "version": skill.version,
        "description": skill.description,
        "installed_at": installed_at,
        "source": skill.source.value,
        "status": "active",
    }


@app.post("/skills/install/github", response_model=SkillResponse)
async def install_skill_from_github(
    req: InstallSkillGithubRequest,
) -> dict:
    """Install a skill from a GitHub repository.

    Clones the repo, extracts skill directories containing SKILL.md files,
    copies them to the installed skills directory, and loads any tools
    into the ToolRegistry.
    """
    installer = _get_skill_installer()
    try:
        # Run the blocking git clone + file copy in a thread pool
        skill = await asyncio.to_thread(
            installer.install_from_github,
            owner=req.owner,
            repo=req.repo,
            skill_name=req.skill_name,
            branch=req.branch,
        )

        # Load any tools from the newly installed skill into the registry
        if _tool_registry is not None:
            from pathlib import Path as _Path
            skill_dir = _Path(skill.path)
            if skill_dir.is_dir():
                try:
                    _tool_registry._load_single_skill(skill_dir)
                    logger.info("Loaded tools from skill '%s' into registry", skill.name)
                except Exception as exc:
                    logger.warning("Failed to load tools from skill '%s': %s", skill.name, exc)

        logger.info("Installed skill '%s' from github:%s/%s", skill.name, req.owner, req.repo)
        return _skill_to_dict(skill)
    except Exception as exc:
        logger.error("Failed to install skill from GitHub: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/skills/install/url", response_model=SkillResponse)
async def install_skill_from_url(
    req: InstallSkillUrlRequest,
) -> dict:
    """Install a skill from a URL (SKILL.md file).

    Downloads the skill manifest, saves it to the installed skills directory,
    and loads any tools into the ToolRegistry.
    """
    installer = _get_skill_installer()
    try:
        # Run the blocking download + file save in a thread pool
        skill = await asyncio.to_thread(
            installer.install_from_url,
            url=req.url,
            skill_name=req.skill_name,
        )

        # Load any tools from the newly installed skill into the registry
        if _tool_registry is not None:
            from pathlib import Path as _Path
            skill_dir = _Path(skill.path)
            if skill_dir.is_dir():
                try:
                    _tool_registry._load_single_skill(skill_dir)
                    logger.info("Loaded tools from skill '%s' into registry", skill.name)
                except Exception as exc:
                    logger.warning("Failed to load tools from skill '%s': %s", skill.name, exc)

        logger.info("Installed skill '%s' from url:%s", skill.name, req.url)
        return _skill_to_dict(skill)
    except Exception as exc:
        logger.error("Failed to install skill from URL: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/skills/installed", response_model=SkillListResponse)
async def list_installed_skills() -> dict:
    """List all user-installed skills from the filesystem."""
    installer = _get_skill_installer()
    try:
        installed = await asyncio.to_thread(installer.list_installed)
        skills = [_skill_to_dict(s) for s in installed]
        return {"skills": skills, "total": len(skills)}
    except Exception as exc:
        logger.error("Failed to list installed skills: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/skills/bundled", response_model=SkillListResponse)
async def list_bundled_skills() -> dict:
    """List all bundled (pre-installed) skills from the filesystem."""
    installer = _get_skill_installer()
    try:
        bundled = await asyncio.to_thread(installer.list_bundled)
        skills = [_skill_to_dict(s) for s in bundled]
        return {"skills": skills, "total": len(skills)}
    except Exception as exc:
        logger.error("Failed to list bundled skills: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/skills/{skill_name}")
async def uninstall_skill(
    skill_name: str = Path(..., description="The skill name to uninstall"),
) -> dict:
    """Uninstall a user-installed skill, removing files from disk."""
    installer = _get_skill_installer()
    try:
        await asyncio.to_thread(installer.uninstall_skill, skill_name)
        logger.info("Uninstalled skill '%s'", skill_name)
        return {"skill_name": skill_name, "uninstalled": True}
    except Exception as exc:
        # Check if it's a "not found" error
        from skills.installer import SkillNotFoundError
        if isinstance(exc, SkillNotFoundError):
            raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
        logger.error("Failed to uninstall skill '%s': %s", skill_name, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/skills/{skill_name}/update", response_model=SkillResponse)
async def update_skill(
    skill_name: str = Path(..., description="The skill name to update"),
) -> dict:
    """Update a skill to the latest version by re-installing from source."""
    installer = _get_skill_installer()
    try:
        skill = await asyncio.to_thread(installer.update_skill, skill_name)

        # Reload tools in the registry
        if _tool_registry is not None:
            from pathlib import Path as _Path
            skill_dir = _Path(skill.path)
            if skill_dir.is_dir():
                try:
                    _tool_registry._load_single_skill(skill_dir)
                    logger.info("Reloaded tools from updated skill '%s'", skill.name)
                except Exception as exc:
                    logger.warning("Failed to reload tools from skill '%s': %s", skill.name, exc)

        logger.info("Updated skill '%s' to %s", skill.name, skill.version)
        return _skill_to_dict(skill)
    except Exception as exc:
        from skills.installer import SkillNotFoundError, SkillInstallError
        if isinstance(exc, SkillNotFoundError):
            raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
        logger.error("Failed to update skill '%s': %s", skill_name, exc)
        raise HTTPException(status_code=500, detail=str(exc))


def _bump_version(version: str) -> str:
    """Bump the patch version of a semver string."""
    parts = version.split(".")
    if len(parts) >= 3:
        try:
            parts[2] = str(int(parts[2]) + 1)
        except ValueError:
            parts[2] = "1"
    return ".".join(parts)


@app.get("/skills/search", response_model=SkillSearchResponse)
async def search_skills(query: str) -> dict:
    """Search for skills across installed, bundled, and GitHub marketplace."""
    results = []
    query_lower = query.lower()

    # Search installed skills from filesystem
    installer = _get_skill_installer()
    try:
        installed = await asyncio.to_thread(installer.list_installed)
        for skill in installed:
            if query_lower in skill.name.lower() or query_lower in skill.description.lower():
                results.append({**_skill_to_dict(skill), "location": "installed"})
    except Exception as exc:
        logger.warning("Failed to search installed skills: %s", exc)

    # Search bundled skills from filesystem
    try:
        bundled = await asyncio.to_thread(installer.list_bundled)
        for skill in bundled:
            if query_lower in skill.name.lower() or query_lower in skill.description.lower():
                results.append({**_skill_to_dict(skill), "location": "bundled"})
    except Exception as exc:
        logger.warning("Failed to search bundled skills: %s", exc)

    # Search real GitHub marketplace
    try:
        marketplace_results = await asyncio.to_thread(
            installer.search_marketplace, query, limit=10
        )
        for item in marketplace_results:
            results.append({
                "name": item.get("full_name", "").split("/")[-1],
                "description": item.get("description", ""),
                "version": "latest",
                "source": item.get("clone_url", ""),
                "stars": item.get("stars", "0"),
                "url": item.get("url", ""),
                "location": "marketplace",
            })
    except Exception as exc:
        logger.warning("Marketplace search failed: %s", exc)

    return {"results": results, "total": len(results), "query": query}


# ===========================================================================
# LLM Streaming Metrics Endpoint
# ===========================================================================

@app.get("/llm/metrics", response_model=LLMMetricsResponse)
async def get_llm_metrics() -> dict:
    """Get LLM streaming performance metrics."""
    if _llm_service is None:
        raise HTTPException(status_code=503, detail="LLM service not initialised")

    metrics = _llm_service.get_stream_metrics()
    return {
        "tokens_per_second": metrics.get("tokens_per_second", 0.0),
        "avg_latency_ms": metrics.get("avg_latency_ms", 0.0),
        "buffer_efficiency": metrics.get("buffer_efficiency", 0.0),
        "active_streams": metrics.get("active_streams", 0),
        "total_tokens": metrics.get("total_tokens", 0),
        "total_batches": metrics.get("total_batches", 0),
    }


# ===========================================================================
# Thinking Mode Endpoint
# ===========================================================================

# Session-level thinking mode state
_thinking_mode: Dict[str, dict] = {}


@app.post("/agent/think", response_model=ThinkingModeResponse)
async def enable_thinking_mode(req: ThinkingModeRequest) -> dict:
    """
    Enable or disable deep thinking mode for a session.

    When enabled, the agent performs deeper reasoning before responding,
    including chain-of-thought analysis and self-verification.
    The depth parameter controls the intensity:
    - "light": concise, direct responses
    - "standard": normal reasoning
    - "deep": detailed chain-of-thought with self-verification
    """
    executor = _get_executor()
    session = executor.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Store on session for executor to read
    session.thinking_mode = {
        "enabled": req.enabled,
        "depth": req.depth,
        "updated_at": time.time(),
    }

    # Also store in global dict for backward compatibility
    _thinking_mode[req.session_id] = session.thinking_mode.copy()

    depth_desc = {"light": "lightweight", "standard": "standard", "deep": "maximum"}
    msg = (
        f"Deep thinking mode {'enabled' if req.enabled else 'disabled'} "
        f"({depth_desc.get(req.depth, req.depth)} depth) for session {req.session_id}"
    )
    logger.info(msg)

    return {
        "session_id": req.session_id,
        "thinking_enabled": req.enabled,
        "depth": req.depth,
        "message": msg,
    }


@app.get("/agent/think", response_model=ThinkingModeResponse)
async def get_thinking_mode(session_id: str) -> dict:
    """Get the current thinking mode configuration for a session."""
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session_id,
        "thinking_enabled": session.thinking_mode.get("enabled", False),
        "depth": session.thinking_mode.get("depth", "standard"),
        "message": f"Thinking mode: {session.thinking_mode.get('depth', 'standard')} depth, "
                   f"{'enabled' if session.thinking_mode.get('enabled', False) else 'disabled'}",
    }


# ===========================================================================
# Multi-Agent Orchestration Endpoints
# ===========================================================================

class OrchestrateTeamRequest(BaseModel):
    goal: str = Field(..., description="High-level goal for the team to accomplish")
    roles: List[str] = Field(
        default=["code_engineer", "test_engineer", "security_auditor"],
        description="List of role IDs to include in the team",
    )
    project_path: str = Field(
        "~/construct-projects/default",
        description="Path to the project directory",
    )
    max_parallel: int = Field(3, ge=1, le=10, description="Max parallel agent tasks")


class OrchestrateMessageRequest(BaseModel):
    from_agent: str = Field("user", description="Sender agent ID (use 'user' for human)")
    to_agent: Optional[str] = Field(None, description="Recipient agent ID (None = broadcast)")
    content: str = Field(..., description="Message content")


class OrchestrateTeamResponse(BaseModel):
    team_id: str
    goal: str
    agents: List[dict]
    status: str
    message: str


def _get_orchestrator():
    """Return the orchestrator, initialising lazily if needed."""
    global _orchestrator
    if _orchestrator is None:
        if _llm_service is None or _tool_registry is None:
            raise HTTPException(status_code=503, detail="Agent services not yet initialised")
        from agents.orchestrator import AgentOrchestrator
        _orchestrator = AgentOrchestrator(
            llm_service=_llm_service,
            tool_registry=_tool_registry,
            memory_client=_memory_client if "_memory_client" in dir() else None,
        )
        logger.info("AgentOrchestrator initialised lazily")
    return _orchestrator


@app.post("/orchestrate/team", response_model=OrchestrateTeamResponse)
async def orchestrate_team(req: OrchestrateTeamRequest) -> dict:
    """
    Spawn a multi-agent team for a goal.

    Creates an ephemeral team with the specified roles, decomposes the goal
    into per-agent tasks, and begins parallel execution in the background.
    Use GET /orchestrate/team/{team_id}/status to poll progress.
    """
    orch = _get_orchestrator()
    try:
        # Create the team with requested roles
        team = orch.create_team(
            goal=req.goal,
            required_roles=req.roles,
        )

        # Expand project path
        project_path = os.path.abspath(os.path.expanduser(req.project_path))
        os.makedirs(project_path, exist_ok=True)

        # Build per-agent tasks from the goal
        # Each agent gets a task tailored to its role
        agent_tasks = []
        for role in team.agents:
            task_desc = (
                f"Team goal: {req.goal}\n"
                f"Your role: {role.name} ({role.id})\n"
                f"Role description: {role.description}\n"
                f"Project path: {project_path}\n"
                f"Contribute your expertise as {role.name} to achieve the team goal. "
                f"Focus on what your role specialises in."
            )
            agent_tasks.append({
                "agent_id": role.id,
                "task": task_desc,
                "task_id": f"task-{role.id}",
                "project_path": project_path,
            })

        # Build agent info for response
        agent_info = [
            {
                "id": role.id,
                "role": role.id,
                "name": role.name,
                "status": "idle",
                "task": "",
                "progress": 0,
                "description": role.description,
                "tools": role.tools,
                "personality": role.personality,
            }
            for role in team.agents
        ]

        # Kick off parallel execution in the background
        async def _run_team():
            """Background task: run all agents in parallel."""
            try:
                team.status = "active"
                # Update agent statuses to working
                for ai in agent_info:
                    ai["status"] = "working"
                    ai["task"] = req.goal[:60]

                results = await orch.execute_parallel(team.id, agent_tasks)

                # Update agent info from results
                for result in results:
                    aid = result.get("agent_id", "")
                    for ai in agent_info:
                        if ai["id"] == aid:
                            ai["status"] = "completed" if result.get("status") == "completed" else "failed"
                            ai["progress"] = 100 if result.get("status") == "completed" else 0
                            break

                # Merge results
                orch.merge_results(team.id)

            except Exception as exc:
                logger.exception("Team execution failed for %s", team.id)
                team.status = "failed"
                for ai in agent_info:
                    if ai["status"] == "working":
                        ai["status"] = "failed"

        # Store task info on the team for status polling
        team._agent_info = agent_info  # type: ignore[attr-defined]
        team._project_path = project_path  # type: ignore[attr-defined]

        # Start execution in background
        asyncio.create_task(_run_team())

        return {
            "team_id": team.id,
            "goal": req.goal,
            "agents": agent_info,
            "status": "running",
            "message": f"Team started with {len(team.agents)} agents in {len(req.roles)} roles",
        }

    except Exception as exc:
        logger.error("Failed to orchestrate team: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/orchestrate/team/{team_id}/status")
async def orchestrate_team_status(
    team_id: str = Path(..., description="The team ID"),
) -> dict:
    """
    Get real-time status of a multi-agent team.

    Returns each agent's status, progress, recent messages, and the
    overall team state (forming / active / paused / completed / failed).
    """
    orch = _get_orchestrator()
    if team_id not in orch.teams:
        raise HTTPException(status_code=404, detail=f"Team '{team_id}' not found")

    team = orch.teams[team_id]

    # Get agent info (updated by background task)
    agent_info = getattr(team, "_agent_info", [])

    # Build per-agent message logs
    agents_with_messages = []
    for ai in agent_info:
        # Get recent messages for this agent
        agent_messages = []
        for msg in team.messages[-50:]:  # last 50 messages
            if msg.to_agent == ai["id"] or msg.from_agent == ai["id"] or msg.to_agent is None:
                agent_messages.append({
                    "msg_id": msg.msg_id,
                    "from": msg.from_agent,
                    "to": msg.to_agent or "all",
                    "type": msg.msg_type.value,
                    "content": msg.content[:300],
                    "timestamp": msg.timestamp,
                })

        agents_with_messages.append({
            **ai,
            "messages": agent_messages[-10:],  # Last 10 per agent
        })

    # Flatten all messages for the message feed
    all_messages = []
    for msg in team.messages[-100:]:
        all_messages.append({
            "msg_id": msg.msg_id,
            "from": msg.from_agent,
            "to": msg.to_agent or "all",
            "type": msg.msg_type.value,
            "content": msg.content[:300],
            "timestamp": msg.timestamp,
        })

    return {
        "team_id": team.id,
        "goal": team.goal,
        "status": team.status,
        "agents": agents_with_messages,
        "messages": all_messages,
        "message_count": len(team.messages),
        "elapsed_seconds": time.time() - team.created_at,
        "results": team.results if team.status in ("completed", "failed") else None,
    }


@app.post("/orchestrate/team/{team_id}/message")
async def orchestrate_team_message(
    team_id: str = Path(..., description="The team ID"),
    req: OrchestrateMessageRequest = None,
) -> dict:
    """
    Send a message to a specific agent or broadcast to the team.

    Set to_agent to null/None to broadcast to all agents.
    Use from_agent='user' for human-originated messages.
    """
    orch = _get_orchestrator()
    if team_id not in orch.teams:
        raise HTTPException(status_code=404, detail=f"Team '{team_id}' not found")

    try:
        if req.to_agent is None:
            # Broadcast
            msg = orch.broadcast(
                team_id=team_id,
                from_agent=req.from_agent,
                content=req.content,
            )
        else:
            # Directed message
            from agents.orchestrator import AgentMessage, MessageType
            msg = AgentMessage(
                msg_type=MessageType.REQUEST,
                from_agent=req.from_agent,
                to_agent=req.to_agent,
                content=req.content,
            )
            orch.send_message(team_id, msg)

        return {
            "sent": True,
            "msg_id": msg.msg_id,
            "from": req.from_agent,
            "to": req.to_agent or "all",
            "content": req.content[:200],
        }

    except Exception as exc:
        logger.error("Failed to send team message: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/orchestrate/roles")
async def orchestrate_list_roles() -> dict:
    """List all available agent roles with descriptions and tools."""
    try:
        from agents.roles import ALL_ROLES, ROLE_MAP
        return {
            "roles": [
                {
                    "id": role.id,
                    "name": role.name,
                    "description": role.description,
                    "tools": role.tools,
                    "triggers": role.triggers,
                    "personality": role.personality,
                }
                for role in ALL_ROLES
            ],
            "total": len(ALL_ROLES),
        }
    except Exception as exc:
        logger.error("Failed to list roles: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/orchestrate/status")
async def orchestrate_status() -> dict:
    """Get orchestrator status including active teams and queue info."""
    orch = _get_orchestrator()
    return orch.get_status()


# ===========================================================================
# MCP (Model Context Protocol) Endpoints
# ===========================================================================

class MCPConnectRequest(BaseModel):
    """Request body for connecting to an MCP server via stdio transport."""
    name: str = Field(..., description="Unique name for this MCP server connection")
    command: str = Field(..., description="Executable to launch (e.g. 'npx', 'python')")
    args: List[str] = Field(default_factory=list, description="Arguments for the command")
    env: Optional[Dict[str, str]] = Field(None, description="Environment variables for the subprocess")


class MCPConnectResponse(BaseModel):
    connected: bool
    name: str
    tools: List[dict]
    tool_count: int
    message: str


class MCPToolListResponse(BaseModel):
    tools: List[dict]
    total: int
    servers: List[str]


class MCPDisconnectResponse(BaseModel):
    disconnected: bool
    name: str
    tools_removed: int
    message: str


class MCPStatusResponse(BaseModel):
    servers: List[dict]
    total_servers: int
    total_tools: int
    mcp_enabled: bool


def _get_mcp_manager():
    """Return the shared MCPConnectionManager from ToolRegistry."""
    if _tool_registry is None:
        raise HTTPException(status_code=503, detail="Tool registry not initialised")
    return _tool_registry._get_mcp_manager()


@app.post("/mcp/connect", response_model=MCPConnectResponse)
async def mcp_connect(req: MCPConnectRequest) -> dict:
    """Connect to an MCP server via stdio transport.

    Launches the specified command as a subprocess, performs the MCP
    initialize handshake, discovers available tools, and registers them
    in the tool registry so the agent can use them in the ReAct loop.

    Example::

        curl -X POST http://127.0.0.1:8000/mcp/connect \\
          -H "Content-Type: application/json" \\
          -d '{"name":"fs","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}'
    """
    if _tool_registry is None:
        raise HTTPException(status_code=503, detail="Tool registry not initialised")

    try:
        from mcp.connection_manager import StdioServerConfig

        config = StdioServerConfig(
            name=req.name,
            command=req.command,
            args=req.args,
            env=req.env,
        )

        manager = _tool_registry._get_mcp_manager()
        success = await manager.connect_stdio(req.name, config)

        if not success:
            return {
                "connected": False,
                "name": req.name,
                "tools": [],
                "tool_count": 0,
                "message": f"Failed to connect to MCP server '{req.name}' (process may have crashed)",
            }

        # Register discovered tools in the tool registry
        registered_count = _tool_registry.register_mcp_server_tools(req.name)

        # Get tool info for response
        conn = manager._stdio_connections.get(req.name)
        tools_info = []
        if conn:
            for t in conn.tools:
                tools_info.append({
                    "name": t.name,
                    "description": t.description,
                    "full_name": f"mcp_{req.name}_{t.name}",
                })

        logger.info(
            "MCP server '%s' connected: %d tools registered (command=%s %s)",
            req.name,
            registered_count,
            req.command,
            " ".join(req.args),
        )

        return {
            "connected": True,
            "name": req.name,
            "tools": tools_info,
            "tool_count": registered_count,
            "message": f"Connected to MCP server '{req.name}' with {registered_count} tools",
        }

    except Exception as exc:
        logger.error("MCP connect failed for '%s': %s", req.name, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/mcp/tools", response_model=MCPToolListResponse)
async def mcp_list_tools() -> dict:
    """List all tools from connected MCP servers.

    Returns all tools discovered from stdio MCP servers, including
    their names, descriptions, and the server they belong to.
    """
    if _tool_registry is None:
        raise HTTPException(status_code=503, detail="Tool registry not initialised")

    try:
        manager = _tool_registry._get_mcp_manager()
        all_tools = []
        server_names = []

        for server_name in manager.list_stdio_servers():
            server_names.append(server_name)
            server_tools = await manager.list_stdio_tools(server_name)
            for t in server_tools:
                all_tools.append({
                    "name": t.name,
                    "full_name": f"mcp_{server_name}_{t.name}",
                    "description": t.description,
                    "server": server_name,
                    "input_schema": t.input_schema,
                })

        return {
            "tools": all_tools,
            "total": len(all_tools),
            "servers": server_names,
        }

    except Exception as exc:
        logger.error("MCP tools list failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/mcp/disconnect/{server_name}", response_model=MCPDisconnectResponse)
async def mcp_disconnect(
    server_name: str = Path(..., description="The MCP server name to disconnect"),
) -> dict:
    """Disconnect from an MCP server and unregister its tools.

    Terminates the subprocess, removes the connection from the pool,
    and unregisters all tools that were discovered from this server.
    """
    if _tool_registry is None:
        raise HTTPException(status_code=503, detail="Tool registry not initialised")

    try:
        manager = _tool_registry._get_mcp_manager()

        # Check if server exists
        if server_name not in manager._stdio_connections:
            raise HTTPException(
                status_code=404,
                detail=f"MCP server '{server_name}' not found",
            )

        # Unregister tools from registry
        tools_removed = _tool_registry.unregister_mcp_server_tools(server_name)

        # Disconnect from the server
        await manager.disconnect_stdio(server_name)

        logger.info("MCP server '%s' disconnected: %d tools removed", server_name, tools_removed)

        return {
            "disconnected": True,
            "name": server_name,
            "tools_removed": tools_removed,
            "message": f"Disconnected from MCP server '{server_name}', {tools_removed} tools removed",
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("MCP disconnect failed for '%s': %s", server_name, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/mcp/status", response_model=MCPStatusResponse)
async def mcp_status() -> dict:
    """Get the status of all MCP connections.

    Returns information about each connected MCP server including
    health status, discovered tools, and subprocess details.
    """
    if _tool_registry is None:
        raise HTTPException(status_code=503, detail="Tool registry not initialised")

    try:
        manager = _tool_registry._get_mcp_manager()
        server_infos = manager.get_all_stdio_server_info()

        # Also check HTTP connections
        for name in manager.list_servers():
            if name not in [s.get("name") for s in server_infos]:
                health = manager.get_health(name)
                server_infos.append({
                    "name": name,
                    "type": "http",
                    "status": health.status.value if health else "unknown",
                })

        total_tools = sum(len(s.get("tools", [])) for s in server_infos)

        return {
            "servers": server_infos,
            "total_servers": len(server_infos),
            "total_tools": total_tools,
            "mcp_enabled": os.environ.get("CONSTRUCT_MCP_ENABLED") == "1",
        }

    except Exception as exc:
        logger.error("MCP status failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

if __name__ == "__main__":
    import uvicorn
    print(f"🚀 Construct Agent Backend starting on port {PORT}")
    print(f"📁 Data directory: {DATA_DIR}")
    print(f"📝 Log level: {LOG_LEVEL}")
    # Pass the app object directly instead of "app:app" string form.
    # String import form fails when running as a PyInstaller bundle
    # because the module is loaded as __main__, not "app".
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=PORT,
        log_level=LOG_LEVEL,
    )

# ===========================================================================
# Shadow Filesystem Endpoints — virtual staging for agent file ops
# ===========================================================================

class ShadowMergeRequest(BaseModel):
    path: Optional[str] = Field(None, description="File path to merge (None = merge all)")

class ShadowDiscardRequest(BaseModel):
    path: Optional[str] = Field(None, description="File path to discard (None = discard all)")


@app.get("/session/{session_id}/shadow/diffs")
async def get_shadow_diffs(session_id: str) -> dict:
    """Get all pending changes from the session's shadow filesystem as unified diffs.

    Returns diffs for every file that has been created, modified, or deleted
    in the shadow layer, along with summary statistics.
    """
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.shadow_fs:
        raise HTTPException(status_code=404, detail="Shadow filesystem not initialised for this session")

    return {
        "session_id": session_id,
        "diffs": session.shadow_fs.get_all_diffs(),
        "stats": session.shadow_fs.get_stats(),
    }


@app.post("/session/{session_id}/shadow/merge")
async def merge_shadow_changes(session_id: str, req: ShadowMergeRequest) -> dict:
    """Merge shadow changes to disk (user clicked Accept).

    Writes all pending changes from the shadow filesystem to the real
    filesystem.  Can merge a single file or all files at once.
    """
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.shadow_fs:
        raise HTTPException(status_code=404, detail="Shadow filesystem not initialised for this session")

    try:
        results = session.shadow_fs.merge_to_disk(req.path)
        return {
            "session_id": session_id,
            "merged": results,
            "all_success": all(results.values()),
        }
    except Exception as exc:
        logger.error("Shadow merge failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/session/{session_id}/shadow/discard")
async def discard_shadow_changes(session_id: str, req: ShadowDiscardRequest) -> dict:
    """Discard shadow changes (user clicked Reject).

    Reverts the shadow filesystem to the original state, discarding
    all agent modifications.  Can discard a single file or all files.
    """
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.shadow_fs:
        raise HTTPException(status_code=404, detail="Shadow filesystem not initialised for this session")

    try:
        session.shadow_fs.discard_changes(req.path)
        return {
            "session_id": session_id,
            "discarded": req.path or "all",
            "status": "ok",
        }
    except Exception as exc:
        logger.error("Shadow discard failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/session/{session_id}/shadow/stats")
async def get_shadow_stats(session_id: str) -> dict:
    """Get shadow filesystem statistics for a session."""
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.shadow_fs:
        raise HTTPException(status_code=404, detail="Shadow filesystem not initialised for this session")

    return {
        "session_id": session_id,
        "stats": session.shadow_fs.get_stats(),
    }


# ===========================================================================
# Sandbox Endpoints — execution sandbox management
# ===========================================================================

@app.get("/sandbox/status")
async def sandbox_status() -> dict:
    """Check sandbox availability and configuration.

    Reports whether Docker is available for containerized command
    execution, and which sandbox mode will be used for agent sessions.
    """
    try:
        from core.sandbox import DockerSandbox, SandboxManager
        docker_available = DockerSandbox.is_available()
        return {
            "docker_available": docker_available,
            "mode": "docker" if docker_available else "process_fallback",
            "recommended": "docker",
        }
    except Exception as exc:
        return {
            "docker_available": False,
            "mode": "direct_unsafe",
            "error": str(exc),
            "recommended": "Install Docker for sandboxed execution",
        }


# ===========================================================================
# Telemetry Endpoints — execution trace debugging
# ===========================================================================

@app.get("/telemetry/session/{session_id}")
async def get_session_telemetry(session_id: str) -> dict:
    """Get execution traces for a session.

    Returns all recorded trace spans for the session, grouped by
    iteration.  Each span captures a thought, action, or observation
    from the agent's ReAct loop.
    """
    try:
        from core.telemetry import TelemetryStore
        store = TelemetryStore()
        traces = store.get_session_traces(session_id)
        stats = store.get_session_stats(session_id)
        return {
            "session_id": session_id,
            "trace_count": len(traces),
            "iterations": stats.get("total_iterations", 0),
            "stats": stats,
            "traces": traces,
        }
    except Exception as exc:
        logger.error("Telemetry query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/telemetry/session/{session_id}/hallucinations")
async def detect_hallucinations(session_id: str) -> dict:
    """Detect suspected hallucination patterns in session traces.

    Analyses the execution trace for patterns where the agent ignored
    tool errors, produced incoherent thoughts, or continued after
    failures without addressing them.
    """
    try:
        from core.telemetry import TelemetryStore
        store = TelemetryStore()
        patterns = store.detect_hallucination_patterns(session_id)
        return {
            "session_id": session_id,
            "suspected_hallucinations": len(patterns),
            "patterns": patterns,
        }
    except Exception as exc:
        logger.error("Hallucination detection failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


class TelemetryEvaluateRequest(BaseModel):
    session_id: str = Field(..., description="Session ID")
    iteration: int = Field(..., description="Iteration number")
    evaluator: str = Field("human", description="Evaluator type: human, automated, llm_judge")
    score: float = Field(..., ge=0.0, le=1.0, description="Score 0.0-1.0")
    feedback: Optional[str] = Field(None, description="Optional feedback text")
    hallucination_detected: Optional[bool] = Field(None, description="Whether hallucination was detected")


@app.post("/telemetry/evaluate")
async def add_telemetry_evaluation(
    req: TelemetryEvaluateRequest,
) -> dict:
    """Add a quality evaluation for a session iteration.

    Supports human ratings, automated scoring, or LLM judge evaluations.
    Scores are persisted for post-hoc analysis and quality tracking.
    """
    try:
        from core.telemetry import TelemetryStore, TraceEvaluation
        import uuid
        store = TelemetryStore()
        evaluation = TraceEvaluation(
            evaluation_id=str(uuid.uuid4()),
            trace_id="",
            session_id=req.session_id,
            iteration=req.iteration,
            evaluator=req.evaluator,
            score=req.score,
            feedback=req.feedback,
            hallucination_detected=req.hallucination_detected,
        )
        store.record_evaluation(evaluation)
        return {"status": "recorded", "evaluation_id": evaluation.evaluation_id}
    except Exception as exc:
        logger.error("Evaluation recording failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/telemetry/session/{session_id}/latency")
async def get_latency_breakdown(session_id: str) -> dict:
    """Get latency breakdown by phase (thought, action, observation) for a session."""
    try:
        from core.telemetry import TelemetryStore
        store = TelemetryStore()
        breakdown = store.get_latency_breakdown(session_id)
        return {"session_id": session_id, "latency": breakdown}
    except Exception as exc:
        logger.error("Latency breakdown failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# Code Graph Endpoints — structural code analysis
# ===========================================================================

class GraphIndexRequest(BaseModel):
    project_path: str = Field(..., description="Path to the project to index")


@app.post("/graph/index")
async def index_project_graph(req: GraphIndexRequest) -> dict:
    """Index a project for structural code search.

    Parses all Python files in the project, extracts AST nodes
    (classes, functions, imports), builds a dependency graph, and
    persists the index to SQLite for fast querying.
    """
    try:
        from core.code_graph import CodeGraph
        graph = CodeGraph(req.project_path)
        stats = graph.index_project()
        return {"indexed": stats, "status": "ok"}
    except Exception as exc:
        logger.error("Graph indexing failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/graph/search")
async def search_code_graph(
    q: str = Query(..., description="Search query"),
    type: str = Query("hybrid", description="Query type: name, type, dependency, dependent, hybrid"),
    project_path: str = Query(".", description="Project path"),
) -> dict:
    """Search code by structure and semantics.

    Supports multiple query types:
    - **name**: Find entities by name (exact or prefix match)
    - **type**: Find by node type (class, function, import, variable)
    - **dependency**: Find what an entity depends on
    - **dependent**: Find what depends on an entity
    - **hybrid**: Combine all signals for best results
    """
    try:
        from core.code_graph import CodeGraph
        graph = CodeGraph(project_path)
        results = graph.search(q, query_type=type)
        return {"query": q, "query_type": type, "results": results, "count": len(results)}
    except Exception as exc:
        logger.error("Graph search failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/graph/context/{node_id:path}")
async def get_node_context(
    node_id: str = Path(..., description="Node ID (file:entity)"),
    depth: int = Query(2, ge=1, le=5, description="Context depth"),
    project_path: str = Query(".", description="Project path"),
) -> dict:
    """Get full structural context for a code entity.

    Returns the entity definition plus its dependencies, dependents,
    and sibling entities at the specified depth.
    """
    try:
        from core.code_graph import CodeGraph
        graph = CodeGraph(project_path)
        context = graph.get_context_for_node(node_id, depth=depth)
        return context
    except Exception as exc:
        logger.error("Context query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/graph/stats")
async def graph_stats(project_path: str = Query(".", description="Project path")) -> dict:
    """Get code graph statistics for a project."""
    try:
        from core.code_graph import CodeGraph
        graph = CodeGraph(project_path)
        return graph.get_stats()
    except Exception as exc:
        logger.error("Graph stats failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/graph/file/{file_path:path}")
async def get_file_structure(
    file_path: str = Path(..., description="Relative file path"),
    project_path: str = Query(".", description="Project path"),
) -> dict:
    """Get all AST entities in a single file."""
    try:
        from core.code_graph import CodeGraph
        graph = CodeGraph(project_path)
        entities = graph.get_file_structure(file_path)
        return {"file": file_path, "entities": entities, "count": len(entities)}
    except Exception as exc:
        logger.error("File structure query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# Hybrid Search Endpoint — RRF fusion of vector + structural results
# ===========================================================================

class HybridSearchRequest(BaseModel):
    query: str = Field(..., description="Search query text")
    project_path: str = Field(".", description="Project path for structural search")
    n_results: int = Field(10, ge=1, le=100, description="Number of results")
    query_type: str = Field("hybrid", description="Structural query type: name, type, dependency, dependent, hybrid")
    backends: Optional[List[str]] = Field(None, description="Backends to use: vector, structural, or both")


@app.post("/search/hybrid")
async def hybrid_search_endpoint(req: HybridSearchRequest) -> dict:
    """Hybrid search combining vector (ChromaDB) and structural (CodeGraph) results.

    Uses Reciprocal Rank Fusion (RRF) to merge results from both backends
    into a single ranked list.  Vector search captures semantic similarity
    while structural search captures AST-level and dependency relationships.

    When both backends return results for the same entity, the RRF score
    is combined, giving a boost to items found by both methods.
    """
    try:
        from core.hybrid_search import HybridSearchEngine
        engine = HybridSearchEngine()
        results = engine.search(
            query=req.query,
            project_path=req.project_path,
            n_results=req.n_results,
            query_type=req.query_type,
            backends=req.backends,
        )
        return {
            "query": req.query,
            "backends": req.backends or ["vector", "structural"],
            "results": [r.to_dict() for r in results],
            "count": len(results),
        }
    except Exception as exc:
        logger.error("Hybrid search failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


# ===========================================================================
# Sandbox Management Endpoints
# ===========================================================================

class SandboxCreateRequest(BaseModel):
    session_id: str = Field(..., description="Session ID to create sandbox for")
    project_path: str = Field(..., description="Project path to mount in sandbox")


@app.post("/sandbox/create")
async def create_sandbox(req: SandboxCreateRequest) -> dict:
    """Create an execution sandbox for a session.

    Tries Docker first; falls back to process-based sandbox if Docker
    is unavailable.
    """
    executor = _get_executor()
    session = executor.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    executor._init_sandbox(session)
    if executor._sandbox_manager is not None:
        sandbox = executor._sandbox_manager.get(req.session_id)
        if sandbox is not None:
            mode = type(sandbox).__name__
            return {"created": True, "session_id": req.session_id, "mode": mode}

    return {"created": False, "session_id": req.session_id, "mode": "none"}


@app.post("/sandbox/destroy/{session_id}")
async def destroy_sandbox(session_id: str) -> dict:
    """Destroy the execution sandbox for a session."""
    executor = _get_executor()
    if executor._sandbox_manager is not None:
        executor._sandbox_manager.destroy_session(session_id)
        return {"destroyed": True, "session_id": session_id}
    return {"destroyed": False, "session_id": session_id, "error": "No sandbox manager"}


@app.get("/sandbox/session/{session_id}")
async def sandbox_session_status(session_id: str) -> dict:
    """Get sandbox status for a specific session."""
    executor = _get_executor()
    if executor._sandbox_manager is not None:
        sandbox = executor._sandbox_manager.get(session_id)
        active = sandbox is not None
        mode = ""
        if active:
            mode = type(sandbox).__name__
        return {"session_id": session_id, "active": active, "mode": mode}
    return {"session_id": session_id, "active": False, "mode": "none"}


# ===========================================================================
# Shadow FS Endpoints — diff review, merge, discard
# ===========================================================================

@app.get("/agent/{session_id}/diffs")
async def agent_get_diffs(
    session_id: str = Path(..., description="The session ID"),
) -> dict:
    """Get all pending diffs from the session's shadow filesystem.

    Returns a list of diff objects for files that have been created,
    modified, or deleted in the shadow layer but not yet merged to disk.
    """
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.shadow_fs is None:
        return {"session_id": session_id, "diffs": [], "message": "No shadow FS for this session"}
    try:
        diffs = session.shadow_fs.get_all_diffs()
        return {"session_id": session_id, "diffs": diffs}
    except Exception as exc:
        logger.error("Failed to get diffs for session %s: %s", session_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/agent/{session_id}/merge")
async def agent_merge_shadow(
    session_id: str = Path(..., description="The session ID"),
) -> dict:
    """Merge all accepted shadow filesystem changes to disk.

    Writes all pending changes (created, modified, deleted files) from
    the shadow layer to the real filesystem. After merging, the shadow
    layer is reset to match the on-disk state.
    """
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.shadow_fs is None:
        raise HTTPException(
            status_code=400, detail="No shadow FS for this session"
        )
    try:
        results = session.shadow_fs.merge_to_disk()
        merged = [p for p, ok in results.items() if ok]
        failed = [p for p, ok in results.items() if not ok]
        logger.info(
            "Shadow merge for session %s: %d merged, %d failed",
            session_id,
            len(merged),
            len(failed),
        )
        return {
            "session_id": session_id,
            "status": "merged",
            "message": f"All shadow changes merged to disk ({len(merged)} files)",
            "merged": merged,
            "failed": failed,
        }
    except Exception as exc:
        logger.error("Failed to merge shadow for session %s: %s", session_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/agent/{session_id}/discard")
async def agent_discard_shadow(
    session_id: str = Path(..., description="The session ID"),
) -> dict:
    """Discard all shadow filesystem changes, reverting to on-disk state.

    Removes all pending changes from the shadow layer. The shadow is
    reset to match the real filesystem. No files on disk are affected.
    """
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.shadow_fs is None:
        raise HTTPException(
            status_code=400, detail="No shadow FS for this session"
        )
    try:
        session.shadow_fs.discard_changes()
        logger.info("Shadow discard for session %s", session_id)
        return {
            "session_id": session_id,
            "status": "discarded",
            "message": "All shadow changes discarded",
        }
    except Exception as exc:
        logger.error(
            "Failed to discard shadow for session %s: %s", session_id, exc
        )
        raise HTTPException(status_code=500, detail=str(exc))
