"""
Skill Executor — Execute skills step-by-step with the agent's tool system.

This module provides:
- Full skill execution with per-step error handling
- Recovery strategies (retry, skip, abort, adapt)
- Step validation against criteria
- Automatic skill adaptation for project context
- Integration with the existing :class:`ToolRegistry`.

Example::

    from skills import SkillExecutor, SkillManager

    manager = SkillManager()
    executor = SkillExecutor(manager)

    result = await executor.execute("react_component_testing")
    print(f"Completed {result.steps_completed}/{result.steps_total} steps")
"""

from __future__ import annotations

import time
import logging
from enum import Enum
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .skill_parser import Skill, SkillCategory, SkillStep
from .skill_manager import SkillManager

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Recovery strategy
# ---------------------------------------------------------------------------


class RecoveryStrategy(Enum):
    """Action to take when a step fails."""

    RETRY = "retry"       # Re-run the failed step
    SKIP = "skip"         # Skip to the next step
    ABORT = "abort"       # Stop execution immediately
    ADAPT = "adapt"       # Modify the skill and retry


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------


@dataclass
class StepResult:
    """Result of executing a single skill step."""

    success: bool
    output: str = ""
    error: Optional[str] = None
    duration_ms: int = 0
    step_index: int = 0
    step_action: str = ""
    recovery_strategy: Optional[RecoveryStrategy] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "output": self.output[:500] if self.output else "",
            "error": self.error,
            "duration_ms": self.duration_ms,
            "step_index": self.step_index,
            "step_action": self.step_action,
            "recovery_strategy": (
                self.recovery_strategy.value if self.recovery_strategy else None
            ),
        }


@dataclass
class ExecutionResult:
    """Result of executing a complete skill."""

    success: bool
    skill_name: str
    steps_completed: int
    steps_failed: int
    steps_total: int
    output: str = ""
    errors: List[str] = field(default_factory=list)
    step_results: List[StepResult] = field(default_factory=list)
    duration_ms: int = 0
    adapted: bool = False  # True if the skill was auto-adapted

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "skill_name": self.skill_name,
            "steps_completed": self.steps_completed,
            "steps_failed": self.steps_failed,
            "steps_total": self.steps_total,
            "output": self.output[:1000] if self.output else "",
            "errors": self.errors,
            "step_results": [sr.to_dict() for sr in self.step_results],
            "duration_ms": self.duration_ms,
            "adapted": self.adapted,
        }


# ---------------------------------------------------------------------------
# Tool registry integration helper
# ---------------------------------------------------------------------------


def _get_tool_registry() -> Any:
    """Import and return the default tool registry singleton.

    Returns
    -------
    ToolRegistry
        The default tool registry from ``tools``.
    """
    try:
        from tools import get_registry

        return get_registry()
    except ImportError:
        logger.warning("Tool registry not available — tool execution disabled")
        return None


# ---------------------------------------------------------------------------
# Skill Executor
# ---------------------------------------------------------------------------


class SkillExecutor:
    """Execute skills step-by-step with error handling and recovery.

    Parameters
    ----------
    skill_manager:
        The :class:`SkillManager` used to load skills.
    tool_registry:
        Optional tool registry override. If *None*, the default
        registry from ``tools`` is used.
    max_retries:
        Maximum number of retry attempts per step.
    retry_delay_ms:
        Delay between retries in milliseconds.
    """

    def __init__(
        self,
        skill_manager: SkillManager,
        tool_registry: Optional[Any] = None,
        max_retries: int = 2,
        retry_delay_ms: int = 1000,
    ) -> None:
        self.manager = skill_manager
        self._registry = tool_registry or _get_tool_registry()
        self.max_retries = max_retries
        self.retry_delay_ms = retry_delay_ms

    # -- Skill loading --------------------------------------------------------

    def load_skill(self, name: str) -> Skill:
        """Load a skill by name from the skill manager.

        Parameters
        ----------
        name:
            The skill name (slug).

        Returns
        -------
        Skill
            The loaded skill.

        Raises
        ------
        ValueError
            If the skill is not found.
        """
        skill = self.manager.get_skill(name)
        if not skill:
            raise ValueError(
                f"Skill not found: '{name}'. "
                f"Available: {[s.name for s in self.manager.list_skills()]}"
            )
        logger.info("Loaded skill: %s (%d steps)", skill.name, len(skill.steps))
        return skill

    # -- Execution ------------------------------------------------------------

    async def execute(
        self, skill_name: str, context: Optional[Dict[str, Any]] = None
    ) -> ExecutionResult:
        """Execute all steps of a skill.

        Parameters
        ----------
        skill_name:
            Name of the skill to execute.
        context:
            Optional execution context (variables, project info, etc.)
            that is merged into step parameters.

        Returns
        -------
        ExecutionResult
            Complete execution result with per-step details.
        """
        ctx = context or {}
        start_time = time.time()

        try:
            skill = self.load_skill(skill_name)
        except ValueError as exc:
            return ExecutionResult(
                success=False,
                skill_name=skill_name,
                steps_completed=0,
                steps_failed=0,
                steps_total=0,
                errors=[str(exc)],
            )

        # Auto-adapt if context is provided
        adapted_skill = skill
        adapted = False
        if ctx:
            adapted_skill = self.auto_adapt(skill, ctx)
            adapted = adapted_skill is not skill

        step_results: List[StepResult] = []
        completed = 0
        failed = 0
        outputs: List[str] = []

        for idx, step in enumerate(adapted_skill.steps):
            # Merge context into step parameters
            merged_params = self._merge_params(step.parameters, ctx)
            merged_step = SkillStep(
                order=step.order,
                action=step.action,
                description=step.description,
                tool=step.tool,
                parameters=merged_params,
                validation=step.validation,
            )

            result = await self.execute_step(adapted_skill, idx, ctx)
            step_results.append(result)

            if result.success:
                completed += 1
                if result.output:
                    outputs.append(result.output)
            else:
                failed += 1
                logger.warning(
                    "Step %d failed: %s — applying recovery strategy",
                    idx,
                    result.error,
                )

                # Determine and apply recovery strategy
                strategy = self.handle_error(adapted_skill, idx, result.error or "")
                result.recovery_strategy = strategy

                if strategy == RecoveryStrategy.RETRY:
                    retry_result = await self._retry_step(
                        adapted_skill, idx, ctx
                    )
                    if retry_result.success:
                        completed += 1
                        failed -= 1
                        if retry_result.output:
                            outputs.append(retry_result.output)
                    else:
                        outputs.append(f"[Retry failed] {retry_result.error}")

                elif strategy == RecoveryStrategy.SKIP:
                    outputs.append(f"[Skipped step {idx}] {step.action}")
                    continue

                elif strategy == RecoveryStrategy.ADAPT:
                    adapted_skill = self.auto_adapt(adapted_skill, ctx)
                    adapted = True
                    # Re-run from current step with adapted skill
                    retry_result = await self.execute_step(
                        adapted_skill, idx, ctx
                    )
                    if retry_result.success:
                        completed += 1
                        failed -= 1
                    else:
                        outputs.append(f"[Adapt+retry failed] {retry_result.error}")

                elif strategy == RecoveryStrategy.ABORT:
                    outputs.append(f"[ABORTED at step {idx}]")
                    break

        total_ms = int((time.time() - start_time) * 1000)
        overall_success = failed == 0 and completed > 0

        # If all steps failed, mark as failure
        if completed == 0 and len(adapted_skill.steps) > 0:
            overall_success = False

        return ExecutionResult(
            success=overall_success,
            skill_name=skill_name,
            steps_completed=completed,
            steps_failed=failed,
            steps_total=len(adapted_skill.steps),
            output="\n".join(outputs),
            errors=[sr.error for sr in step_results if sr.error],
            step_results=step_results,
            duration_ms=total_ms,
            adapted=adapted,
        )

    async def execute_step(
        self,
        skill: Skill,
        step_index: int,
        context: Optional[Dict[str, Any]] = None,
    ) -> StepResult:
        """Execute a single step of a skill.

        Parameters
        ----------
        skill:
            The skill containing the step.
        step_index:
            Zero-based index of the step to execute.
        context:
            Optional context for parameter merging.

        Returns
        -------
        StepResult
            Result of the step execution.
        """
        if step_index < 0 or step_index >= len(skill.steps):
            return StepResult(
                success=False,
                error=f"Step index {step_index} out of range (0-{len(skill.steps) - 1})",
                step_index=step_index,
            )

        step = skill.steps[step_index]
        ctx = context or {}
        start_time = time.time()

        logger.info(
            "Executing step %d/%d: %s (tool=%s)",
            step_index + 1,
            len(skill.steps),
            step.action,
            step.tool,
        )

        error: Optional[str] = None
        output: str = ""
        success: bool = False

        try:
            # Merge context into parameters
            params = self._merge_params(step.parameters, ctx)

            if step.tool and self._registry and self._registry.has_tool(step.tool):
                # Execute via tool registry
                tool_result = self._registry.execute_tool(step.tool, params)

                if isinstance(tool_result, dict):
                    success = tool_result.get("success", True)
                    output = str(tool_result.get("output", tool_result))
                    error = tool_result.get("error")
                else:
                    success = True
                    output = str(tool_result)
                    error = None

            elif step.tool:
                # Tool specified but not available in registry
                output = f"[Tool '{step.tool}' not available in registry]"
                error = f"Tool '{step.tool}' not found"
                success = False
            else:
                # No tool specified — informational step
                output = step.description
                success = True

            duration_ms = int((time.time() - start_time) * 1000)

            # Run validation if specified
            if step.validation and success:
                success = self.validate_step(step, output)
                if not success:
                    error = f"Validation failed: {step.validation}"

            return StepResult(
                success=success,
                output=output,
                error=error,
                duration_ms=duration_ms,
                step_index=step_index,
                step_action=step.action,
            )

        except Exception as exc:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.exception("Step %d execution failed: %s", step_index, exc)
            return StepResult(
                success=False,
                output="",
                error=f"{type(exc).__name__}: {exc}",
                duration_ms=duration_ms,
                step_index=step_index,
                step_action=step.action,
            )

    # -- Error handling -------------------------------------------------------

    def handle_error(
        self, skill: Skill, step_index: int, error: str
    ) -> RecoveryStrategy:
        """Determine the recovery strategy for a failed step.

        Heuristics:
        - Network/timeout errors -> RETRY
        - Tool not found -> SKIP (with warning)
        - Validation errors -> ADAPT
        - Last step or critical -> ABORT
        - Otherwise -> RETRY once, then SKIP

        Parameters
        ----------
        skill:
            The skill being executed.
        step_index:
            Index of the failed step.
        error:
            Error message from the failed step.

        Returns
        -------
        RecoveryStrategy
            The chosen recovery strategy.
        """
        error_lower = (error or "").lower()
        is_last_step = step_index >= len(skill.steps) - 1

        # Timeout / connection -> retry
        retry_keywords = [
            "timeout", "connection", "network", "temporarily",
            "rate limit", "503", "502", "504",
        ]
        if any(kw in error_lower for kw in retry_keywords):
            logger.info("Recovery: RETRY (network/timeout error)")
            return RecoveryStrategy.RETRY

        # Tool not found -> skip
        if "not found" in error_lower or "not available" in error_lower:
            logger.info("Recovery: SKIP (tool unavailable)")
            return RecoveryStrategy.SKIP

        # Validation failure -> adapt
        if "validation" in error_lower or "assert" in error_lower:
            logger.info("Recovery: ADAPT (validation failure)")
            return RecoveryStrategy.ADAPT

        # Permission / auth -> abort
        if "permission" in error_lower or "unauthorized" in error_lower or "403" in error_lower:
            logger.info("Recovery: ABORT (permission denied)")
            return RecoveryStrategy.ABORT

        # Last step -> skip rather than retry (almost done)
        if is_last_step:
            logger.info("Recovery: SKIP (last step)")
            return RecoveryStrategy.SKIP

        # Default: retry
        logger.info("Recovery: RETRY (default)")
        return RecoveryStrategy.RETRY

    # -- Validation -----------------------------------------------------------

    def validate_step(self, step: SkillStep, result: str) -> bool:
        """Check step output against its validation criteria.

        Parameters
        ----------
        step:
            The step with validation criteria.
        result:
            The output string to validate.

        Returns
        -------
        bool
            *True* if the result passes validation.
        """
        if not step.validation:
            return True

        criteria = step.validation.lower()
        result_lower = (result or "").lower()

        # Check for expected content
        if "contains:" in criteria:
            expected = criteria.split("contains:", 1)[1].strip()
            if expected not in result_lower:
                logger.warning(
                    "Validation failed: expected '%s' in output", expected
                )
                return False

        # Check for non-empty
        if "not empty" in criteria or "non-empty" in criteria:
            if not result or not result.strip():
                logger.warning("Validation failed: output is empty")
                return False

        # Check exit code patterns
        if "exit:0" in criteria:
            if "exit code" in result_lower and "0" not in result_lower:
                logger.warning("Validation failed: non-zero exit code")
                return False

        return True

    # -- Skill adaptation -----------------------------------------------------

    def auto_adapt(self, skill: Skill, project_context: Dict[str, Any]) -> Skill:
        """Customize a skill for the current project context.

        Adapts step parameters based on project context:
        - Replaces ``{project_name}`` placeholders
        - Adjusts paths based on ``project_root``
        - Sets language-specific defaults from ``language``
        - Adjusts commands based on ``package_manager``

        Parameters
        ----------
        skill:
            The skill to adapt.
        project_context:
            Context dict with keys like ``project_root``, ``language``,
            ``package_manager``, ``project_name``, etc.

        Returns
        -------
        Skill
            The adapted skill (a copy; original is unmodified).
        """
        if not project_context:
            return skill

        # Shallow copy with adapted steps
        adapted_steps: List[SkillStep] = []

        for step in skill.steps:
            new_params = self._adapt_params(
                step.parameters, project_context
            )
            new_action = self._interpolate(step.action, project_context)
            new_description = self._interpolate(
                step.description, project_context
            )

            adapted_steps.append(
                SkillStep(
                    order=step.order,
                    action=new_action,
                    description=new_description,
                    tool=step.tool,
                    parameters=new_params,
                    validation=step.validation,
                )
            )

        return Skill(
            name=skill.name,
            description=skill.description,
            category=skill.category,
            steps=adapted_steps,
            tools_needed=list(skill.tools_needed),
            examples=list(skill.examples),
            confidence=skill.confidence,
            source_document=skill.source_document,
            created_at=skill.created_at,
            version=skill.version,
            tags=list(skill.tags),
        )

    # -- Internal helpers -----------------------------------------------------

    async def _retry_step(
        self,
        skill: Skill,
        step_index: int,
        context: Optional[Dict[str, Any]] = None,
    ) -> StepResult:
        """Retry a failed step up to ``max_retries`` times."""
        last_result: Optional[StepResult] = None

        for attempt in range(1, self.max_retries + 1):
            logger.info(
                "Retrying step %d, attempt %d/%d",
                step_index,
                attempt,
                self.max_retries,
            )
            if self.retry_delay_ms > 0:
                await self._sleep_ms(self.retry_delay_ms * attempt)

            result = await self.execute_step(skill, step_index, context)
            last_result = result
            if result.success:
                return result

        # All retries exhausted
        if last_result:
            return StepResult(
                success=False,
                output=last_result.output,
                error=f"All {self.max_retries} retries exhausted: {last_result.error}",
                duration_ms=last_result.duration_ms,
                step_index=step_index,
                step_action=skill.steps[step_index].action if step_index < len(skill.steps) else "",
            )
        return StepResult(
            success=False,
            error="Retry failed with no prior result",
            step_index=step_index,
        )

    @staticmethod
    async def _sleep_ms(ms: int) -> None:
        """Async sleep for a number of milliseconds."""
        import asyncio

        await asyncio.sleep(ms / 1000.0)

    def _merge_params(
        self, base: Dict[str, Any], context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Merge context variables into step parameters.

        Context values take precedence and can override base parameters.
        Also resolves ``{key}`` placeholders in string values.
        """
        merged = dict(base)

        # Context keys prefixed with underscore are private (not merged)
        for key, value in context.items():
            if not key.startswith("_"):
                merged[key] = value

        # Resolve placeholders in string values
        for key, value in list(merged.items()):
            if isinstance(value, str):
                merged[key] = self._interpolate(value, context)

        return merged

    @staticmethod
    def _interpolate(text: str, context: Dict[str, Any]) -> str:
        """Replace ``{key}`` placeholders in text with context values."""
        result = text
        for key, value in context.items():
            placeholder = "{" + key + "}"
            if placeholder in result:
                result = result.replace(placeholder, str(value))
        return result

    def _adapt_params(
        self, params: Dict[str, Any], context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Adapt parameters based on project context heuristics."""
        adapted = dict(params)
        lang = context.get("language", "").lower()
        pkg_mgr = context.get("package_manager", "").lower()
        project_root = context.get("project_root", "")

        # Adapt install commands by language
        if "command" in adapted:
            cmd = adapted["command"]
            if "npm install" in cmd and pkg_mgr == "yarn":
                adapted["command"] = cmd.replace("npm install", "yarn")
            elif "npm install" in cmd and pkg_mgr == "pnpm":
                adapted["command"] = cmd.replace("npm install", "pnpm install")
            elif "pip install" in cmd and pkg_mgr == "poetry":
                adapted["command"] = cmd.replace("pip install", "poetry add")
            elif "cargo build" in cmd and lang == "rust":
                pass  # already correct

        # Adapt working directory
        if project_root and "cwd" not in adapted:
            adapted["cwd"] = project_root

        return adapted

    # -- Batch execution ------------------------------------------------------

    async def execute_batch(
        self,
        skill_names: List[str],
        context: Optional[Dict[str, Any]] = None,
        stop_on_error: bool = True,
    ) -> List[ExecutionResult]:
        """Execute multiple skills sequentially.

        Parameters
        ----------
        skill_names:
            Names of skills to execute in order.
        context:
            Shared context for all skills.
        stop_on_error:
            If *True*, stop the batch if any skill fails.

        Returns
        -------
        list[ExecutionResult]
            Results for each skill execution.
        """
        results: List[ExecutionResult] = []

        for name in skill_names:
            result = await self.execute(name, context)
            results.append(result)

            if not result.success and stop_on_error:
                logger.warning(
                    "Batch halted: skill '%s' failed (%d/%d steps)",
                    name,
                    result.steps_failed,
                    result.steps_total,
                )
                break

        return results

    # -- Step preview ---------------------------------------------------------

    def preview_execution(self, skill_name: str) -> List[Dict[str, Any]]:
        """Generate a preview of what executing a skill would do.

        Parameters
        ----------
        skill_name:
            Name of the skill to preview.

        Returns
        -------
        list[dict]
            Preview of each step: action, tool, parameters.
        """
        try:
            skill = self.load_skill(skill_name)
        except ValueError:
            return []

        preview = []
        for step in skill.steps:
            preview.append(
                {
                    "order": step.order,
                    "action": step.action,
                    "description": step.description[:100],
                    "tool": step.tool,
                    "parameters": step.parameters,
                    "validation": step.validation,
                }
            )
        return preview

    # -- Dry run --------------------------------------------------------------

    async def dry_run(
        self, skill_name: str, context: Optional[Dict[str, Any]] = None
    ) -> ExecutionResult:
        """Execute a skill in dry-run mode — no tools are actually called.

        Parameters
        ----------
        skill_name:
            Name of the skill.
        context:
            Optional context for parameter display.

        Returns
        -------
        ExecutionResult
            Simulated execution result.
        """
        try:
            skill = self.load_skill(skill_name)
        except ValueError as exc:
            return ExecutionResult(
                success=False,
                skill_name=skill_name,
                steps_completed=0,
                steps_failed=0,
                steps_total=0,
                errors=[str(exc)],
            )

        step_results: List[StepResult] = []
        outputs: List[str] = []

        for idx, step in enumerate(skill.steps):
            params = self._merge_params(step.parameters, context or {})
            output = f"[DRY-RUN] {step.action}"
            if step.tool:
                output += f" (tool={step.tool})"
            if params:
                output += f" params={params}"
            outputs.append(output)

            step_results.append(
                StepResult(
                    success=True,
                    output=output,
                    duration_ms=0,
                    step_index=idx,
                    step_action=step.action,
                )
            )

        return ExecutionResult(
            success=True,
            skill_name=skill_name,
            steps_completed=len(skill.steps),
            steps_failed=0,
            steps_total=len(skill.steps),
            output="\n".join(outputs),
            step_results=step_results,
            duration_ms=0,
        )
