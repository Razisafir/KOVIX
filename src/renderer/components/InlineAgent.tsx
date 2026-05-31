import React, { useState, useRef, useEffect } from "react";

interface InlineAgentProps {
  filePath: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  selectedText?: string;
  onClose: () => void;
  onSubmit: (prompt: string, context: InlineAgentContext) => void;
}

export interface InlineAgentContext {
  filePath: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  selectedText: string;
}

export const InlineAgent: React.FC<InlineAgentProps> = ({
  filePath,
  startLine,
  startCol,
  endLine,
  endCol,
  selectedText = "",
  onClose,
  onSubmit,
}) => {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus input on mount
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    setIsLoading(true);
    onSubmit(prompt, {
      filePath,
      startLine,
      startCol,
      endLine,
      endCol,
      selectedText,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Truncate selected text for preview
  const previewText =
    selectedText.length > 120
      ? selectedText.slice(0, 120) + "\u2026"
      : selectedText;

  return (
    <div className="absolute z-50 w-[420px] max-w-[90vw] rounded-lg overflow-hidden shadow-2xl border border-[#00E5FF30] bg-[#141B2D]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0A0E1A] border-b border-[#1A1F2E]">
        <span className="text-[11px] font-medium text-[#00E5FF] flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#00E5FF] animate-pulse" />
          Construct Agent
        </span>
        <button
          onClick={onClose}
          className="text-[#4A5568] hover:text-[#E0E7FF] cursor-pointer bg-transparent border-none text-[14px] leading-none transition-colors"
        >
          \u00D7
        </button>
      </div>

      {/* Context preview */}
      <div className="px-3 py-2 text-[10px] text-[#4A5568] border-b border-[#1A1F2E] font-mono">
        <div className="flex items-center gap-2">
          <span className="text-[#849495]">
            {filePath.split("/").pop()}
          </span>
          <span className="text-[#4A5568]">
            {startLine}:{startCol} \u2192 {endLine}:{endCol}
          </span>
        </div>
        {previewText && (
          <div className="mt-1 p-1.5 bg-[#0A0E1A] rounded text-[#849495] max-h-[40px] overflow-hidden">
            {previewText}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-2">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask the agent to edit this selection\u2026"
          className="w-full h-[64px] bg-[#0A0E1A] border border-[#1A1F2E] rounded px-2.5 py-1.5 text-[11px] text-[#E0E7FF] placeholder-[#4A5568] resize-none focus:border-[#00E5FF50] focus:outline-none font-mono leading-[16px] transition-colors"
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-2.5 pb-2.5">
        <span className="text-[9px] text-[#4A5568] font-mono">
          {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to submit
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={onClose}
            className="px-2.5 py-1 text-[10px] text-[#4A5568] hover:text-[#E0E7FF] cursor-pointer bg-transparent border border-[#1A1F2E] rounded font-mono transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !prompt.trim()}
            className="px-3 py-1 text-[10px] bg-[#00E5FF] text-[#0A0E1A] rounded font-semibold cursor-pointer border-none disabled:opacity-40 hover:bg-[#00FFFF] transition-colors font-mono"
          >
            {isLoading ? "Thinking\u2026" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────── Inline Agent Manager ─────────────────────── */

/**
 * Manages inline agent lifecycle by listening to construct:agent:inline events
 * from the Monaco editor and rendering the widget.
 */
export const InlineAgentManager: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [agentState, setAgentState] = useState<{
    visible: boolean;
    filePath: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    selectedText: string;
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.selection || !detail?.filePath) return;

      const sel = detail.selection;
      setAgentState({
        visible: true,
        filePath: detail.filePath,
        startLine: sel.startLineNumber || sel.selectionStartLineNumber || 1,
        startCol: sel.startColumn || sel.selectionStartColumn || 1,
        endLine: sel.endLineNumber || sel.positionLineNumber || 1,
        endCol: sel.endColumn || sel.positionColumn || 1,
        selectedText: sel.selectedText || "",
        top: 100, // approximate position — Monaco will provide coords
        left: 200,
      });
    };

    window.addEventListener("construct:agent:inline", handler);
    return () =>
      window.removeEventListener("construct:agent:inline", handler);
  }, []);

  const handleClose = () => setAgentState(null);

  const handleSubmit = (
    prompt: string,
    context: InlineAgentContext
  ) => {
    // Dispatch to the agent backend
    console.log("[InlineAgent] Submitting:", { prompt, context });
    // In production, this would invoke the agent via Tauri/API
    window.dispatchEvent(
      new CustomEvent("construct:agent:request", {
        detail: {
          type: "inline-edit",
          prompt,
          context,
        },
      })
    );
    handleClose();
  };

  return (
    <div className="relative w-full h-full">
      {children}
      {agentState?.visible && (
        <div
          className="absolute z-50"
          style={{ top: agentState.top, left: agentState.left }}
        >
          <InlineAgent
            filePath={agentState.filePath}
            startLine={agentState.startLine}
            startCol={agentState.startCol}
            endLine={agentState.endLine}
            endCol={agentState.endCol}
            selectedText={agentState.selectedText}
            onClose={handleClose}
            onSubmit={handleSubmit}
          />
        </div>
      )}
    </div>
  );
};

export default InlineAgent;
