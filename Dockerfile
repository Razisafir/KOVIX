# ═══════════════════════════════════════════════════════════════════════════════
# Construct AI Agent — Multi-Stage Dockerfile
# ═══════════════════════════════════════════════════════════════════════════════
# Usage:
#   docker build -t construct .
#   docker run -p 8000:8000 -p 3000:3000 construct
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Stage 1: Frontend Build ─────────────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY . .
RUN npx vite build

# ─── Stage 2: Python Backend ─────────────────────────────────────────────────
FROM python:3.12-slim AS backend
WORKDIR /app

# Install system dependencies for ML libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY agent-backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY agent-backend/ .

# Copy built frontend from stage 1
COPY --from=frontend /app/dist /app/static

# Create data directories
RUN mkdir -p /app/resources/skills /app/data

# Environment
ENV PYTHONUNBUFFERED=1
ENV DATABASE_URL=sqlite:///app/data/construct.db
ENV CHROMA_PERSIST_DIR=/app/data/vector
ENV STATIC_DIR=/app/static
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
