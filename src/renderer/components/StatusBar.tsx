import { useState, useEffect } from "react";
import useAppStore from "../stores/useAppStore";

interface CursorPosition {
  line: number;
  column: number;
}

function StatusBar() {
  const rightPanelVisible = useAppStore((s) => s.rightPanelVisible);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const agentMode = useAppStore((s) => s.agentMode);

  // Track cursor position from Monaco via custom events
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const [activeFileName] = useState("main.py");
  const [language] = useState("Python");
  const [pendingChanges] = useState(0);

  useEffect(() => {
    const handleCursorChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.line && detail?.column) {
        setCursor({ line: detail.line, column: detail.column });
      }
    };
    window.addEventListener("construct:cursor:change", handleCursorChange);
    return () =>
      window.removeEventListener("construct:cursor:change", handleCursorChange);
  }, []);

  // Model name based on agent mode
  const modelLabel =
    agentMode === "code"
      ? "Claude Sonnet"
      : agentMode === "architect"
      ? "Claude Opus"
      : agentMode === "debug"
      ? "Claude Haiku"
      : "Claude Sonnet";

  return (
    <div
      className="h-[22px] flex-shrink-0 flex items-center px-2 text-[10px] text-[#E0E7FF] select-none font-mono"
      style={{
        background: "rgba(0, 229, 255, 0.06)",
        borderTop: "1px solid rgba(0, 229, 255, 0.12)",
      }}
    >
      {/* Left: Agent + Model Status */}
      <div className="flex items-center gap-2">
        {agentStatus === "running" ? (
          <>
            <span className="w-2 h-2 rounded-full bg-[#00E5FF] animate-pulse" />
            <span className="text-[#00E5FF]">Thinking\u2026</span>
          </>
        ) : (
          <>
            <span className="w-2 h-2 rounded-full bg-[#00E5FF]" />
            <span className="text-[#4A5568]">Ready</span>
          </>
        )}
        <span className="text-[#1A1F2E]">|</span>
        <span className="text-[#4A5568]">{modelLabel}</span>
      </div>

      {/* Center: File Info */}
      <div className="mx-auto flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="text-[#4A5568] hover:text-[#E0E7FF] cursor-pointer bg-transparent border-none transition-colors"
        >
          {activeFileName}
        </button>
        <span className="text-[#4A5568]">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className="text-[#4A5568]">UTF-8</span>
        <span className="text-[#4A5568]">{language}</span>
      </div>

      {/* Right: Notifications + Toggles */}
      <div className="flex items-center gap-2">
        {pendingChanges > 0 && (
          <span className="text-[#00E5FF]">
            {pendingChanges} pending
          </span>
        )}
        <button
          onClick={togglePanel}
          className="flex items-center gap-1 text-[#4A5568] hover:text-[#E0E7FF] cursor-pointer bg-transparent border-none transition-colors"
          title="Toggle Terminal"
        >
          <span className="text-[11px]">{"\u{1F5A5}\uFE0F"}</span>
        </button>
        <button
          onClick={toggleRightPanel}
          className="flex items-center gap-1 cursor-pointer bg-transparent border-none transition-colors"
          style={{
            color: rightPanelVisible ? "#00E5FF" : "#4A5568",
          }}
          title="Toggle Agent Panel"
        >
          <span className="text-[11px]">{"\u{1F916}"}</span>
        </button>
        <span className="text-[#4A5568] hover:text-[#E0E7FF] cursor-pointer">
          {"\u24D8"} 0
        </span>
      </div>
    </div>
  );
}

export default StatusBar;
