import { useState, useEffect, useCallback } from "react";

/**
 * useCommandPalette — manages the open/close state of the command palette,
 * and registers the global Ctrl+Shift+P / Cmd+Shift+P keyboard shortcut.
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+P or Cmd+Shift+P opens the command palette
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [toggle]);

  return { isOpen, open, close, toggle };
}
