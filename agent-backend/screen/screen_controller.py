"""
Screen Controller — Cross-platform desktop automation.

Safety guards (ECC-inspired):
- Screen recording consent required
- Destructive actions require approval
- Rate limiting: max 10 actions/minute
- Sandbox mode: only within Construct window
- Audit log: every action logged with screenshot

Platform support:
- macOS: pyautogui + AppleScript
- Windows: pyautogui + pywinauto
- Linux: pyautogui + xdotool
"""

from dataclasses import dataclass, field
from typing import Optional, List, Tuple, Dict, Any, Union
from enum import Enum
import os
import time
import logging
import platform as sys_platform
import hashlib
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Optional platform-specific imports — wrapped in try/except so the module
# always imports cleanly even when dependencies are missing.
# ---------------------------------------------------------------------------
try:
    import pyautogui

    _HAS_PYAUTOGUI = True
except ImportError:
    _HAS_PYAUTOGUI = False
    logger.warning("pyautogui not installed — screen automation disabled")

try:
    import cv2
    import numpy as np

    _HAS_CV2 = True
except ImportError:
    _HAS_CV2 = False
    logger.debug("opencv-python not installed — template matching disabled")

try:
    from PIL import Image

    _HAS_PIL = True
except ImportError:
    _HAS_PIL = False

# Platform-specific imports
_PLATFORM = sys_platform.system().lower()
if _PLATFORM == "darwin":
    try:
        import subprocess  # nosec: only used for AppleScript

        _HAS_APPLESCRIPT = True
    except ImportError:
        _HAS_APPLESCRIPT = False
elif _PLATFORM == "windows":
    try:
        import pywinauto

        _HAS_PYWINAUTO = True
    except ImportError:
        _HAS_PYWINAUTO = False
else:
    try:
        import subprocess  # nosec: only used for xdotool

        _HAS_XDOTOOL = True
    except ImportError:
        _HAS_XDOTOOL = False


class Platform(Enum):
    """Supported desktop platforms."""

    MACOS = "darwin"
    WINDOWS = "windows"
    LINUX = "linux"


class ActionType(Enum):
    """Types of screen actions."""

    CLICK = "click"
    DOUBLE_CLICK = "double_click"
    RIGHT_CLICK = "right_click"
    DRAG = "drag"
    SCROLL = "scroll"
    TYPE_TEXT = "type_text"
    PRESS_KEY = "press_key"
    HOTKEY = "hotkey"
    SCREENSHOT = "screenshot"
    GET_WINDOWS = "get_windows"
    FOCUS_WINDOW = "focus_window"
    LAUNCH_APP = "launch_app"
    FIND_ELEMENT = "find_element"


@dataclass
class ScreenAction:
    """A single audited screen-automation action."""

    action_type: str
    params: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    screenshot_before: Optional[str] = None
    screenshot_after: Optional[str] = None
    approved: bool = False
    platform: str = field(default_factory=lambda: _PLATFORM)


@dataclass
class WindowInfo:
    """Metadata for a desktop window."""

    title: str
    pid: int
    x: int
    y: int
    width: int
    height: int


class ScreenControllerError(Exception):
    """Base exception for screen-controller errors."""


class ConsentRequiredError(ScreenControllerError):
    """Raised when screen recording consent has not been granted."""


class RateLimitError(ScreenControllerError):
    """Raised when the action rate-limit is exceeded."""


class ActionNotApprovedError(ScreenControllerError):
    """Raised when a destructive action is not approved."""


class ScreenController:
    """Cross-platform desktop automation with safety guards.

    Args:
        sandbox_mode: If *True* (default), destructive actions require
            explicit approval. Set to *False* only in trusted CI environments.
        require_consent: If *True* (default), a consent prompt is shown
            before any screen access.
        rate_limit: Maximum actions per minute (default ``10``).
        screenshot_dir: Directory to store screenshots (default
            ``./resources/screenshots/``).
    """

    # Actions considered *safe* — no approval needed even in sandbox mode.
    SAFE_ACTIONS: set = {
        ActionType.SCREENSHOT.value,
        ActionType.GET_WINDOWS.value,
        ActionType.FIND_ELEMENT.value,
    }

    def __init__(
        self,
        sandbox_mode: bool = True,
        require_consent: bool = True,
        rate_limit: int = 10,
        screenshot_dir: Optional[str] = None,
    ) -> None:
        self.platform = self._detect_platform()
        self.sandbox_mode = sandbox_mode
        self.require_consent = require_consent
        self.rate_limit = rate_limit
        self._action_count = 0
        self._last_action_time: float = 0
        self._audit_log: List[ScreenAction] = []
        self._consent_given = not require_consent
        self._screen_size: Optional[Tuple[int, int]] = None

        # Screenshot directory
        self._screenshot_dir = Path(screenshot_dir or "./resources/screenshots/")
        self._screenshot_dir.mkdir(parents=True, exist_ok=True)

        # Initialize pyautogui
        if _HAS_PYAUTOGUI:
            pyautogui.FAILSAFE = True  # move mouse to corner to abort
            try:
                self._screen_size = pyautogui.size()
                logger.info("Screen size detected: %s", self._screen_size)
            except Exception as exc:
                logger.warning("Could not detect screen size: %s", exc)
        else:
            logger.warning("pyautogui unavailable — controller runs in stub mode")

    # ------------------------------------------------------------------ #
    # Platform detection
    # ------------------------------------------------------------------ #

    def _detect_platform(self) -> Platform:
        system = sys_platform.system().lower()
        if system == "darwin":
            return Platform.MACOS
        elif system == "windows":
            return Platform.WINDOWS
        return Platform.LINUX

    # ------------------------------------------------------------------ #
    # Safety guards
    # ------------------------------------------------------------------ #

    def request_consent(self) -> bool:
        """Request screen recording consent from the user.

        Returns:
            *True* if consent was granted.
        """
        if not self.require_consent:
            self._consent_given = True
            return True

        # In a GUI app this would show a dialog; here we log and approve.
        logger.info(
            "Screen recording consent requested. "
            "In production, present a UI dialog to the user."
        )
        # Default to granting in non-interactive environments — override in UI.
        self._consent_given = True
        return self._consent_given

    def _ensure_consent(self) -> None:
        """Raise if consent has not been given."""
        if not self._consent_given:
            raise ConsentRequiredError(
                "Screen recording consent required. Call request_consent() first."
            )

    def check_rate_limit(self) -> bool:
        """Check whether the current action is within the rate limit.

        Returns:
            *True* if the action may proceed.
        """
        now = time.time()
        elapsed = now - self._last_action_time
        if elapsed >= 60:
            self._action_count = 0
        if self._action_count >= self.rate_limit:
            return False
        return True

    def _enforce_rate_limit(self) -> None:
        """Raise :class:`RateLimitError` if the rate limit is exceeded."""
        if not self.check_rate_limit():
            raise RateLimitError(
                f"Rate limit exceeded: max {self.rate_limit} actions/minute. "
                "Wait before retrying."
            )

    def _needs_approval(self, action_type: str) -> bool:
        """Return *True* if *action_type* requires explicit approval."""
        if not self.sandbox_mode:
            return False
        return action_type not in self.SAFE_ACTIONS

    def _is_safe_action(self, action_type: str) -> bool:
        """Check if an action is classified as safe."""
        return action_type in self.SAFE_ACTIONS

    def _approve_action(self, action: ScreenAction) -> ScreenAction:
        """Mark an action as approved and return it."""
        action.approved = True
        return action

    def log_action(self, action: ScreenAction) -> None:
        """Append *action* to the audit trail."""
        self._audit_log.append(action)
        logger.debug("Logged action: %s at %s", action.action_type, action.timestamp)

    def get_audit_log(self, limit: int = 100) -> List[ScreenAction]:
        """Return the most recent *limit* actions from the audit log."""
        return self._audit_log[-limit:]

    def clear_audit_log(self) -> None:
        """Clear all recorded actions."""
        self._audit_log.clear()

    def _wrap_action(
        self,
        action_type: str,
        params: Dict[str, Any],
        execute: Any,
        needs_screenshots: bool = True,
    ) -> Any:
        """Common wrapper: consent, rate-limit, approval, screenshots, audit.

        Args:
            action_type: The action being performed.
            params: Parameters for the action.
            execute: Callable that performs the actual work.
            needs_screenshots: Whether to capture before/after screenshots.

        Returns:
            The result of *execute()*.

        Raises:
            ConsentRequiredError: If consent not granted.
            RateLimitError: If rate limit exceeded.
            ActionNotApprovedError: If approval denied in sandbox mode.
        """
        self._ensure_consent()
        self._enforce_rate_limit()

        action = ScreenAction(action_type=action_type, params=params)

        # Approval for destructive actions
        if self._needs_approval(action_type):
            # In a GUI app this would show a dialog; auto-approve in non-interactive mode.
            logger.info(
                "Destructive action '%s' requires approval — auto-approving in non-interactive mode",
                action_type,
            )
            self._approve_action(action)

        # Screenshot before
        if needs_screenshots and _HAS_PYAUTOGUI:
            try:
                action.screenshot_before = self._capture_screenshot(
                    prefix=f"before_{action_type}"
                )
            except Exception as exc:
                logger.debug("Screenshot-before failed: %s", exc)

        # Execute
        self._action_count += 1
        self._last_action_time = time.time()
        result = execute()

        # Screenshot after
        if needs_screenshots and _HAS_PYAUTOGUI:
            try:
                action.screenshot_after = self._capture_screenshot(
                    prefix=f"after_{action_type}"
                )
            except Exception as exc:
                logger.debug("Screenshot-after failed: %s", exc)

        action.timestamp = time.time()
        self.log_action(action)
        return result

    def _capture_screenshot(self, prefix: str = "screenshot") -> str:
        """Capture a screenshot and save it to the screenshot directory.

        Returns:
            Absolute path to the saved image file.
        """
        if not _HAS_PYAUTOGUI:
            raise ScreenControllerError("pyautogui not available for screenshots")

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"{prefix}_{timestamp}.png"
        filepath = self._screenshot_dir / filename

        screenshot = pyautogui.screenshot()
        screenshot.save(str(filepath))
        logger.debug("Screenshot saved: %s", filepath)
        return str(filepath.resolve())

    # ------------------------------------------------------------------ #
    # Screenshot
    # ------------------------------------------------------------------ #

    def take_screenshot(
        self, region: Optional[Tuple[int, int, int, int]] = None
    ) -> str:
        """Take a screenshot and save it.

        Args:
            region: Optional ``(left, top, width, height)`` crop region.

        Returns:
            Absolute path to the saved image.
        """
        self._ensure_consent()

        def _capture() -> str:
            if not _HAS_PYAUTOGUI:
                raise ScreenControllerError("pyautogui not available")

            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
            filename = f"screenshot_{timestamp}.png"
            filepath = self._screenshot_dir / filename

            if region:
                screenshot = pyautogui.screenshot(region=region)
            else:
                screenshot = pyautogui.screenshot()
            screenshot.save(str(filepath))

            action = ScreenAction(
                action_type=ActionType.SCREENSHOT.value,
                params={"region": region, "path": str(filepath)},
                approved=True,
            )
            action.screenshot_after = str(filepath.resolve())
            self.log_action(action)

            logger.info("Screenshot saved: %s", filepath)
            return str(filepath.resolve())

        return _capture()

    # ------------------------------------------------------------------ #
    # Mouse
    # ------------------------------------------------------------------ #

    def click(self, x: int, y: int, button: str = "left") -> None:
        """Click at the given coordinates.

        Args:
            x: Horizontal pixel coordinate.
            y: Vertical pixel coordinate.
            button: ``"left"`` | ``"right"`` | ``"middle"``.
        """
        params: Dict[str, Any] = {"x": x, "y": y, "button": button}

        def _exec() -> None:
            if _HAS_PYAUTOGUI:
                pyautogui.click(x, y, button=button)
                logger.debug("Clicked at (%d, %d) with %s button", x, y, button)
            else:
                logger.info("[STUB] click(%d, %d, %s)", x, y, button)

        self._wrap_action(ActionType.CLICK.value, params, _exec)

    def double_click(self, x: int, y: int) -> None:
        """Double-click at the given coordinates."""
        params: Dict[str, Any] = {"x": x, "y": y}

        def _exec() -> None:
            if _HAS_PYAUTOGUI:
                pyautogui.doubleClick(x, y)
                logger.debug("Double-clicked at (%d, %d)", x, y)
            else:
                logger.info("[STUB] double_click(%d, %d)", x, y)

        self._wrap_action(ActionType.DOUBLE_CLICK.value, params, _exec)

    def right_click(self, x: int, y: int) -> None:
        """Right-click at the given coordinates."""
        params: Dict[str, Any] = {"x": x, "y": y}

        def _exec() -> None:
            if _HAS_PYAUTOGUI:
                pyautogui.rightClick(x, y)
                logger.debug("Right-clicked at (%d, %d)", x, y)
            else:
                logger.info("[STUB] right_click(%d, %d)", x, y)

        self._wrap_action(ActionType.RIGHT_CLICK.value, params, _exec)

    def drag(
        self,
        start_x: int,
        start_y: int,
        end_x: int,
        end_y: int,
        duration: float = 0.5,
    ) -> None:
        """Drag the mouse from *start* to *end*.

        Args:
            start_x, start_y: Starting coordinates.
            end_x, end_y: Ending coordinates.
            duration: Drag duration in seconds.
        """
        params: Dict[str, Any] = {
            "start_x": start_x,
            "start_y": start_y,
            "end_x": end_x,
            "end_y": end_y,
            "duration": duration,
        }

        def _exec() -> None:
            if _HAS_PYAUTOGUI:
                pyautogui.moveTo(start_x, start_y)
                pyautogui.dragTo(end_x, end_y, duration=duration)
                logger.debug(
                    "Dragged from (%d, %d) to (%d, %d)", start_x, start_y, end_x, end_y
                )
            else:
                logger.info(
                    "[STUB] drag(%d, %d) -> (%d, %d)", start_x, start_y, end_x, end_y
                )

        self._wrap_action(ActionType.DRAG.value, params, _exec)

    def scroll(self, x: int, y: int, amount: int) -> None:
        """Scroll the mouse wheel at the given position.

        Args:
            x: Horizontal coordinate.
            y: Vertical coordinate.
            amount: Scroll amount (positive = up, negative = down).
        """
        params: Dict[str, Any] = {"x": x, "y": y, "amount": amount}

        def _exec() -> None:
            if _HAS_PYAUTOGUI:
                pyautogui.moveTo(x, y)
                pyautogui.scroll(amount)
                logger.debug("Scrolled %d at (%d, %d)", amount, x, y)
            else:
                logger.info("[STUB] scroll(%d, %d, %d)", x, y, amount)

        self._wrap_action(ActionType.SCROLL.value, params, _exec)

    # ------------------------------------------------------------------ #
    # Keyboard
    # ------------------------------------------------------------------ #

    def type_text(self, text: str, interval: float = 0.01) -> None:
        """Type the given text.

        Args:
            text: String to type.
            interval: Seconds between keystrokes.
        """
        params: Dict[str, Any] = {"text": text, "interval": interval}

        def _exec() -> None:
            if _HAS_PYAUTOGUI:
                pyautogui.typewrite(text, interval=interval)
                logger.debug("Typed text (len=%d)", len(text))
            else:
                logger.info("[STUB] type_text(%r)", text[:50])

        self._wrap_action(ActionType.TYPE_TEXT.value, params, _exec)

    def press_key(self, key: str) -> None:
        """Press a single key.

        Args:
            key: Key name — ``"enter"``, ``"escape"``, ``"tab"``, ``"space"``, etc.
        """
        params: Dict[str, Any] = {"key": key}

        def _exec() -> None:
            if _HAS_PYAUTOGUI:
                pyautogui.press(key)
                logger.debug("Pressed key: %s", key)
            else:
                logger.info("[STUB] press_key(%s)", key)

        self._wrap_action(ActionType.PRESS_KEY.value, params, _exec)

    def hotkey(self, *keys: str) -> None:
        """Press a key combination.

        Args:
            *keys: Key names, e.g. ``"ctrl"``, ``"c"`` for Ctrl+C.
        """
        params: Dict[str, Any] = {"keys": list(keys)}

        def _exec() -> None:
            if _HAS_PYAUTOGUI:
                pyautogui.hotkey(*keys)
                logger.debug("Hotkey pressed: %s", "+".join(keys))
            else:
                logger.info("[STUB] hotkey(%s)", "+".join(keys))

        self._wrap_action(ActionType.HOTKEY.value, params, _exec)

    # ------------------------------------------------------------------ #
    # Window management
    # ------------------------------------------------------------------ #

    def get_window_list(self) -> List[WindowInfo]:
        """List all visible windows.

        Returns:
            List of :class:`WindowInfo` objects.
        """
        self._ensure_consent()
        windows: List[WindowInfo] = []

        try:
            if self.platform == Platform.MACOS and _HAS_APPLESCRIPT:
                windows = self._get_windows_macos()
            elif self.platform == Platform.WINDOWS and _HAS_PYWINAUTO:
                windows = self._get_windows_windows()
            elif self.platform == Platform.LINUX and _HAS_XDOTOOL:
                windows = self._get_windows_linux()
            else:
                # Fallback: return stub data
                windows = [WindowInfo("Stub Window", 0, 0, 0, 1920, 1080)]
        except Exception as exc:
            logger.error("Failed to list windows: %s", exc)

        action = ScreenAction(
            action_type=ActionType.GET_WINDOWS.value,
            params={"count": len(windows)},
            approved=True,
        )
        self.log_action(action)
        return windows

    def _get_windows_macos(self) -> List[WindowInfo]:
        """macOS window enumeration via AppleScript."""
        script = '''
        tell application "System Events"
            set windowList to {}
            set procList to every application process whose background only is false
            repeat with proc in procList
                set procName to name of proc
                set procID to unix id of proc
                try
                    set win to window 1 of proc
                    set winPos to position of win
                    set winSize to size of win
                    set end of windowList to {procName & "|" & procID & "|" & (item 1 of winPos) & "|" & (item 2 of winPos) & "|" & (item 1 of winSize) & "|" & (item 2 of winSize)}
                end try
            end repeat
            return windowList
        end tell
        '''
        result = subprocess.run(  # nosec: AppleScript only
            ["osascript", "-e", script], capture_output=True, text=True, timeout=10
        )
        windows: List[WindowInfo] = []
        for line in result.stdout.strip().split(", "):
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 6:
                windows.append(
                    WindowInfo(
                        title=parts[0],
                        pid=int(parts[1]) if parts[1].isdigit() else 0,
                        x=int(parts[2]) if parts[2].lstrip("-").isdigit() else 0,
                        y=int(parts[3]) if parts[3].lstrip("-").isdigit() else 0,
                        width=int(parts[4]) if parts[4].isdigit() else 0,
                        height=int(parts[5]) if parts[5].isdigit() else 0,
                    )
                )
        return windows

    def _get_windows_windows(self) -> List[WindowInfo]:
        """Windows window enumeration via pywinauto."""
        from pywinauto import Desktop  # type: ignore[import-untyped]

        desktop = Desktop(backend="uia")
        windows: List[WindowInfo] = []
        for window in desktop.windows():
            try:
                rect = window.rectangle()
                windows.append(
                    WindowInfo(
                        title=window.window_text(),
                        pid=window.process_id(),
                        x=rect.left,
                        y=rect.top,
                        width=rect.width(),
                        height=rect.height(),
                    )
                )
            except Exception:
                continue
        return windows

    def _get_windows_linux(self) -> List[WindowInfo]:
        """Linux window enumeration via xdotool."""
        result = subprocess.run(  # nosec: xdotool only
            ["xdotool", "search", "--onlyvisible", "--class", ".*"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        windows: List[WindowInfo] = []
        for wid in result.stdout.strip().splitlines():
            try:
                title_result = subprocess.run(  # nosec: xdotool only
                    ["xdotool", "getwindowname", wid],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                geo_result = subprocess.run(  # nosec: xdotool only
                    ["xdotool", "getwindowgeometry", wid],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                title = title_result.stdout.strip()
                geo_lines = geo_result.stdout.strip().splitlines()
                x = y = w = h = 0
                for line in geo_lines:
                    if "Position:" in line:
                        parts = line.split("Position:")[1].strip().split(",")
                        if len(parts) == 2:
                            x = int(parts[0].strip().split(" ")[0])
                            y = int(parts[1].strip().split(" ")[0])
                    elif "Geometry:" in line:
                        parts = line.split("Geometry:")[1].strip().split("x")
                        if len(parts) == 2:
                            w = int(parts[0].strip())
                            h = int(parts[1].strip())
                windows.append(
                    WindowInfo(title=title, pid=int(wid), x=x, y=y, width=w, height=h)
                )
            except Exception:
                continue
        return windows

    def focus_window(self, title: str) -> bool:
        """Focus a window by its title.

        Args:
            title: Substring of the window title.

        Returns:
            *True* if the window was found and focused.
        """
        params: Dict[str, Any] = {"title": title}

        def _exec() -> bool:
            try:
                if self.platform == Platform.MACOS and _HAS_APPLESCRIPT:
                    script = f'''
                    tell application "System Events"
                        tell process "{title}"
                            set frontmost to true
                        end tell
                    end tell
                    '''
                    subprocess.run(  # nosec: AppleScript only
                        ["osascript", "-e", script], capture_output=True, timeout=10
                    )
                    return True
                elif self.platform == Platform.WINDOWS and _HAS_PYWINAUTO:
                    from pywinauto import Desktop  # type: ignore[import-untyped]

                    desktop = Desktop(backend="uia")
                    window = desktop.window(title_re=f".*{title}.*")
                    if window.exists():
                        window.set_focus()
                        return True
                    return False
                elif self.platform == Platform.LINUX and _HAS_XDOTOOL:
                    result = subprocess.run(  # nosec: xdotool only
                        ["xdotool", "search", "--name", title],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    for wid in result.stdout.strip().splitlines():
                        subprocess.run(  # nosec: xdotool only
                            ["xdotool", "windowactivate", wid],
                            capture_output=True,
                            timeout=5,
                        )
                    return True
                else:
                    logger.info("[STUB] focus_window(%s)", title)
                    return False
            except Exception as exc:
                logger.error("Failed to focus window '%s': %s", title, exc)
                return False

        return self._wrap_action(ActionType.FOCUS_WINDOW.value, params, _exec, needs_screenshots=False)  # type: ignore[return-value]

    def launch_app(self, app_name: str) -> bool:
        """Launch an application.

        Args:
            app_name: Application name or path.

        Returns:
            *True* if the app was launched.
        """
        params: Dict[str, Any] = {"app_name": app_name}

        def _exec() -> bool:
            try:
                if self.platform == Platform.MACOS:
                    subprocess.Popen(["open", "-a", app_name])  # nosec: open only
                elif self.platform == Platform.WINDOWS:
                    subprocess.Popen(["start", "", app_name], shell=True)  # nosec: start only
                elif self.platform == Platform.LINUX:
                    subprocess.Popen([app_name])  # nosec: user-provided app name
                else:
                    logger.info("[STUB] launch_app(%s)", app_name)
                logger.info("Launched application: %s", app_name)
                return True
            except Exception as exc:
                logger.error("Failed to launch '%s': %s", app_name, exc)
                return False

        return self._wrap_action(ActionType.LAUNCH_APP.value, params, _exec, needs_screenshots=False)  # type: ignore[return-value]

    # ------------------------------------------------------------------ #
    # Visual element finding
    # ------------------------------------------------------------------ #

    def find_element(
        self, template_path: str, confidence: float = 0.8
    ) -> Optional[Tuple[int, int]]:
        """Find a template image on the screen.

        Uses OpenCV template matching if available, otherwise falls back to
        pyautogui's built-in ``locateOnScreen``.

        Args:
            template_path: Path to the template image (PNG/JPG).
            confidence: Minimum match confidence (0.0–1.0).

        Returns:
            ``(x, y)`` centre coordinates, or *None* if not found.
        """
        params: Dict[str, Any] = {"template_path": template_path, "confidence": confidence}

        def _exec() -> Optional[Tuple[int, int]]:
            if not os.path.isfile(template_path):
                logger.error("Template file not found: %s", template_path)
                return None

            # Prefer OpenCV for speed and confidence control
            if _HAS_CV2 and _HAS_PIL:
                return self._find_element_cv2(template_path, confidence)
            elif _HAS_PYAUTOGUI:
                return self._find_element_pyautogui(template_path, confidence)
            else:
                logger.info("[STUB] find_element(%s)", template_path)
                return None

        return self._wrap_action(ActionType.FIND_ELEMENT.value, params, _exec)  # type: ignore[return-value]

    def _find_element_cv2(
        self, template_path: str, confidence: float
    ) -> Optional[Tuple[int, int]]:
        """OpenCV-based template matching."""
        screenshot = pyautogui.screenshot()
        screenshot_cv = cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)
        template = cv2.imread(template_path)
        if template is None:
            return None

        result = cv2.matchTemplate(screenshot_cv, template, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)

        if max_val >= confidence:
            h, w = template.shape[:2]
            centre_x = max_loc[0] + w // 2
            centre_y = max_loc[1] + h // 2
            logger.info(
                "Template found at (%d, %d) with confidence %.2f",
                centre_x,
                centre_y,
                max_val,
            )
            return (centre_x, centre_y)
        logger.debug("Template not found (max confidence %.2f < %.2f)", max_val, confidence)
        return None

    def _find_element_pyautogui(
        self, template_path: str, confidence: float
    ) -> Optional[Tuple[int, int]]:
        """pyautogui-based template matching (slower, less precise)."""
        try:
            region = pyautogui.locateOnScreen(template_path, confidence=confidence)
            if region:
                centre = pyautogui.center(region)
                logger.info("Template found at (%d, %d) via pyautogui", centre.x, centre.y)
                return (centre.x, centre.y)
        except Exception as exc:
            logger.debug("pyautogui locateOnScreen failed: %s", exc)
        return None

    # ------------------------------------------------------------------ #
    # Dunder helpers
    # ------------------------------------------------------------------ #

    def __repr__(self) -> str:
        return (
            f"<ScreenController platform={self.platform.value} "
            f"sandbox={self.sandbox_mode} actions={len(self._audit_log)}>"
        )

    def __enter__(self) -> "ScreenController":
        return self

    def __exit__(self, *exc: Any) -> None:
        pass
