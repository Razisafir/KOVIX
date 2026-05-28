"""Browser Tool — web automation using Playwright.

Features: launch, navigate, click, type, extract text, screenshot,
download, intercept requests, run JavaScript.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# Graceful degradation if playwright not installed
try:
    from playwright.async_api import async_playwright, Browser, BrowserContext, Page
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False
    logger.warning("playwright not installed — browser automation unavailable")


class BrowserTool:
    """Browser automation tool using Playwright.

    Provides async methods for web automation including navigation,
    element interaction, screenshot capture, and JavaScript execution.
    All methods return structured dictionaries with success/error info.
    """

    def __init__(self) -> None:
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._history: List[str] = []

    async def launch(
        self,
        headless: bool = True,
        browser_type: str = "chromium",
        viewport: Optional[Dict[str, int]] = None,
        user_agent: Optional[str] = None,
    ) -> bool:
        """Launch a browser instance.

        Parameters
        ----------
        headless:
            Run browser without visible UI.
        browser_type:
            One of "chromium", "firefox", "webkit".
        viewport:
            Dict with "width" and "height" keys.
        user_agent:
            Custom user agent string.

        Returns
        -------
        bool
            *True* if the browser launched successfully.

        Raises
        ------
        RuntimeError
            If Playwright is not installed.
        """
        if not HAS_PLAYWRIGHT:
            raise RuntimeError("playwright not installed: pip install playwright")

        try:
            self._playwright = await async_playwright().start()
            browser_factory: Callable = getattr(self._playwright, browser_type)
            self._browser = await browser_factory.launch(headless=headless)

            context_kwargs: Dict[str, Any] = {}
            if viewport:
                context_kwargs["viewport"] = viewport
            if user_agent:
                context_kwargs["user_agent"] = user_agent

            self._context = await self._browser.new_context(**context_kwargs)
            self._page = await self._context.new_page()

            logger.info("Browser launched: %s (headless=%s)", browser_type, headless)
            return True
        except Exception as exc:
            logger.exception("Failed to launch browser")
            raise RuntimeError(f"Browser launch failed: {exc}")

    async def navigate(
        self, url: str, wait_until: str = "networkidle"
    ) -> Dict[str, Any]:
        """Navigate to a URL.

        Parameters
        ----------
        url:
            The URL to navigate to.
        wait_until:
            When to consider navigation complete:
            "load", "domcontentloaded", "networkidle".

        Returns
        -------
        dict
            Contains ``success``, ``url``, ``title``, ``status``,
            and ``error`` keys.
        """
        if self._page is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            response = await self._page.goto(url, wait_until=wait_until, timeout=30000)
            self._history.append(url)

            status = response.status if response else None
            title = await self._page.title()

            logger.info("Navigated to %s (status=%s, title=%s)", url, status, title)
            return {
                "success": True,
                "url": url,
                "title": title,
                "status": status,
            }
        except Exception as exc:
            logger.exception("Navigation failed: %s", url)
            return {"success": False, "url": url, "error": str(exc)}

    async def click(self, selector: str) -> Dict[str, Any]:
        """Click an element on the page.

        Parameters
        ----------
        selector:
            CSS selector or XPath for the element.

        Returns
        -------
        dict
            Contains ``success``, ``selector``, and ``error`` keys.
        """
        if self._page is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            await self._page.click(selector, timeout=10000)
            logger.info("Clicked element: %s", selector)
            return {"success": True, "selector": selector}
        except Exception as exc:
            logger.exception("Click failed for selector: %s", selector)
            return {"success": False, "selector": selector, "error": str(exc)}

    async def type_text(
        self,
        selector: str,
        text: str,
        submit: bool = False,
        clear: bool = True,
    ) -> Dict[str, Any]:
        """Type text into an input element.

        Parameters
        ----------
        selector:
            CSS selector for the input element.
        text:
            Text to type.
        submit:
            If *True*, press Enter after typing.
        clear:
            If *True*, clear the field before typing.

        Returns
        -------
        dict
            Contains ``success``, ``selector``, ``text``, and ``error``.
        """
        if self._page is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            if clear:
                await self._page.fill(selector, "")
            await self._page.type(selector, text, delay=10)
            if submit:
                await self._page.press(selector, "Enter")

            logger.info("Typed %d chars into %s (submit=%s)", len(text), selector, submit)
            return {"success": True, "selector": selector, "text": text, "submit": submit}
        except Exception as exc:
            logger.exception("Type failed for selector: %s", selector)
            return {"success": False, "selector": selector, "error": str(exc)}

    async def extract_text(self, selector: Optional[str] = None) -> Dict[str, Any]:
        """Extract text from the page or a specific element.

        Parameters
        ----------
        selector:
            If provided, extract text from this element only.
            Otherwise extract from the entire page body.

        Returns
        -------
        dict
            Contains ``success``, ``text``, ``element_count``, and ``error``.
        """
        if self._page is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            if selector:
                elements = await self._page.query_selector_all(selector)
                texts = []
                for el in elements:
                    txt = await el.inner_text()
                    if txt:
                        texts.append(txt.strip())
                combined = "\n".join(texts)
                logger.info(
                    "Extracted text from %d elements matching '%s'", len(elements), selector
                )
                return {
                    "success": True,
                    "text": combined,
                    "element_count": len(elements),
                    "selector": selector,
                }
            else:
                text = await self._page.inner_text("body")
                logger.info("Extracted page body text (%d chars)", len(text))
                return {"success": True, "text": text.strip(), "element_count": 1}
        except Exception as exc:
            logger.exception("Text extraction failed")
            return {"success": False, "selector": selector, "error": str(exc)}

    async def screenshot(
        self,
        path: Optional[str] = None,
        full_page: bool = True,
        selector: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Take a screenshot of the page or a specific element.

        Parameters
        ----------
        path:
            File path to save the screenshot. If *None*, returns
            the image as a base64-encoded string.
        full_page:
            Capture the full scrollable page.
        selector:
            If provided, screenshot only this element.

        Returns
        -------
        dict
            Contains ``success``, ``path``, ``base64``, and ``error``.
        """
        if self._page is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            screenshot_kwargs: Dict[str, Any] = {"full_page": full_page}
            if selector:
                element = await self._page.query_selector(selector)
                if element is None:
                    return {
                        "success": False,
                        "error": f"Element not found: {selector}",
                    }
                raw_bytes = await element.screenshot()
            else:
                raw_bytes = await self._page.screenshot(**screenshot_kwargs)

            b64_str = base64.b64encode(raw_bytes).decode("utf-8")

            if path:
                Path(path).parent.mkdir(parents=True, exist_ok=True)
                with open(path, "wb") as fh:
                    fh.write(raw_bytes)
                logger.info("Screenshot saved to %s (%d bytes)", path, len(raw_bytes))
            else:
                logger.info("Screenshot captured (%d bytes, base64 returned)", len(raw_bytes))

            return {
                "success": True,
                "path": path,
                "base64": b64_str,
                "size_bytes": len(raw_bytes),
            }
        except Exception as exc:
            logger.exception("Screenshot failed")
            return {"success": False, "path": path, "error": str(exc)}

    async def download(self, url: str, output_path: str) -> Dict[str, Any]:
        """Download a file using the browser context.

        Parameters
        ----------
        url:
            URL of the file to download.
        output_path:
            Local file path where the downloaded file will be saved.

        Returns
        -------
        dict
            Contains ``success``, ``url``, ``output_path``, ``size_bytes``,
            and ``error``.
        """
        if self._context is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            # Set up download listener
            download_future = asyncio.Future()

            async def handle_download(download):
                download_path = await download.path()
                download_future.set_result((download, download_path))

            self._page.on("download", lambda d: asyncio.create_task(handle_download(d)))

            # Trigger download by navigating to the URL
            await self._page.evaluate(f"""
                const a = document.createElement('a');
                a.href = {url!r};
                a.download = '';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            """)

            # Fallback: use direct fetch via browser
            result = await self._page.evaluate(f"""
                async () => {{
                    const response = await fetch({url!r});
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    const blob = await response.blob();
                    const reader = new FileReader();
                    return new Promise((resolve) => {{
                        reader.onloadend = () => resolve({{
                            size: blob.size,
                            base64: reader.result.split(',')[1]
                        }});
                        reader.readAsDataURL(blob);
                    }});
                }}
            """)

            if result and "base64" in result:
                raw_bytes = base64.b64decode(result["base64"])
                with open(output_path, "wb") as fh:
                    fh.write(raw_bytes)
                size_bytes = len(raw_bytes)
            else:
                # Alternative: try navigating directly
                import aiohttp

                async with aiohttp.ClientSession() as session:
                    async with session.get(url) as resp:
                        raw_bytes = await resp.read()
                        with open(output_path, "wb") as fh:
                            fh.write(raw_bytes)
                size_bytes = len(raw_bytes)

            logger.info("Downloaded %s -> %s (%d bytes)", url, output_path, size_bytes)
            return {
                "success": True,
                "url": url,
                "output_path": output_path,
                "size_bytes": size_bytes,
            }
        except Exception as exc:
            logger.exception("Download failed: %s", url)
            return {"success": False, "url": url, "output_path": output_path, "error": str(exc)}

    async def run_js(self, script: str) -> Dict[str, Any]:
        """Execute JavaScript on the current page.

        Parameters
        ----------
        script:
            JavaScript code to execute. Use ``return`` to send a value back.

        Returns
        -------
        dict
            Contains ``success``, ``result``, and ``error``.
        """
        if self._page is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            result = await self._page.evaluate(script)
            logger.info("JavaScript executed successfully (result type: %s)", type(result).__name__)
            return {"success": True, "result": result}
        except Exception as exc:
            logger.exception("JavaScript execution failed")
            return {"success": False, "error": str(exc)}

    async def get_page_info(self) -> Dict[str, Any]:
        """Return current page metadata.

        Returns
        -------
        dict
            Contains ``url``, ``title``, ``history``, and viewport size.
        """
        if self._page is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            url = self._page.url
            title = await self._page.title()
            viewport = self._page.viewport_size if hasattr(self._page, "viewport_size") else {}
            return {
                "success": True,
                "url": url,
                "title": title,
                "history": list(self._history),
                "viewport": viewport,
            }
        except Exception as exc:
            logger.exception("Failed to get page info")
            return {"success": False, "error": str(exc)}

    async def scroll(self, direction: str = "down", amount: int = 500) -> Dict[str, Any]:
        """Scroll the page.

        Parameters
        ----------
        direction:
            "down", "up", "bottom", "top".
        amount:
            Pixels to scroll for "down" or "up".

        Returns
        -------
        dict
            Contains ``success`` and ``error``.
        """
        if self._page is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            if direction == "down":
                await self._page.evaluate(f"window.scrollBy(0, {amount})")
            elif direction == "up":
                await self._page.evaluate(f"window.scrollBy(0, -{amount})")
            elif direction == "bottom":
                await self._page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            elif direction == "top":
                await self._page.evaluate("window.scrollTo(0, 0)")
            else:
                return {"success": False, "error": f"Unknown direction: {direction}"}

            logger.info("Scrolled %s", direction)
            return {"success": True, "direction": direction}
        except Exception as exc:
            logger.exception("Scroll failed")
            return {"success": False, "error": str(exc)}

    async def wait_for_selector(
        self, selector: str, timeout: int = 10000
    ) -> Dict[str, Any]:
        """Wait for an element to appear on the page.

        Parameters
        ----------
        selector:
            CSS selector to wait for.
        timeout:
            Maximum wait time in milliseconds.

        Returns
        -------
        dict
            Contains ``success``, ``selector``, and ``error``.
        """
        if self._page is None:
            return {"success": False, "error": "Browser not launched — call launch() first"}

        try:
            await self._page.wait_for_selector(selector, timeout=timeout)
            logger.info("Selector appeared: %s", selector)
            return {"success": True, "selector": selector}
        except Exception as exc:
            logger.info("Selector did not appear: %s (%s)", selector, exc)
            return {"success": False, "selector": selector, "error": str(exc)}

    async def close(self) -> None:
        """Close the browser and clean up resources."""
        try:
            if self._context:
                await self._context.close()
                self._context = None
            if self._browser:
                await self._browser.close()
                self._browser = None
            if self._playwright:
                await self._playwright.stop()
                self._playwright = None
            self._page = None
            self._history.clear()
            logger.info("Browser closed")
        except Exception as exc:
            logger.warning("Error during browser close: %s", exc)

    def is_available(self) -> bool:
        """Return *True* if Playwright is installed and usable."""
        return HAS_PLAYWRIGHT

    def __del__(self) -> None:
        """Ensure browser resources are released on garbage collection."""
        if self._browser is not None or self._page is not None:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(self.close())
                else:
                    loop.run_until_complete(self.close())
            except Exception:
                pass
