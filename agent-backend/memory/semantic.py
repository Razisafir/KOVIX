"""
Semantic Memory Module for Construct AI Agent
Handles vector embeddings and similarity search using ChromaDB + sentence-transformers.

This module provides persistent vector storage for the Construct AI agent's memory
system. It uses ChromaDB for vector storage and sentence-transformers for generating
dense embeddings. The module supports conversation memory, code event tracking, and
hybrid search combining vector similarity with SQLite text search results.
"""

import os
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, asdict

# Import the shared LRU cache
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.cache import LRUCache

import chromadb
from chromadb.config import Settings
from chromadb.api import ClientAPI

# Lazy import of SentenceTransformer to avoid crash when offline
SentenceTransformer = None  # type: ignore


def _import_sentence_transformers():
    """Lazy import SentenceTransformer — only called when needed."""
    global SentenceTransformer
    if SentenceTransformer is None:
        try:
            from sentence_transformers import SentenceTransformer as ST
            SentenceTransformer = ST  # type: ignore
        except Exception:
            pass
    return SentenceTransformer is not None

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CHROMA_PATH: str = os.environ.get("CHROMA_PATH", "./resources/memory/vector")
EMBEDDING_MODEL: str = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

CONVERSATION_COLLECTION: str = "conversation_embeddings"
CODE_COLLECTION: str = "code_embeddings"

# ---------------------------------------------------------------------------
# Offline mode configuration
# ---------------------------------------------------------------------------
# CONSTRUCT_OFFLINE=1 disables embedding model loading and falls back to
# keyword search. This is critical for CI and air-gapped environments.
_OFFLINE_MODE: bool = os.environ.get("CONSTRUCT_OFFLINE", "").lower() in ("1", "true", "yes")

# ---------------------------------------------------------------------------
# Singletons (lazy-loaded)
# ---------------------------------------------------------------------------
_chroma_client: Optional[ClientAPI] = None
_embedding_model: Optional[Any] = None  # SentenceTransformer or None
_embedding_model_failed: bool = False  # True if loading failed
_query_cache: LRUCache = LRUCache(max_size=200, default_ttl=300)  # 5-min TTL


# ---------------------------------------------------------------------------
# Data classes (must be defined before _keyword_search which uses SearchResult)
# ---------------------------------------------------------------------------

@dataclass
class MemoryEntry:
    """Single memory entry for storage in the vector database."""
    id: str
    text: str
    source: str                 # "conversation" | "code" | "preference" | "context"
    timestamp: str
    metadata: Dict[str, Any]


@dataclass
class SearchResult:
    """Result from a semantic (vector) search."""
    id: str
    text: str
    source: str
    distance: float
    metadata: Dict[str, Any]
    relevance_score: float      # normalised 0-1


# ---------------------------------------------------------------------------
# Keyword search fallback (for offline mode)
# ---------------------------------------------------------------------------

def _keyword_search(query_text: str, n_results: int = 5) -> List[SearchResult]:
    """
    Fallback keyword search when embeddings are unavailable.
    Searches document text in ChromaDB using basic string matching.
    """
    results: List[SearchResult] = []
    query_lower = query_text.lower()
    query_terms = [t for t in query_lower.split() if len(t) > 2]

    if not query_terms:
        return results

    try:
        client = get_chroma_client()
        for collection_name in (CONVERSATION_COLLECTION, CODE_COLLECTION):
            try:
                collection = client.get_collection(name=collection_name)
            except Exception:
                continue

            # Get all documents (limited to 500 for performance)
            try:
                all_docs = collection.get(limit=500, include=["documents", "metadatas"])
            except Exception:
                continue

            ids = all_docs.get("ids", [])
            documents = all_docs.get("documents", [])
            metadatas = all_docs.get("metadatas", [])

            for i, doc_text in enumerate(documents):
                if not doc_text:
                    continue
                doc_lower = doc_text.lower()
                # Count matching terms
                matches = sum(1 for term in query_terms if term in doc_lower)
                if matches > 0:
                    score = min(0.95, 0.3 + (matches / len(query_terms)) * 0.65)
                    meta = metadatas[i] if i < len(metadatas) else {}
                    results.append(
                        SearchResult(
                            id=ids[i] if i < len(ids) else str(i),
                            text=doc_text,
                            source=meta.get("source", collection_name.replace("_embeddings", "")) if isinstance(meta, dict) else collection_name.replace("_embeddings", ""),
                            distance=1.0 - score,
                            metadata=meta if isinstance(meta, dict) else {},
                            relevance_score=score,
                        )
                    )

        # Sort by relevance (highest first) and limit
        results.sort(key=lambda r: r.relevance_score, reverse=True)
        return results[:n_results]

    except Exception as exc:
        logger.warning("Keyword search failed: %s", exc)
        return []

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    """Return an ISO-8601 UTC timestamp string."""
    return datetime.now(timezone.utc).isoformat()


def _source_to_collection(source: str) -> str:
    """Map a logical source name to the underlying collection name."""
    mapping: Dict[str, str] = {
        "conversation": CONVERSATION_COLLECTION,
        "code": CODE_COLLECTION,
    }
    return mapping.get(source, CONVERSATION_COLLECTION)


def _normalise_relevance(distance: float, max_distance: float = 2.0) -> float:
    """
    Convert a raw cosine *distance* into a 0-1 relevance score.

    With cosine distance (ChromaDB default) values range from 0 (identical) to 2
    (completely opposite).  We invert and normalise so that 1.0 == identical.
    """
    clamped = max(0.0, min(distance, max_distance))
    return 1.0 - (clamped / max_distance)


# ---------------------------------------------------------------------------
# 1. ChromaDB client
# ---------------------------------------------------------------------------

def get_chroma_client() -> ClientAPI:
    """
    Create (or return an existing) persistent ChromaDB client.

    The client is backed by SQLite on disk under ``CHROMA_PATH``.
    """
    global _chroma_client
    if _chroma_client is not None:
        return _chroma_client

    os.makedirs(CHROMA_PATH, exist_ok=True)

    _chroma_client = chromadb.PersistentClient(
        path=CHROMA_PATH,
        settings=Settings(
            anonymized_telemetry=False,
            allow_reset=True,
        ),
    )
    logger.info("ChromaDB client initialised at %s", CHROMA_PATH)
    return _chroma_client


# ---------------------------------------------------------------------------
# 2. Embedding model (lazy singleton)
# ---------------------------------------------------------------------------

def get_embedding_model() -> Optional[Any]:
    """
    Return the shared SentenceTransformer model instance.

    The model is loaded lazily on first call. If offline mode is enabled or
    the model fails to load, returns None (callers should use keyword fallback).
    """
    global _embedding_model, _embedding_model_failed

    # Already loaded
    if _embedding_model is not None:
        return _embedding_model

    # Already failed — don't retry
    if _embedding_model_failed or _OFFLINE_MODE:
        if _OFFLINE_MODE:
            logger.debug("Embedding model: offline mode (CONSTRUCT_OFFLINE=1)")
        return None

    # Try lazy import
    if not _import_sentence_transformers():
        logger.warning("sentence-transformers not installed — embeddings disabled")
        _embedding_model_failed = True
        return None

    try:
        logger.info("Loading embedding model: %s", EMBEDDING_MODEL)
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL)
        logger.info("Embedding model loaded successfully")
        return _embedding_model
    except Exception as exc:
        logger.warning("Failed to load embedding model: %s", exc)
        logger.warning("Semantic search will fall back to keyword matching. "
                       "Set CONSTRUCT_OFFLINE=1 to suppress this warning.")
        _embedding_model_failed = True
        return None


# ---------------------------------------------------------------------------
# Internal storage helpers
# ---------------------------------------------------------------------------

def _get_or_create_collection(collection_name: str) -> Any:
    """Fetch a ChromaDB collection, creating it if it does not yet exist."""
    client = get_chroma_client()
    return client.get_or_create_collection(name=collection_name)


def _embed_text(text: str) -> Optional[List[float]]:
    """
    Generate a dense embedding vector for *text*.

    Returns None if the embedding model is unavailable (offline mode).
    Callers should check for None and fall back to keyword search.
    """
    model = get_embedding_model()
    if model is None:
        return None
    embedding = model.encode(text, convert_to_numpy=True)
    return embedding.tolist()


# ---------------------------------------------------------------------------
# 3. Generic embedding storage
# ---------------------------------------------------------------------------

def store_embedding(
    text: str,
    source: str = "conversation",
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Embed *text* and persist it in the collection that corresponds to *source*.

    Parameters
    ----------
    text:
        The raw text to embed and store.
    source:
        Logical source bucket — ``"conversation"`` or ``"code"``.
    metadata:
        Optional extra metadata fields to store alongside the vector.

    Returns
    -------
    str
        The generated UUID for the stored entry.
    """
    if not text or not text.strip():
        raise ValueError("Cannot store empty text")

    memory_id = str(uuid.uuid4())
    timestamp = _now()

    collection_name = _source_to_collection(source)
    collection = _get_or_create_collection(collection_name)

    doc_metadata: Dict[str, Any] = {
        "source": source,
        "timestamp": timestamp,
        **(metadata or {}),
    }

    embedding = _embed_text(text)

    add_kwargs: Dict[str, Any] = {
        "ids": [memory_id],
        "documents": [text],
        "metadatas": [doc_metadata],
    }
    if embedding is not None:
        add_kwargs["embeddings"] = [embedding]

    collection.add(**add_kwargs)

    logger.debug("Stored %s embedding: %s", source, memory_id)
    return memory_id


# ---------------------------------------------------------------------------
# 4. Conversation message
# ---------------------------------------------------------------------------

def store_conversation_message(
    role: str,
    content: str,
    conversation_id: Optional[str] = None,
) -> str:
    """
    Store a single conversation turn in the conversation collection.

    Parameters
    ----------
    role:
        Speaker role — ``"user"`` or ``"assistant"``.
    content:
        The message body.
    conversation_id:
        Optional conversation thread UUID for grouping related messages.

    Returns
    -------
    str
        The memory entry UUID.
    """
    if not content or not content.strip():
        raise ValueError("Message content cannot be empty")

    memory_id = str(uuid.uuid4())
    timestamp = _now()

    collection = _get_or_create_collection(CONVERSATION_COLLECTION)

    metadata: Dict[str, Any] = {
        "timestamp": timestamp,
        "source": "conversation",
        "role": role,
    }
    if conversation_id:
        metadata["conversation_id"] = conversation_id

    embedding = _embed_text(content)

    add_kwargs: Dict[str, Any] = {
        "ids": [memory_id],
        "documents": [content],
        "metadatas": [metadata],
    }
    if embedding is not None:
        add_kwargs["embeddings"] = [embedding]

    collection.add(**add_kwargs)

    logger.debug("Stored conversation message from '%s': %s", role, memory_id)
    return memory_id


# ---------------------------------------------------------------------------
# 5. Code event
# ---------------------------------------------------------------------------

def store_code_event(
    file_path: str,
    change_type: str,
    summary: str,
    diff: Optional[str] = None,
) -> str:
    """
    Store a code-change event in the code-events collection.

    Parameters
    ----------
    file_path:
        Absolute or relative path of the affected file.
    change_type:
        One of ``"create"``, ``"modify"``, ``"delete"``, ``"rename"``.
    summary:
        Human-readable description of the change.
    diff:
        Optional diff/patch text for the change.

    Returns
    -------
    str
        The memory entry UUID.
    """
    if not summary or not summary.strip():
        raise ValueError("Summary cannot be empty")

    memory_id = str(uuid.uuid4())
    timestamp = _now()

    # The full text we embed is the summary + optional diff so that semantic
    # search can match against both the high-level description and the actual
    # code changes.
    full_text = summary
    if diff:
        full_text += f"\n\n{diff}"

    collection = _get_or_create_collection(CODE_COLLECTION)

    metadata: Dict[str, Any] = {
        "timestamp": timestamp,
        "source": "code",
        "file_path": file_path,
        "change_type": change_type,
    }

    embedding = _embed_text(full_text)

    add_kwargs: Dict[str, Any] = {
        "ids": [memory_id],
        "documents": [full_text],
        "metadatas": [metadata],
    }
    if embedding is not None:
        add_kwargs["embeddings"] = [embedding]

    collection.add(**add_kwargs)

    logger.debug(
        "Stored code event [%s] for '%s': %s", change_type, file_path, memory_id
    )
    return memory_id


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def _query_collection(
    collection_name: str,
    query_embedding: List[float],
    n_results: int = 5,
    where: Optional[Dict[str, Any]] = None,
) -> List[SearchResult]:
    """
    Run a vector search on a single collection and return typed results.

    Parameters
    ----------
    collection_name:
        Name of the ChromaDB collection to query.
    query_embedding:
        Pre-computed embedding vector for the query text.
    n_results:
        Maximum number of results to return.
    where:
        Optional ChromaDB metadata filter dict.

    Returns
    -------
    List[SearchResult]
        Search results sorted by relevance (most relevant first).
    """
    collection = _get_or_create_collection(collection_name)

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=n_results,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    output: List[SearchResult] = []

    ids = results.get("ids", [[]])
    docs = results.get("documents", [[]])
    metas = results.get("metadatas", [[]])
    distances = results.get("distances", [[]])

    # Handle both single-query and batch-query shapes
    for idx_list, doc_list, meta_list, dist_list in zip(ids, docs, metas, distances):
        for mem_id, doc, meta, dist in zip(idx_list, doc_list, meta_list, dist_list):
            distance = float(dist) if dist is not None else 0.0
            output.append(
                SearchResult(
                    id=mem_id,
                    text=doc or "",
                    source=meta.get("source", collection_name.replace("_embeddings", "")),
                    distance=distance,
                    metadata=meta or {},
                    relevance_score=_normalise_relevance(distance),
                )
            )

    # Sort by relevance descending (most relevant first)
    output.sort(key=lambda r: r.relevance_score, reverse=True)
    return output


# ---------------------------------------------------------------------------
# 6. Semantic search (all collections)
# ---------------------------------------------------------------------------

def query_similar(
    query_text: str,
    source_filter: Optional[str] = None,
    n_results: int = 5,
) -> List[SearchResult]:
    """
    Semantic search across all collections (or a single source).

    Results are cached for 5 minutes to avoid redundant embedding work.

    Parameters
    ----------
    query_text:
        The text query.
    source_filter:
        If provided, restrict to this source (``"conversation"`` or ``"code"``).
    n_results:
        Maximum number of results.

    Returns
    -------
    List[SearchResult]
        Results sorted by relevance, highest first.
    """
    if not query_text or not query_text.strip():
        raise ValueError("Query text cannot be empty")

    cache_key = (query_text, source_filter, n_results)
    cached = _query_cache.get(*cache_key)
    if cached is not None:
        logger.debug("query_similar cache hit for '%s...'", query_text[:40])
        return cached  # type: ignore[return-value]

    query_embedding = _embed_text(query_text)

    # Fallback to keyword search if embeddings unavailable (offline mode)
    if query_embedding is None:
        logger.debug("query_similar: embeddings unavailable, using keyword fallback")
        return _keyword_search(query_text, n_results=n_results)

    results: List[SearchResult] = []

    if source_filter:
        collection_name = _source_to_collection(source_filter)
        where = {"source": source_filter}
        results = _query_collection(
            collection_name, query_embedding, n_results=n_results, where=where
        )
    else:
        # Query both collections and merge
        conv_results = _query_collection(
            CONVERSATION_COLLECTION,
            query_embedding,
            n_results=n_results,
        )
        code_results = _query_collection(
            CODE_COLLECTION,
            query_embedding,
            n_results=n_results,
        )
        results = conv_results + code_results
        results.sort(key=lambda r: r.relevance_score, reverse=True)
        results = results[:n_results]

    _query_cache.set(results, *cache_key)
    logger.debug(
        "query_similar('%s...', filter=%s) → %d results (cached)",
        query_text[:40],
        source_filter,
        len(results),
    )
    return results


# ---------------------------------------------------------------------------
# 7. Query conversations only
# ---------------------------------------------------------------------------

def query_conversations(query_text: str, n_results: int = 5) -> List[SearchResult]:
    """
    Semantic search restricted to the conversation collection.

    Parameters
    ----------
    query_text:
        The text query.
    n_results:
        Maximum number of results.

    Returns
    -------
    List[SearchResult]
        Conversation results sorted by relevance.
    """
    if not query_text or not query_text.strip():
        raise ValueError("Query text cannot be empty")

    query_embedding = _embed_text(query_text)

    if query_embedding is None:
        logger.debug("query_conversations: embeddings unavailable, using keyword fallback")
        return _keyword_search(query_text, n_results=n_results)

    return _query_collection(
        CONVERSATION_COLLECTION, query_embedding, n_results=n_results
    )


# ---------------------------------------------------------------------------
# 8. Query code events only
# ---------------------------------------------------------------------------

def query_code_events(query_text: str, n_results: int = 5) -> List[SearchResult]:
    """
    Semantic search restricted to the code-events collection.

    Parameters
    ----------
    query_text:
        The text query.
    n_results:
        Maximum number of results.

    Returns
    -------
    List[SearchResult]
        Code event results sorted by relevance.
    """
    if not query_text or not query_text.strip():
        raise ValueError("Query text cannot be empty")

    query_embedding = _embed_text(query_text)

    if query_embedding is None:
        logger.debug("query_code_events: embeddings unavailable, using keyword fallback")
        return _keyword_search(query_text, n_results=n_results)

    return _query_collection(CODE_COLLECTION, query_embedding, n_results=n_results)


# ---------------------------------------------------------------------------
# 9. Delete memory
# ---------------------------------------------------------------------------

def delete_memory(memory_id: str, source: str = "conversation") -> bool:
    """
    Delete a memory entry by ID.

    Parameters
    ----------
    memory_id:
        The UUID of the entry to delete.
    source:
        The source collection the entry belongs to (used to determine the
        collection name).

    Returns
    -------
    bool
        ``True`` if the entry was found and deleted, ``False`` otherwise.
    """
    collection_name = _source_to_collection(source)
    collection = _get_or_create_collection(collection_name)

    try:
        collection.delete(ids=[memory_id])
        logger.debug("Deleted memory %s from %s", memory_id, collection_name)
        return True
    except Exception as exc:
        logger.warning("Failed to delete memory %s: %s", memory_id, exc)
        return False


# ---------------------------------------------------------------------------
# 10. Collection statistics
# ---------------------------------------------------------------------------

def get_collection_stats() -> Dict[str, Any]:
    """
    Return high-level statistics about the memory stores.

    Returns
    -------
    Dict[str, Any]
        Keys include ``total_memories``, ``collections``, ``model``, etc.
    """
    client = get_chroma_client()

    conv_collection = _get_or_create_collection(CONVERSATION_COLLECTION)
    code_collection = _get_or_create_collection(CODE_COLLECTION)

    conv_count = conv_collection.count()
    code_count = code_collection.count()

    stats: Dict[str, Any] = {
        "total_memories": conv_count + code_count,
        "collections": {
            CONVERSATION_COLLECTION: {
                "count": conv_count,
            },
            CODE_COLLECTION: {
                "count": code_count,
            },
        },
        "chroma_path": CHROMA_PATH,
        "embedding_model": EMBEDDING_MODEL,
        "version": "0.1.0",
    }

    logger.debug("Collection stats: %s", stats)
    return stats


# ---------------------------------------------------------------------------
# 11. Hybrid search (vector + SQLite text search fusion)
# ---------------------------------------------------------------------------

def hybrid_search(
    query_text: str,
    sqlite_results: List[Dict[str, Any]],
    n_results: int = 5,
) -> List[SearchResult]:
    """
    Combine SQLite full-text search with ChromaDB vector similarity.

    The algorithm:
    1. Run the vector search against both collections.
    2. For each SQLite text-match result, compute a vector embedding score
       by looking up its text in the vector results.
    3. Fuse the two ranking signals with a weighted reciprocal-rank score.
    4. Return the top *n_results*.

    Results are cached for 5 minutes to avoid redundant embedding work.

    Parameters
    ----------
    query_text:
        The text query.
    sqlite_results:
        Results from a SQLite full-text search.  Each dict must contain at
        least ``id`` and ``text`` keys, and optionally a ``score`` or
        ``rank`` key for the text-search score.
    n_results:
        Maximum number of results to return.

    Returns
    -------
    List[SearchResult]
        Fused and re-ranked results.
    """
    if not query_text or not query_text.strip():
        raise ValueError("Query text cannot be empty")

    cache_key = (query_text, tuple(sorted(frozenset(d.items()) for d in sqlite_results)), n_results)
    cached = _query_cache.get(*cache_key)
    if cached is not None:
        logger.debug("hybrid_search cache hit for '%s...'", query_text[:40])
        return cached  # type: ignore[return-value]

    # 1. Vector results (will fall back to keyword if embeddings unavailable)
    vector_results = query_similar(query_text, n_results=n_results * 3)

    # If we got keyword results (no embeddings), just return them
    if _embed_text(query_text) is None:
        _query_cache.set(vector_results, query_text, tuple(sorted(frozenset(d.items()) for d in sqlite_results)), n_results)
        return vector_results[:n_results]
    vector_rank: Dict[str, Tuple[int, SearchResult]] = {
        r.id: (i, r) for i, r in enumerate(vector_results)
    }

    # 2. SQLite text results → reciprocal rank
    sqlite_rank: Dict[str, Tuple[int, Dict[str, Any]]] = {}
    for i, row in enumerate(sqlite_results):
        row_id = str(row.get("id", ""))
        if row_id:
            sqlite_rank[row_id] = (i, row)

    # 3. Fusion: weighted reciprocal-rank score
    #    Higher weight on vector similarity because embeddings are generally
    #    more robust for semantic matching.
    VECTOR_WEIGHT = 0.7
    SQLITE_WEIGHT = 0.3

    fused: Dict[str, float] = {}

    for mem_id, (rank, v_result) in vector_rank.items():
        rr_vector = 1.0 / (rank + 1)
        rr_sqlite = 0.0
        if mem_id in sqlite_rank:
            rr_sqlite = 1.0 / (sqlite_rank[mem_id][0] + 1)
        fused[mem_id] = VECTOR_WEIGHT * rr_vector + SQLITE_WEIGHT * rr_sqlite

    for mem_id, (rank, s_row) in sqlite_rank.items():
        if mem_id not in fused:
            rr_sqlite = 1.0 / (rank + 1)
            rr_vector = 0.0
            if mem_id in vector_rank:
                rr_vector = 1.0 / (vector_rank[mem_id][0] + 1)
            fused[mem_id] = VECTOR_WEIGHT * rr_vector + SQLITE_WEIGHT * rr_sqlite

    # 4. Build final sorted list
    final: List[SearchResult] = []
    for mem_id in sorted(fused, key=lambda k: fused[k], reverse=True)[:n_results]:
        if mem_id in vector_rank:
            result = vector_rank[mem_id][1]
            result.relevance_score = fused[mem_id]
            final.append(result)
        elif mem_id in sqlite_rank:
            row = sqlite_rank[mem_id][1]
            final.append(
                SearchResult(
                    id=mem_id,
                    text=row.get("text", ""),
                    source=row.get("source", "unknown"),
                    distance=0.0,
                    metadata=row.get("metadata", {}),
                    relevance_score=fused[mem_id],
                )
            )

    _query_cache.set(final, query_text, tuple(sorted(frozenset(d.items()) for d in sqlite_results)), n_results)
    logger.debug(
        "hybrid_search('%s...', %d sqlite rows) → %d results (cached)",
        query_text[:40],
        len(sqlite_results),
        len(final),
    )
    return final