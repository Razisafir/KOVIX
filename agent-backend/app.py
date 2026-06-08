"""
CONSTRUCT IDE - Python AI Backend
FastAPI server that provides AI agent capabilities to the IDE.
Started by ConstructService (Node layer) via uvicorn.

Copyright (c) 2025 Razisafir. All rights reserved.
CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import time
import os

app = FastAPI(title="CONSTRUCT AI Backend", version="1.0.0")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:*", "vscode-webview://*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Track startup time for health reporting
_start_time = time.time()


@app.get("/health")
async def health_check():
    """
    P0: Health check endpoint.
    The Node layer uses this to detect if the Python backend has crashed.
    Returns process info and uptime for diagnostics.
    """
    return {
        "status": "healthy",
        "uptime_seconds": round(time.time() - _start_time, 1),
        "pid": os.getpid(),
        "version": "1.0.0",
        "python_version": os.sys.version,
    }


@app.get("/ready")
async def readiness_check():
    """
    Readiness check - confirms the backend can handle requests.
    """
    return {"ready": True}


@app.get("/v1/models")
async def list_models():
    """
    List available models from the backend.
    """
    # TODO: Integrate with actual model registry
    return {
        "data": [
            {"id": "construct-agent-v1", "object": "model", "owned_by": "construct"},
        ]
    }


@app.post("/v1/chat/completions")
async def chat_completions():
    """
    Chat completions endpoint - proxied from the IDE.
    TODO: Implement full agent loop with tool execution.
    """
    return {"choices": [{"message": {"role": "assistant", "content": "Agent backend running"}}]}
