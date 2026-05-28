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
import time
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

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
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MEMORY_API_HOST = os.environ.get("MEMORY_API_HOST", "127.0.0.1")
MEMORY_API_PORT = int(os.environ.get("MEMORY_API_PORT", "8000"))

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

    # Warm up embedding model
    from memory import get_embedding_model
    get_embedding_model()
    logger.info("Embedding model warmed up.")

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

# CORS — allow Tauri frontend / local dev origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Tauri dev server
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "tauri://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class StartAgentResponse(BaseModel):
    session_id: str
    goal: str
    status: str
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
    """
    executor = _get_executor()
    try:
        session = await executor.start_session(
            goal=req.goal,
            project_path=req.project_path,
        )
        return {
            "session_id": session.id,
            "goal": session.goal,
            "status": session.status.value,
            "message": f"Agent session started with {len(session.tasks)} planned tasks",
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
# Dev entry-point
# ===========================================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=MEMORY_API_HOST,
        port=MEMORY_API_PORT,
        reload=True,
        log_level="info",
    )