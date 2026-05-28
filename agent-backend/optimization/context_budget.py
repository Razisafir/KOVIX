"""
Context Budget — Token optimization and smart model selection.

- Track context window usage
- Auto-compact when approaching limits
- Route tasks to cheapest viable model
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Model tier definitions
# ---------------------------------------------------------------------------

class ModelTier(Enum):
    """Model capability / cost tiers."""

    FAST = "fast"          # Haiku, Ollama — cheap, fast
    BALANCED = "balanced"  # Sonnet, GPT-4o — good quality
    PREMIUM = "premium"    # Opus, GPT-4o — best quality


# Cost per 1M tokens (input, output) and tier mapping
MODEL_COSTS: Dict[str, Dict[str, Any]] = {
    "claude-haiku":   {"input": 0.25, "output": 1.25, "tier": ModelTier.FAST},
    "claude-sonnet":  {"input": 3.00, "output": 15.00, "tier": ModelTier.BALANCED},
    "claude-opus":    {"input": 15.00, "output": 75.00, "tier": ModelTier.PREMIUM},
    "gpt-4o":         {"input": 5.00, "output": 15.00, "tier": ModelTier.BALANCED},
    "gpt-4o-mini":    {"input": 0.15, "output": 0.60, "tier": ModelTier.FAST},
    "ollama":         {"input": 0.00, "output": 0.00, "tier": ModelTier.FAST},
}

# Rough token-per-char estimate
TOKENS_PER_CHAR: float = 0.25


# ---------------------------------------------------------------------------
# Context tracking
# ---------------------------------------------------------------------------

@dataclass
class ContextUsage:
    """Snapshot of current context window utilization.

    Attributes:
        tokens_used: Number of tokens currently consumed
        tokens_limit: Maximum tokens allowed
        compression_ratio: Used / limit ratio (0.0 - 1.0)
        priority_score: Average priority of retained items
    """

    tokens_used: int
    tokens_limit: int
    compression_ratio: float
    priority_score: float

    @property
    def tokens_remaining(self) -> int:
        """Tokens still available before hitting the limit."""
        return max(0, self.tokens_limit - self.tokens_used)

    @property
    def is_critical(self) -> bool:
        """True when context is near capacity (> 90%)."""
        return self.compression_ratio > 0.9

    @property
    def is_warning(self) -> bool:
        """True when context usage is elevated (> 75%)."""
        return self.compression_ratio > 0.75


@dataclass
class _ContextItem:
    """Internal representation of a context item with metadata."""

    content: str
    token_estimate: int
    priority: float  # 0.0 (low) to 1.0 (high)
    item_type: str  # system_prompt, tool_result, memory, conversation
    timestamp: float
    source: Optional[str] = None


# ---------------------------------------------------------------------------
# Context Budget
# ---------------------------------------------------------------------------

class ContextBudget:
    """Manage context window budget with auto-compaction.

    Tracks token usage, assigns priorities to context items, and
    automatically compacts low-priority items when approaching limits.

    Attributes:
        max_tokens: Hard context window limit
        warning_threshold: Ratio at which compaction warnings fire
        critical_threshold: Ratio at which forced compaction triggers
    """

    DEFAULT_MAX_TOKENS: int = 200_000
    WARNING_THRESHOLD: float = 0.75
    CRITICAL_THRESHOLD: float = 0.90

    def __init__(
        self,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        warning_threshold: Optional[float] = None,
        critical_threshold: Optional[float] = None,
    ):
        self.max_tokens = max_tokens
        self.warning_threshold = warning_threshold or self.WARNING_THRESHOLD
        self.critical_threshold = critical_threshold or self.CRITICAL_THRESHOLD
        self.current_usage = 0
        self.context_items: List[_ContextItem] = []

    # ------------------------------------------------------------------
    # Token estimation
    # ------------------------------------------------------------------

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Estimate token count from text length.

        Uses a simple character-based heuristic (0.25 tokens/char).
        More accurate estimators can be swapped in.

        Args:
            text: Input text to estimate

        Returns:
            Estimated token count
        """
        return max(1, int(len(text) * TOKENS_PER_CHAR))

    # ------------------------------------------------------------------
    # Usage tracking
    # ------------------------------------------------------------------

    def track_usage(self, new_tokens: int) -> ContextUsage:
        """Track new token usage and return current snapshot.

        Args:
            new_tokens: Additional tokens consumed

        Returns:
            ContextUsage snapshot after adding tokens
        """
        self.current_usage += new_tokens
        return self._snapshot()

    def _snapshot(self) -> ContextUsage:
        """Build a ContextUsage snapshot from current state."""
        ratio = min(1.0, self.current_usage / self.max_tokens) if self.max_tokens else 0.0
        avg_priority = (
            sum(i.priority for i in self.context_items) / len(self.context_items)
            if self.context_items else 0.5
        )
        return ContextUsage(
            tokens_used=self.current_usage,
            tokens_limit=self.max_tokens,
            compression_ratio=ratio,
            priority_score=round(avg_priority, 3),
        )

    # ------------------------------------------------------------------
    # Compaction
    # ------------------------------------------------------------------

    def suggest_compaction(self) -> List[str]:
        """Suggest which context items to compact or remove.

        Priority order for removal:
        1. Old successful tool results (> 5 min)
        2. Low-relevance memory items
        3. Verbose system prompts (compress)
        4. Duplicate information

        Returns:
            List of human-readable compaction suggestions
        """
        import time

        suggestions: List[str] = []
        now = time.time()

        # 1. Old successful tool results
        old_tool_results = [
            i for i in self.context_items
            if i.item_type == "tool_result"
            and (now - i.timestamp) > 300  # > 5 minutes
            and i.priority < 0.5
        ]
        if old_tool_results:
            suggestions.append(
                f"Remove {len(old_tool_results)} stale tool result(s) "
                f"(>{len(old_tool_results)} items older than 5 min)"
            )

        # 2. Low-relevance memory items
        low_mem = [i for i in self.context_items if i.item_type == "memory" and i.priority < 0.3]
        if low_mem:
            suggestions.append(
                f"Prune {len(low_mem)} low-priority memory item(s)"
            )

        # 3. Verbose system prompts
        verbose_prompts = [
            i for i in self.context_items
            if i.item_type == "system_prompt" and i.token_estimate > 2000
        ]
        if verbose_prompts:
            suggestions.append(
                f"Compress {len(verbose_prompts)} verbose system prompt(s) "
                f"({sum(i.token_estimate for i in verbose_prompts)} tokens)"
            )

        # 4. Duplicates
        seen: Dict[str, int] = {}
        duplicates = 0
        for i in self.context_items:
            content_hash = hash(i.content[:200])
            if content_hash in seen:
                duplicates += 1
            else:
                seen[content_hash] = 1
        if duplicates:
            suggestions.append(f"Remove {duplicates} duplicate context item(s)")

        return suggestions

    def auto_compact(self) -> int:
        """Automatically remove low-priority context items.

        Returns:
            Number of tokens freed
        """
        import time

        now = time.time()
        before = self.current_usage
        kept: List[_ContextItem] = []

        for item in self.context_items:
            should_keep = True

            # Remove old, low-priority tool results
            if item.item_type == "tool_result" and (now - item.timestamp) > 300:
                if item.priority < 0.4:
                    should_keep = False

            # Remove very low-priority memory
            elif item.item_type == "memory" and item.priority < 0.2:
                should_keep = False

            # Compress verbose items (cap at 1000 tokens worth)
            elif item.token_estimate > 2500:
                item.content = item.content[:4000] + "\n...[truncated]"
                item.token_estimate = self.estimate_tokens(item.content)

            if should_keep:
                kept.append(item)

        self.context_items = kept
        self.current_usage = sum(i.token_estimate for i in self.context_items)
        freed = before - self.current_usage

        if freed:
            logger.info("Auto-compaction freed %d tokens", freed)
        return freed

    # ------------------------------------------------------------------
    # Context management
    # ------------------------------------------------------------------

    def add_context(
        self,
        content: str,
        priority: float = 0.5,
        item_type: str = "conversation",
        source: Optional[str] = None,
    ) -> bool:
        """Add context if within budget; compact first if needed.

        Args:
            content: Text content to add
            priority: Importance score (0.0-1.0)
            item_type: Category tag for compaction logic
            source: Origin identifier

        Returns:
            True if the item was added successfully
        """
        import time

        tokens = self.estimate_tokens(content)
        projected = self.current_usage + tokens

        # If over critical threshold, auto-compact first
        if projected / self.max_tokens > self.critical_threshold:
            freed = self.auto_compact()
            projected -= freed

        # If still over limit, refuse
        if projected > self.max_tokens:
            logger.warning(
                "Context budget exceeded: %d + %d > %d",
                self.current_usage,
                tokens,
                self.max_tokens,
            )
            return False

        item = _ContextItem(
            content=content,
            token_estimate=tokens,
            priority=priority,
            item_type=item_type,
            timestamp=time.time(),
            source=source,
        )
        self.context_items.append(item)
        self.current_usage = projected

        # Warn if approaching limits
        ratio = self.current_usage / self.max_tokens
        if ratio > self.critical_threshold:
            logger.warning("Context at %.1f%% — critical", ratio * 100)
        elif ratio > self.warning_threshold:
            logger.info("Context at %.1f%% — warning", ratio * 100)

        return True

    def remove_context(self, source: str) -> int:
        """Remove all context items from a given source.

        Args:
            source: Source identifier to match

        Returns:
            Number of items removed
        """
        before = len(self.context_items)
        self.context_items = [i for i in self.context_items if i.source != source]
        removed = before - len(self.context_items)
        self.current_usage = sum(i.token_estimate for i in self.context_items)
        return removed

    def get_usage(self) -> ContextUsage:
        """Return current context usage snapshot."""
        return self._snapshot()

    def reset(self) -> None:
        """Clear all context and reset usage counters."""
        self.context_items.clear()
        self.current_usage = 0
        logger.info("Context budget reset")


# ---------------------------------------------------------------------------
# Model Router
# ---------------------------------------------------------------------------

class ModelRouter:
    """Smart model selection based on task complexity.

    Routes tasks to the cheapest viable model using heuristics:
    - Simple tasks (< 100 words) -> FAST tier
    - Standard coding -> BALANCED tier
    - Complex architecture -> PREMIUM tier
    - Background tasks -> cheapest available
    """

    # Keywords that signal complexity
    COMPLEXITY_KEYWORDS: Dict[str, List[str]] = {
        "premium": [
            "architecture", "design pattern", "system design", "refactor",
            "complex algorithm", "optimization", "performance critical",
            "security audit", "compliance", "cryptographic",
        ],
        "balanced": [
            "implement", "feature", "bug fix", "write code", "unit test",
            "integration", "api endpoint", "database migration", "component",
        ],
        "fast": [
            "summarize", "explain", "list", "quick", "simple", "hello",
            "format", "lint", "style", "typo",
        ],
    }

    def __init__(self, available_models: Optional[List[str]] = None):
        self.available = available_models or list(MODEL_COSTS.keys())
        # Validate against known models
        self.available = [m for m in self.available if m in MODEL_COSTS]
        if not self.available:
            self.available = ["claude-haiku"]  # fallback

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    def route(
        self,
        task_description: str,
        complexity_hint: Optional[str] = None,
    ) -> str:
        """Select the best model for a task.

        Args:
            task_description: Natural language description of the task
            complexity_hint: Optional override ("simple", "standard", "complex")

        Returns:
            Selected model identifier
        """
        task_lower = task_description.lower()

        # 1. Check explicit hint
        if complexity_hint:
            tier = self._hint_to_tier(complexity_hint)
            return self._cheapest_in_tier(tier)

        # 2. Check for premium keywords
        if any(kw in task_lower for kw in self.COMPLEXITY_KEYWORDS["premium"]):
            return self._cheapest_in_tier(ModelTier.PREMIUM)

        # 3. Check for fast keywords + short length
        word_count = len(task_description.split())
        if word_count < 100 and any(
            kw in task_lower for kw in self.COMPLEXITY_KEYWORDS["fast"]
        ):
            return self._cheapest_in_tier(ModelTier.FAST)

        # 4. Short tasks -> FAST
        if word_count < 50:
            return self._cheapest_in_tier(ModelTier.FAST)

        # 5. Balanced keywords or default
        if any(kw in task_lower for kw in self.COMPLEXITY_KEYWORDS["balanced"]):
            return self._cheapest_in_tier(ModelTier.BALANCED)

        # Default to balanced for safety
        return self._cheapest_in_tier(ModelTier.BALANCED)

    def _hint_to_tier(self, hint: str) -> ModelTier:
        """Convert a complexity hint string to a ModelTier."""
        hint_lower = hint.lower()
        if hint_lower in ("simple", "fast", "cheap", "quick"):
            return ModelTier.FAST
        if hint_lower in ("complex", "hard", "difficult", "premium", "best"):
            return ModelTier.PREMIUM
        return ModelTier.BALANCED

    def _cheapest_in_tier(self, tier: ModelTier) -> str:
        """Return the cheapest available model in a given tier."""
        candidates = [
            (name, info)
            for name, info in MODEL_COSTS.items()
            if name in self.available and info["tier"] == tier
        ]
        if not candidates:
            # Fallback: any available model
            return self.available[0]
        # Sort by combined input+output cost
        candidates.sort(key=lambda x: x[1]["input"] + x[1]["output"])
        return candidates[0][0]

    # ------------------------------------------------------------------
    # Cost estimation
    # ------------------------------------------------------------------

    def cost_estimate(self, task: str, model: str) -> Dict[str, Any]:
        """Estimate token cost for a task on a specific model.

        Args:
            task: Task description (used for token estimation)
            model: Model identifier

        Returns:
            Dictionary with estimated input tokens, output tokens,
            and cost in USD
        """
        if model not in MODEL_COSTS:
            return {"error": f"Unknown model: {model}"}

        info = MODEL_COSTS[model]
        input_tokens = ContextBudget.estimate_tokens(task)
        # Assume output is roughly 2x input for coding tasks
        output_tokens = input_tokens * 2

        input_cost = (input_tokens / 1_000_000) * info["input"]
        output_cost = (output_tokens / 1_000_000) * info["output"]

        return {
            "model": model,
            "tier": info["tier"].value,
            "estimated_input_tokens": input_tokens,
            "estimated_output_tokens": output_tokens,
            "input_cost_usd": round(input_cost, 6),
            "output_cost_usd": round(output_cost, 6),
            "total_cost_usd": round(input_cost + output_cost, 6),
        }

    def get_cheapest_viable(self, task: str) -> str:
        """Get the cheapest model that can handle the task.

        First determines the required tier via routing, then picks
        the cheapest model in that tier.

        Args:
            task: Task description

        Returns:
            Cheapest viable model identifier
        """
        required_tier = MODEL_COSTS[self.route(task)]["tier"]
        return self._cheapest_in_tier(required_tier)

    def compare_costs(self, task: str) -> List[Dict[str, Any]]:
        """Compare estimated costs across all available models.

        Args:
            task: Task description

        Returns:
            List of cost estimates sorted by total cost
        """
        estimates = []
        for model in self.available:
            est = self.cost_estimate(task, model)
            if "error" not in est:
                estimates.append(est)
        estimates.sort(key=lambda x: x["total_cost_usd"])
        return estimates

    def list_models(self) -> List[Dict[str, Any]]:
        """Return metadata for all available models."""
        return [
            {
                "name": name,
                "tier": info["tier"].value,
                "input_cost_per_1m": info["input"],
                "output_cost_per_1m": info["output"],
            }
            for name, info in MODEL_COSTS.items()
            if name in self.available
        ]
