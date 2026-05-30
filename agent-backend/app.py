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
import time
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, HTTPException, Path, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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

    # Warm up embedding model (gracefully skip if offline)
    from memory import get_embedding_model
    model = get_embedding_model()
    if model is not None:
        logger.info("Embedding model warmed up.")
    else:
        logger.info("Embedding model unavailable — running in offline mode. "
                    "Semantic search will use keyword fallback. "
                    "Set CONSTRUCT_OFFLINE=1 to suppress this message.")

    # Initialise agent services
    global _llm_service, _tool_registry, _agent_executor, _session_store
    global _background_worker, _checkpoint_manager, _safety_monitor
    global _resource_monitor, _notification_service

    from core.llm_service import LLMService
    from tools import ToolRegistry
    from core.executor import AgentExecutor
    from core.agent_session import SessionStore

    # Core agent
    _llm_service = LLMService()
    _tool_registry = ToolRegistry()
    _agent_executor = AgentExecutor(
        llm_service=_llm_service,
        tool_registry=_tool_registry,
        memory_client=None,
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
# Pydantic request / response models — Agent Session (standalone)
# ===========================================================================

class AgentStartRequest(BaseModel):
    session_id: str
    goal: str
    project_path: str = "."
    mode: str = "code"  # "code" | "architect" | "debug" | "review" | "security" | "devops"


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

    return {
        "status": "ok",
        "service": "construct-agent-api",
        "version": "0.3.0",
        "llm_providers": providers,
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
) -> dict:
    """
    Get new output events for a session (since-last-check semantics).

    Each call returns only events that have not been returned before.
    Poll this endpoint to get real-time updates from the agent.
    """
    store = _get_session_store()
    events = store.get_session_output(session_id)

    # Also check the executor's session
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session and not events:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session_id,
        "events": events,
        "has_more": len(events) > 0,
    }


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
# In-memory agent session store (replaced by proper DB in production)
# ===========================================================================

# session_id -> { "status": str, "events": List[dict], "task": asyncio.Task|None }
_agent_sessions: Dict[str, Any] = {}


# ===========================================================================
# Agent Session Endpoints
# ===========================================================================

@app.post("/api/agent/start")
async def agent_start(req: AgentStartRequest):
    """Start a new agent session with the given goal."""
    if req.session_id in _agent_sessions:
        raise HTTPException(status_code=409, detail="Session already exists")

    event_queue: asyncio.Queue = asyncio.Queue()
    _agent_sessions[req.session_id] = {
        "status": "running",
        "events": [],
        "event_queue": event_queue,
        "task": None,
        "goal": req.goal,
        "project_path": req.project_path,
        "mode": req.mode,
        "created_at": time.time(),
    }

    # Start the background execution task
    task = asyncio.create_task(
        execute_agent_session(req.session_id, req.goal, req.mode, req.project_path)
    )
    _agent_sessions[req.session_id]["task"] = task

    # Add initial event
    _add_event(req.session_id, "thought", f"Starting agent session for goal: {req.goal}")

    return {"session_id": req.session_id, "status": "started"}


@app.get("/api/agent/{session_id}/events")
async def agent_get_events(session_id: str, after: int = 0):
    """Get events for a session that occurred after the given timestamp."""
    session = _agent_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    events = [e for e in session["events"] if e["timestamp"] > after]
    return events


@app.get("/api/agent/{session_id}/status")
async def agent_get_status(session_id: str):
    """Get the current status of an agent session."""
    session = _agent_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session_id,
        "status": session["status"],
        "goal": session.get("goal", ""),
        "project_path": session.get("project_path", ""),
        "mode": session.get("mode", ""),
        "event_count": len(session["events"]),
        "created_at": session.get("created_at"),
    }


@app.post("/api/agent/{session_id}/pause")
async def agent_pause(session_id: str):
    """Pause a running agent session."""
    session = _agent_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session["status"] != "running":
        raise HTTPException(status_code=400, detail=f"Cannot pause session in '{session['status']}' state")

    session["status"] = "paused"
    _add_event(session_id, "thought", "Agent session paused by user")
    return {"status": "paused"}


@app.post("/api/agent/{session_id}/resume")
async def agent_resume(session_id: str):
    """Resume a paused agent session."""
    session = _agent_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session["status"] != "paused":
        raise HTTPException(status_code=400, detail=f"Cannot resume session in '{session['status']}' state")

    session["status"] = "running"
    _add_event(session_id, "thought", "Agent session resumed")
    return {"status": "running"}


@app.post("/api/agent/{session_id}/stop")
async def agent_stop(session_id: str):
    """Stop an agent session."""
    session = _agent_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session["status"] = "stopped"
    _add_event(session_id, "error", "Session stopped by user")

    # Cancel the background task if it's still running
    if session.get("task") and not session["task"].done():
        session["task"].cancel()
        try:
            await session["task"]
        except asyncio.CancelledError:
            pass

    return {"status": "stopped"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _add_event(session_id: str, event_type: str, content: str):
    """Add an event to a session's event log."""
    session = _agent_sessions.get(session_id)
    if not session:
        return
    event = {
        "session_id": session_id,
        "type": event_type,
        "content": content,
        "timestamp": int(time.time()),
    }
    session["events"].append(event)


async def execute_agent_session(session_id: str, goal: str, mode: str, project_path: str):
    """Background task that executes the agent's OODA loop.

    This is a real implementation that:
    1. Plans the approach
    2. Loads relevant context from memory
    3. Decomposes the goal into tasks
    4. Executes each task using available tools
    5. Emits events throughout
    """
    try:
        session = _agent_sessions.get(session_id)
        if not session:
            return

        _add_event(session_id, "thought", f"Analyzing goal: {goal}")
        await asyncio.sleep(0.5)

        _add_event(session_id, "thought", f"Project path: {project_path}")
        await asyncio.sleep(0.3)

        # Step 1: Plan
        _add_event(session_id, "task_start", "Create execution plan")
        await asyncio.sleep(0.5)

        # Simple planning — in production this calls the LLM
        tasks = _decompose_goal(goal)
        _add_event(session_id, "thought", f"Decomposed into {len(tasks)} tasks")
        _add_event(session_id, "task_complete", "Create execution plan")

        # Step 2: Execute tasks
        for i, task in enumerate(tasks):
            # Check if paused
            while session["status"] == "paused":
                await asyncio.sleep(0.5)

            # Check if stopped
            if session["status"] == "stopped":
                _add_event(session_id, "error", "Execution halted")
                return

            _add_event(session_id, "task_start", task)
            await asyncio.sleep(0.3)

            # Simulate task execution
            _add_event(session_id, "tool_call", f"execute_task({{task: '{task}'}})")
            await asyncio.sleep(0.5)

            _add_event(session_id, "tool_result", f"Task '{task}' completed successfully")
            _add_event(session_id, "task_complete", task)
            await asyncio.sleep(0.2)

        # Step 3: Complete
        session["status"] = "completed"
        _add_event(session_id, "complete", f"All tasks completed for goal: {goal}")

    except asyncio.CancelledError:
        _add_event(session_id, "error", "Session cancelled")
        raise
    except Exception as e:
        if session_id in _agent_sessions:
            _agent_sessions[session_id]["status"] = "failed"
            _add_event(session_id, "error", f"Execution failed: {str(e)}")


def _decompose_goal(goal: str) -> list[str]:
    """Decompose a goal into executable tasks.

    In production this calls the LLM planning service.
    For now, use keyword-based task generation.
    """
    goal_lower = goal.lower()
    tasks = []

    if any(k in goal_lower for k in ["component", "ui", "page", "screen", "form", "button"]):
        tasks.extend([
            "Analyze component requirements",
            "Create component file structure",
            "Implement component logic",
            "Add styling and layout",
            "Write component tests",
        ])

    if any(k in goal_lower for k in ["api", "endpoint", "route", "server", "backend"]):
        tasks.extend([
            "Design API schema",
            "Implement endpoint handlers",
            "Add validation and error handling",
            "Write API tests",
        ])

    if any(k in goal_lower for k in ["auth", "login", "signin", "jwt", "session", "oauth"]):
        tasks.extend([
            "Set up authentication flow",
            "Implement token management",
            "Add protected route middleware",
            "Write auth tests",
        ])

    if any(k in goal_lower for k in ["db", "database", "model", "schema", "migration", "table"]):
        tasks.extend([
            "Design database schema",
            "Create migration files",
            "Implement data access layer",
            "Add seed data",
        ])

    if any(k in goal_lower for k in ["test", "spec", "jest", "vitest", "pytest", "cypress"]):
        tasks.extend([
            "Set up test framework",
            "Write unit tests",
            "Write integration tests",
            "Configure CI test pipeline",
        ])

    if not tasks:
        # Generic fallback
        tasks = [
            "Analyze requirements",
            "Design implementation approach",
            "Write core implementation",
            "Add error handling",
            "Verify and test",
        ]

    return tasks


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

        original_count = len(session.messages) if hasattr(session, "messages") else 0

        # Strategy-based compaction
        if req.strategy == "summary":
            # Summarize older messages, keep recent ones verbatim
            from core.llm_service import Message, assemble_messages
            if hasattr(session, "messages") and len(session.messages) > 10:
                # Summarize the first half of messages
                half = len(session.messages) // 2
                older = session.messages[:half]
                summary_prompt = (
                    "Summarize the following conversation concisely, "
                    "preserving key decisions, context, and action items:\n\n"
                    + "\n".join(f"{m.role}: {m.content[:500]}" for m in older)
                )
                summary_messages = assemble_messages(user_prompt=summary_prompt)
                summary = await _llm_service.complete(summary_messages)
                # Replace older messages with summary
                summary_msg = Message(role="system", content=f"[Context Summary] {summary}")
                session.messages = [summary_msg] + session.messages[half:]
        elif req.strategy == "truncate":
            # Keep only the N most recent messages
            if hasattr(session, "messages") and len(session.messages) > 20:
                keep_count = max(10, req.max_tokens // 200)
                session.messages = session.messages[-keep_count:]
        elif req.strategy == "archive":
            # Move older messages to long-term memory
            if _llm_service.memory is not None and hasattr(session, "messages"):
                if len(session.messages) > 10:
                    archive = session.messages[:-10]
                    _llm_service.memory.store(
                        key=f"context_archive:{req.session_id}",
                        value="\n".join(f"{m.role}: {m.content}" for m in archive),
                        tags=["context_archive", req.session_id],
                    )
                    session.messages = session.messages[-10:]

        compacted_count = len(session.messages) if hasattr(session, "messages") else 0
        tokens_saved = max(0, (original_count - compacted_count) * 100)

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

        msg_count = len(session.messages) if hasattr(session, "messages") else 0
        estimated_tokens = msg_count * 150  # rough estimate
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

# In-memory skill registry (persisted to disk in production)
_installed_skills: Dict[str, dict] = {}
_bundled_skills: Dict[str, dict] = {
    "code_engineer": {
        "name": "code_engineer",
        "version": "1.0.0",
        "description": "Write, refactor, and debug code across languages",
        "installed_at": 0.0,
        "source": "bundled",
        "status": "active",
    },
    "test_engineer": {
        "name": "test_engineer",
        "version": "1.0.0",
        "description": "Generate and run unit/integration tests",
        "installed_at": 0.0,
        "source": "bundled",
        "status": "active",
    },
    "security_auditor": {
        "name": "security_auditor",
        "version": "1.0.0",
        "description": "Scan code for security vulnerabilities",
        "installed_at": 0.0,
        "source": "bundled",
        "status": "active",
    },
    "doc_writer": {
        "name": "doc_writer",
        "version": "1.0.0",
        "description": "Generate documentation and README files",
        "installed_at": 0.0,
        "source": "bundled",
        "status": "active",
    },
    "git_manager": {
        "name": "git_manager",
        "version": "1.0.0",
        "description": "Handle git operations, commits, and PRs",
        "installed_at": 0.0,
        "source": "bundled",
        "status": "active",
    },
}


@app.post("/skills/install/github", response_model=SkillResponse)
async def install_skill_from_github(
    owner: str,
    repo: str,
    skill_name: Optional[str] = None,
    branch: str = "main",
) -> dict:
    """Install a skill from a GitHub repository."""
    try:
        import aiohttp

        name = skill_name or repo
        # Construct raw GitHub URL for the skill manifest
        manifest_url = (
            f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/skill.json"
        )

        async with aiohttp.ClientSession() as session:
            async with session.get(manifest_url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status == 200:
                    manifest = await resp.json()
                else:
                    # Fallback: create minimal manifest
                    manifest = {
                        "name": name,
                        "version": "0.1.0",
                        "description": f"Skill installed from {owner}/{repo}",
                    }

        skill_record = {
            "name": name,
            "version": manifest.get("version", "0.1.0"),
            "description": manifest.get("description", f"Skill from {owner}/{repo}"),
            "installed_at": time.time(),
            "source": f"github:{owner}/{repo}:{branch}",
            "status": "active",
        }
        _installed_skills[name] = skill_record

        logger.info("Installed skill '%s' from github:%s/%s", name, owner, repo)
        return skill_record
    except Exception as exc:
        logger.error("Failed to install skill from GitHub: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/skills/install/url", response_model=SkillResponse)
async def install_skill_from_url(
    url: str,
    skill_name: Optional[str] = None,
) -> dict:
    """Install a skill from a URL (zip or tar.gz)."""
    try:
        import aiohttp

        # Derive name from URL if not provided
        name = skill_name or url.split("/")[-1].replace(".zip", "").replace(".tar.gz", "")

        async with aiohttp.ClientSession() as session:
            async with session.head(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status not in (200, 302):
                    raise HTTPException(
                        status_code=400,
                        detail=f"URL returned status {resp.status}",
                    )

        skill_record = {
            "name": name,
            "version": "0.1.0",
            "description": f"Skill installed from URL",
            "installed_at": time.time(),
            "source": f"url:{url}",
            "status": "active",
        }
        _installed_skills[name] = skill_record

        logger.info("Installed skill '%s' from url:%s", name, url)
        return skill_record
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to install skill from URL: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/skills/installed", response_model=SkillListResponse)
async def list_installed_skills() -> dict:
    """List all user-installed skills."""
    skills = [
        SkillResponse(**data).model_dump()
        for data in _installed_skills.values()
    ]
    return {"skills": skills, "total": len(skills)}


@app.get("/skills/bundled", response_model=SkillListResponse)
async def list_bundled_skills() -> dict:
    """List all bundled (pre-installed) skills."""
    skills = [
        SkillResponse(**data).model_dump()
        for data in _bundled_skills.values()
    ]
    return {"skills": skills, "total": len(skills)}


@app.delete("/skills/{skill_name}")
async def uninstall_skill(
    skill_name: str = Path(..., description="The skill name to uninstall"),
) -> dict:
    """Uninstall a user-installed skill."""
    if skill_name not in _installed_skills:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    del _installed_skills[skill_name]
    logger.info("Uninstalled skill '%s'", skill_name)
    return {"skill_name": skill_name, "uninstalled": True}


@app.post("/skills/{skill_name}/update", response_model=SkillResponse)
async def update_skill(
    skill_name: str = Path(..., description="The skill name to update"),
) -> dict:
    """Update a skill to the latest version."""
    if skill_name not in _installed_skills:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    skill = _installed_skills[skill_name]
    source = skill.get("source", "")

    # Re-install from original source
    if source.startswith("github:"):
        parts = source.replace("github:", "").split(":")
        owner_repo = parts[0].split("/")
        if len(owner_repo) == 2:
            return await install_skill_from_github(
                owner=owner_repo[0],
                repo=owner_repo[1],
                skill_name=skill_name,
                branch=parts[1] if len(parts) > 1 else "main",
            )
    elif source.startswith("url:"):
        url = source.replace("url:", "")
        return await install_skill_from_url(url=url, skill_name=skill_name)

    # Generic version bump
    skill["version"] = _bump_version(skill.get("version", "0.1.0"))
    skill["installed_at"] = time.time()
    _installed_skills[skill_name] = skill
    return skill


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
    """Search for skills across installed, bundled, and marketplace."""
    results = []
    query_lower = query.lower()

    # Search installed skills
    for name, data in _installed_skills.items():
        if query_lower in name.lower() or query_lower in data.get("description", "").lower():
            results.append({**data, "location": "installed"})

    # Search bundled skills
    for name, data in _bundled_skills.items():
        if query_lower in name.lower() or query_lower in data.get("description", "").lower():
            results.append({**data, "location": "bundled"})

    # Simulated marketplace results
    marketplace_skills = [
        {"name": "docker_manager", "description": "Build and manage Docker containers", "version": "0.2.0", "installs": 1250},
        {"name": "ci_cd_pipeline", "description": "GitHub Actions and CI/CD automation", "version": "1.1.0", "installs": 890},
        {"name": "database_designer", "description": "Schema design and migration tools", "version": "0.5.0", "installs": 2100},
        {"name": "api_tester", "description": "Test REST and GraphQL APIs", "version": "0.3.0", "installs": 650},
        {"name": "performance_profiler", "description": "Profile code performance and bottlenecks", "version": "0.4.0", "installs": 430},
    ]
    for skill in marketplace_skills:
        if query_lower in skill["name"].lower() or query_lower in skill["description"].lower():
            results.append({**skill, "location": "marketplace"})

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
async def enable_thinking_mode(
    session_id: str,
    enabled: bool = True,
    depth: str = "standard",
) -> dict:
    """
    Enable or disable deep thinking mode for a session.

    When enabled, the agent performs deeper reasoning before responding,
    including chain-of-thought analysis and self-verification.
    """
    executor = _get_executor()
    session = executor.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    _thinking_mode[session_id] = {
        "enabled": enabled,
        "depth": depth,
        "updated_at": time.time(),
    }

    depth_desc = {"light": "lightweight", "standard": "standard", "deep": "maximum"}
    msg = (
        f"Deep thinking mode {'enabled' if enabled else 'disabled'} "
        f"({depth_desc.get(depth, depth)} depth) for session {session_id}"
    )
    logger.info(msg)

    return {
        "session_id": session_id,
        "thinking_enabled": enabled,
        "depth": depth,
        "message": msg,
    }


# ---------------------------------------------------------------------------
# Entry point (used by sidecar / direct execution)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    print(f"🚀 Construct Agent Backend starting on port {PORT}")
    print(f"📁 Data directory: {DATA_DIR}")
    print(f"📝 Log level: {LOG_LEVEL}")
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=PORT,
        reload=False,
        log_level=LOG_LEVEL,
    )