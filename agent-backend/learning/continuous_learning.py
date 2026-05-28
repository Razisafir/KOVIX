"""
Continuous Learning — Auto-extract patterns from agent sessions.

ECC v2-inspired instinct-based learning:
- Extract instincts from session logs
- Evaluate and score instincts
- Promote high-confidence instincts to skills
- Prune old/low-confidence instincts
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Instinct data model
# ---------------------------------------------------------------------------

class InstinctStatus(Enum):
    """Lifecycle status of an instinct."""

    ACTIVE = "active"
    PROMOTED = "promoted"  # Became a skill
    DEPRECATED = "deprecated"  # Low confidence, pending removal
    EXPIRED = "expired"  # TTL exceeded


@dataclass
class Instinct:
    """A learned pattern extracted from agent execution.

    An instinct represents a conditional action: "When <trigger>, do <action>".
    It carries evidence from past usage, a confidence score, and a TTL.

    Attributes:
        id: Unique instinct identifier (SHA-256 hash of trigger+action)
        trigger: Condition that activates this instinct
        action: Recommended action when trigger matches
        evidence: List of past application outcomes
        confidence: Computed confidence score (0.0 - 1.0)
        last_used: Unix timestamp of last application
        ttl_days: Time-to-live in days before pruning
        created_at: Unix timestamp of creation
        usage_count: Total times this instinct was applied
        success_count: Times the instinct led to success
        status: Current lifecycle status
        source_sessions: IDs of sessions that contributed evidence
    """

    id: str
    trigger: str
    action: str
    evidence: List[Dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    last_used: float = field(default_factory=time.time)
    ttl_days: int = 30
    created_at: float = field(default_factory=time.time)
    usage_count: int = 0
    success_count: int = 0
    status: InstinctStatus = InstinctStatus.ACTIVE
    source_sessions: List[str] = field(default_factory=list)

    # ------------------------------------------------------------------
    # Factory / helpers
    # ------------------------------------------------------------------

    @classmethod
    def generate_id(cls, trigger: str, action: str) -> str:
        """Generate a deterministic ID from trigger+action."""
        payload = f"{trigger}::{action}".encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:16]

    @classmethod
    def create(
        cls,
        trigger: str,
        action: str,
        session_id: Optional[str] = None,
        ttl_days: int = 30,
    ) -> "Instinct":
        """Create a new Instinct with a generated ID."""
        instinct = cls(
            id=cls.generate_id(trigger, action),
            trigger=trigger,
            action=action,
            ttl_days=ttl_days,
        )
        if session_id:
            instinct.source_sessions.append(session_id)
        return instinct

    def record_usage(self, success: bool, metadata: Optional[Dict[str, Any]] = None) -> None:
        """Record an application outcome for this instinct."""
        self.usage_count += 1
        if success:
            self.success_count += 1
        self.last_used = time.time()
        entry = {
            "timestamp": time.time(),
            "success": success,
            "metadata": metadata or {},
        }
        self.evidence.append(entry)
        # Recalculate confidence
        self.confidence = self._compute_confidence()

    def _compute_conficiency(self) -> float:
        """Alias for _compute_confidence for backward compatibility."""
        return self._compute_confidence()

    def _compute_confidence(self) -> float:
        """Compute confidence from success rate and recency."""
        if self.usage_count == 0:
            return 0.0
        base = self.success_count / self.usage_count
        age_days = (time.time() - self.last_used) / 86400
        recency = max(0.0, 1.0 - age_days / self.ttl_days)
        return base * 0.7 + recency * 0.3

    def is_expired(self) -> bool:
        """Check if the instinct has exceeded its TTL."""
        age = time.time() - self.created_at
        return age > self.ttl_days * 86400

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary (JSON-friendly)."""
        d = asdict(self)
        d["status"] = self.status.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Instinct":
        """Deserialize from dictionary."""
        # Handle enum
        status_str = data.get("status", "active")
        if isinstance(status_str, str):
            data = {**data, "status": InstinctStatus(status_str)}
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


# ---------------------------------------------------------------------------
# Continuous Learner
# ---------------------------------------------------------------------------

class ContinuousLearner:
    """Auto-extract and manage learned patterns from agent sessions.

    The learner:
    - Extracts instincts from session logs using pattern detection
    - Evaluates instinct confidence based on evidence
    - Clusters similar instincts into skill candidates
    - Promotes high-confidence clusters to skills
    - Prunes expired or low-confidence instincts
    """

    # Thresholds
    PROMOTION_CONFIDENCE: float = 0.8
    PROMOTION_USAGE: int = 5
    PRUNE_CONFIDENCE: float = 0.1
    CLUSTER_SIMILARITY: float = 0.7

    def __init__(self, storage_path: str = "resources/learning/instincts.json"):
        self.storage_path = storage_path
        self.instincts: List[Instinct] = []
        self._load_instincts()

    # ------------------------------------------------------------------
    # Extraction
    # ------------------------------------------------------------------

    def extract_instincts(self, session_log: List[Dict[str, Any]]) -> List[Instinct]:
        """Extract instincts from a completed session log.

        Pattern detection heuristics:
        1. Repeated sequences -> "When X, always do Y first"
        2. Successful patterns -> "Adding tests before commit leads to success"
        3. Error recovery -> "When test fails, check imports first"

        Args:
            session_log: Chronological list of log entries, each a dict
                         with at least 'action', 'result', 'timestamp'

        Returns:
            List of newly extracted instincts
        """
        new_instincts: List[Instinct] = []
        session_id = self._derive_session_id(session_log)

        if len(session_log) < 2:
            logger.debug("Session log too short for pattern extraction")
            return new_instincts

        # Pattern 1: Repeated action sequences
        seq_instincts = self._extract_sequence_patterns(session_log, session_id)
        new_instincts.extend(seq_instincts)

        # Pattern 2: Success-correlated actions
        success_instincts = self._extract_success_patterns(session_log, session_id)
        new_instincts.extend(success_instincts)

        # Pattern 3: Error recovery patterns
        recovery_instincts = self._extract_recovery_patterns(session_log, session_id)
        new_instincts.extend(recovery_instincts)

        # Merge with existing instincts (deduplicate by ID)
        existing_ids = {i.id for i in self.instincts}
        for inst in new_instincts:
            if inst.id in existing_ids:
                # Merge evidence into existing
                existing = next(i for i in self.instincts if i.id == inst.id)
                existing.evidence.extend(inst.evidence)
                existing.usage_count += inst.usage_count
                existing.success_count += inst.success_count
                existing.source_sessions.extend(inst.source_sessions)
                existing.confidence = existing._compute_confidence()
                logger.debug("Merged instinct %s into existing", inst.id)
            else:
                self.instincts.append(inst)
                existing_ids.add(inst.id)
                logger.info("New instinct extracted: %s", inst.trigger[:60])

        logger.info(
            "Extracted %d instincts from session %s", len(new_instincts), session_id
        )
        return new_instincts

    def _derive_session_id(self, session_log: List[Dict[str, Any]]) -> str:
        """Derive a stable session ID from log content."""
        if not session_log:
            return f"empty_{int(time.time())}"
        first_ts = session_log[0].get("timestamp", time.time())
        return f"sess_{int(first_ts)}_{len(session_log)}"

    def _extract_sequence_patterns(
        self,
        session_log: List[Dict[str, Any]],
        session_id: str,
    ) -> List[Instinct]:
        """Extract 'When X, do Y' patterns from repeated sequences."""
        instincts: List[Instinct] = []
        action_sequence = [entry.get("action", "") for entry in session_log]

        # Find bigrams that appear more than once
        bigram_counts: Dict[Tuple[str, str], int] = defaultdict(int)
        bigram_contexts: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)

        for i in range(len(action_sequence) - 1):
            bigram = (action_sequence[i], action_sequence[i + 1])
            bigram_counts[bigram] += 1
            bigram_contexts[bigram].append(session_log[i])

        for (action_a, action_b), count in bigram_counts.items():
            if count >= 2 and action_a and action_b:
                trigger = f"when performing '{action_a}'"
                instinct_action = f"follow with '{action_b}'"
                instinct = Instinct.create(
                    trigger=trigger,
                    action=instinct_action,
                    session_id=session_id,
                )
                # Seed initial evidence
                contexts = bigram_contexts[(action_a, action_b)]
                for ctx in contexts:
                    success = ctx.get("result") not in ("error", "failure", None)
                    instinct.record_usage(success=success, metadata={"pattern": "sequence"})
                instincts.append(instinct)

        return instincts

    def _extract_success_patterns(
        self,
        session_log: List[Dict[str, Any]],
        session_id: str,
    ) -> List[Instinct]:
        """Extract patterns correlated with successful outcomes."""
        instincts: List[Instinct] = []

        # Group entries by action, track success rate
        action_outcomes: Dict[str, List[bool]] = defaultdict(list)
        for entry in session_log:
            action = entry.get("action", "")
            result = entry.get("result", "")
            if action:
                success = result not in ("error", "failure", "timeout", None)
                action_outcomes[action].append(success)

        for action, outcomes in action_outcomes.items():
            success_rate = sum(outcomes) / len(outcomes)
            if success_rate >= 0.8 and len(outcomes) >= 2:
                trigger = f"when '{action}' is needed"
                instinct_action = f"use '{action}' (success rate: {success_rate:.0%})"
                instinct = Instinct.create(
                    trigger=trigger,
                    action=instinct_action,
                    session_id=session_id,
                )
                for success in outcomes:
                    instinct.record_usage(success=success, metadata={"pattern": "success"})
                instincts.append(instinct)

        return instincts

    def _extract_recovery_patterns(
        self,
        session_log: List[Dict[str, Any]],
        session_id: str,
    ) -> List[Instinct]:
        """Extract error recovery patterns: 'When error X, do Y'."""
        instincts: List[Instinct] = []

        for i in range(len(session_log) - 1):
            current = session_log[i]
            next_entry = session_log[i + 1]

            current_result = current.get("result", "")
            is_error = current_result in ("error", "failure", "timeout")

            if is_error:
                error_action = current.get("action", "unknown")
                recovery_action = next_entry.get("action", "unknown")
                recovery_success = next_entry.get("result") not in (
                    "error",
                    "failure",
                    None,
                )

                trigger = f"when '{error_action}' fails"
                instinct_action = f"try '{recovery_action}' next"
                instinct = Instinct.create(
                    trigger=trigger,
                    action=instinct_action,
                    session_id=session_id,
                )
                instinct.record_usage(
                    success=recovery_success,
                    metadata={"pattern": "recovery", "error_action": error_action},
                )
                instincts.append(instinct)

        return instincts

    # ------------------------------------------------------------------
    # Evaluation
    # ------------------------------------------------------------------

    def evaluate_instinct(self, instinct: Instinct) -> float:
        """Calculate a confidence score for an instinct.

        Formula: 70% success rate + 30% recency factor

        Args:
            instinct: The instinct to evaluate

        Returns:
            Confidence score between 0.0 and 1.0
        """
        return instinct._compute_confidence()

    # ------------------------------------------------------------------
    # Clustering
    # ------------------------------------------------------------------

    def cluster_instincts(self) -> List[Dict[str, Any]]:
        """Group similar instincts into skill candidates.

        Uses a simple text-similarity heuristic on triggers.

        Returns:
            List of cluster dictionaries with members and aggregate stats
        """
        if not self.instincts:
            return []

        # Simple greedy clustering by trigger similarity
        clusters: List[List[Instinct]] = []
        assigned: Set[str] = set()

        for instinct in self.instincts:
            if instinct.id in assigned:
                continue
            cluster = [instinct]
            assigned.add(instinct.id)

            for other in self.instincts:
                if other.id in assigned:
                    continue
                if self._trigger_similarity(instinct.trigger, other.trigger) >= self.CLUSTER_SIMILARITY:
                    cluster.append(other)
                    assigned.add(other.id)

            clusters.append(cluster)

        # Build result
        result = []
        for members in clusters:
            avg_confidence = sum(m.confidence for m in members) / len(members)
            total_usage = sum(m.usage_count for m in members)
            result.append({
                "id": f"cluster_{hash(members[0].id) % 10000:04d}",
                "size": len(members),
                "avg_confidence": round(avg_confidence, 3),
                "total_usage": total_usage,
                "triggers": [m.trigger for m in members],
                "actions": [m.action for m in members],
                "instinct_ids": [m.id for m in members],
            })

        logger.info("Clustered %d instincts into %d clusters", len(self.instincts), len(result))
        return sorted(result, key=lambda c: c["avg_confidence"], reverse=True)

    def _trigger_similarity(self, a: str, b: str) -> float:
        """Compute a simple Jaccard-like similarity between two triggers."""
        tokens_a = set(a.lower().split())
        tokens_b = set(b.lower().split())
        if not tokens_a or not tokens_b:
            return 0.0
        intersection = tokens_a & tokens_b
        union = tokens_a | tokens_b
        return len(intersection) / len(union)

    # ------------------------------------------------------------------
    # Skill evolution
    # ------------------------------------------------------------------

    def evolve_skills(self) -> List[Dict[str, Any]]:
        """Promote high-confidence instinct clusters to skills.

        Promotion criteria:
        - Average confidence > 0.8
        - Total usage count > 5

        Returns:
            List of newly promoted skills
        """
        clusters = self.cluster_instincts()
        promoted: List[Dict[str, Any]] = []

        for cluster in clusters:
            if (
                cluster["avg_confidence"] >= self.PROMOTION_CONFIDENCE
                and cluster["total_usage"] >= self.PROMOTION_USAGE
            ):
                skill = {
                    "id": f"skill_{cluster['id']}",
                    "name": self._generate_skill_name(cluster),
                    "confidence": cluster["avg_confidence"],
                    "total_usage": cluster["total_usage"],
                    "triggers": cluster["triggers"],
                    "actions": cluster["actions"],
                    "promoted_at": time.time(),
                }
                promoted.append(skill)

                # Mark member instincts as promoted
                for iid in cluster["instinct_ids"]:
                    instinct = next((i for i in self.instincts if i.id == iid), None)
                    if instinct:
                        instinct.status = InstinctStatus.PROMOTED

        logger.info("Promoted %d skills from %d clusters", len(promoted), len(clusters))
        return promoted

    def _generate_skill_name(self, cluster: Dict[str, Any]) -> str:
        """Generate a human-readable name for a skill cluster."""
        # Take the most common words from triggers
        words: Dict[str, int] = defaultdict(int)
        for trigger in cluster["triggers"]:
            for word in trigger.lower().split():
                if len(word) > 3 and word not in ("when", "with", "from", "that", "this"):
                    words[word] += 1
        top_words = sorted(words.items(), key=lambda x: x[1], reverse=True)[:3]
        return " ".join(w for w, _ in top_words).title() or "Generic Skill"

    # ------------------------------------------------------------------
    # Pruning
    # ------------------------------------------------------------------

    def prune_instincts(self) -> int:
        """Remove expired or low-confidence instincts.

        Removal criteria:
        - TTL exceeded (created_at + ttl_days < now)
        - Confidence below PRUNE_CONFIDENCE threshold
        - Status is already EXPIRED or DEPRECATED

        Returns:
            Number of instincts removed
        """
        now = time.time()
        before_count = len(self.instincts)

        self.instincts = [
            i
            for i in self.instincts
            if (
                not i.is_expired()
                and i.confidence > self.PRUNE_CONFIDENCE
                and i.status not in (InstinctStatus.EXPIRED, InstinctStatus.DEPRECATED)
            )
        ]

        removed = before_count - len(self.instincts)
        if removed:
            logger.info("Pruned %d instincts (remaining: %d)", removed, len(self.instincts))
        return removed

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save_instinct(self, instinct: Instinct) -> None:
        """Save an instinct to persistent storage.

        Immediately persists the full instinct set to disk.

        Args:
            instinct: The instinct to save (merged into current set)
        """
        # Replace or append
        existing = next((i for i in self.instincts if i.id == instinct.id), None)
        if existing:
            idx = self.instincts.index(existing)
            self.instincts[idx] = instinct
        else:
            self.instincts.append(instinct)

        self._persist()

    def _persist(self) -> None:
        """Write all instincts to disk as JSON."""
        try:
            os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
            data = [i.to_dict() for i in self.instincts]
            with open(self.storage_path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, default=str)
            logger.debug("Persisted %d instincts to %s", len(self.instincts), self.storage_path)
        except Exception:
            logger.exception("Failed to persist instincts to %s", self.storage_path)

    def _load_instincts(self) -> None:
        """Load instincts from disk."""
        if not os.path.isfile(self.storage_path):
            logger.debug("No instinct file at %s; starting fresh", self.storage_path)
            return

        try:
            with open(self.storage_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            self.instincts = [Instinct.from_dict(item) for item in data]
            logger.info(
                "Loaded %d instincts from %s", len(self.instincts), self.storage_path
            )
        except Exception:
            logger.exception("Failed to load instincts from %s", self.storage_path)
            self.instincts = []

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def find_applicable(self, situation: str, top_k: int = 3) -> List[Instinct]:
        """Find instincts whose trigger matches the current situation.

        Args:
            situation: Description of the current context
            top_k: Maximum number of results

        Returns:
            Best-matching instincts sorted by confidence
        """
        scored: List[Tuple[float, Instinct]] = []
        situation_words = set(situation.lower().split())

        for instinct in self.instincts:
            if instinct.status != InstinctStatus.ACTIVE:
                continue
            trigger_words = set(instinct.trigger.lower().split())
            overlap = len(situation_words & trigger_words)
            score = overlap * instinct.confidence
            if overlap > 0:
                scored.append((score, instinct))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [i for _, i in scored[:top_k]]

    def get_stats(self) -> Dict[str, Any]:
        """Return summary statistics about the instinct library."""
        statuses: Dict[str, int] = defaultdict(int)
        for i in self.instincts:
            statuses[i.status.value] += 1

        return {
            "total_instincts": len(self.instincts),
            "by_status": dict(statuses),
            "avg_confidence": round(
                sum(i.confidence for i in self.instincts) / len(self.instincts), 3
            ) if self.instincts else 0.0,
            "total_usage": sum(i.usage_count for i in self.instincts),
            "total_successes": sum(i.success_count for i in self.instincts),
            "storage_path": self.storage_path,
        }
