"""Build Python backend as standalone executable for Tauri sidecar.

Usage:
    cd agent-backend
    pip install pyinstaller
    python build_sidecar.py

Output:
    ../src/main/bin/agent-backend  (or agent-backend.exe on Windows)

The binary is placed where sidecar.rs expects it.  On CI the file is
then renamed with the Rust target-triple suffix that Tauri requires
(e.g. agent-backend-x86_64-unknown-linux-gnu).
"""
from __future__ import annotations

import os
import platform
import shutil
import sys

import PyInstaller.__main__


def _target_triple() -> str:
    """Return the Rust-style target triple for the current platform."""
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "linux":
        if machine in ("x86_64", "amd64"):
            return "x86_64-unknown-linux-gnu"
        if machine in ("aarch64", "arm64"):
            return "aarch64-unknown-linux-gnu"
    elif system == "darwin":
        if machine in ("arm64", "aarch64"):
            return "aarch64-apple-darwin"
        if machine in ("x86_64", "amd64"):
            return "x86_64-apple-darwin"
    elif system == "windows":
        if machine in ("x86_64", "amd64"):
            return "x86_64-pc-windows-msvc"

    # Fallback — use whatever PyInstaller produces
    return ""


def build() -> None:
    """Build the Python backend as a single-file executable."""
    dist_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src", "main", "bin"))
    os.makedirs(dist_dir, exist_ok=True)

    # Collect hidden imports that PyInstaller cannot detect automatically.
    # These are all runtime-imported modules used by the FastAPI backend.
    hidden_imports = [
        "uvicorn",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "fastapi",
        "pydantic",
        "aiohttp",
        "sentence_transformers",
        "chromadb",
        "chromadb.config",
        "core.executor",
        "core.llm_service",
        "tools",
        "memory.semantic",
        "agents.orchestrator",
        "agents.roles",
        "agents.roles.code_engineer",
        "agents.roles.test_engineer",
        "agents.roles.security_auditor",
        "agents.roles.devops_engineer",
        "agents.roles.architect",
        "agents.roles.reviewer",
        "agents.roles.researcher",
    ]

    args = [
        "app.py",
        "--name", "agent-backend",
        "--onefile",
    ]

    for imp in hidden_imports:
        args += ["--hidden-import", imp]

    # Bundle requirements.txt so the running sidecar can report its deps
    req_file = os.path.join(os.path.dirname(__file__), "requirements.txt")
    if os.path.isfile(req_file):
        args += ["--add-data", f"{req_file}{os.pathsep}."]

    args += [
        "--distpath", dist_dir,
        "--workpath", os.path.join(os.path.dirname(__file__), "build"),
        "--specpath", os.path.join(os.path.dirname(__file__), "build"),
        "--noconfirm",
        "--clean",
    ]

    print(f"[build_sidecar] Running PyInstaller with args:")
    for a in args:
        print(f"  {a}")

    PyInstaller.__main__.run(args)

    # ── Rename with target-triple suffix (Tauri sidecar convention) ──
    triple = _target_triple()
    ext = ".exe" if platform.system() == "Windows" else ""
    base_binary = os.path.join(dist_dir, f"agent-backend{ext}")

    if not os.path.isfile(base_binary):
        raise RuntimeError(f"Build failed — binary not found at {base_binary}")

    size_mb = os.path.getsize(base_binary) // (1024 * 1024)
    print(f"[build_sidecar] Built: {base_binary} ({size_mb} MB)")

    if triple:
        triple_name = f"agent-backend-{triple}{ext}"
        triple_path = os.path.join(dist_dir, triple_name)
        shutil.copy2(base_binary, triple_path)
        print(f"[build_sidecar] Copied to: {triple_path}")
    else:
        print("[build_sidecar] Could not determine target triple — "
              "binary left without triple suffix. CI will handle renaming.")


if __name__ == "__main__":
    build()
