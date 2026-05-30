import { useState, useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { TerminalOutput } from "./TerminalOutput";
import type { LogEntry } from "./TerminalOutput";
import AgentModeSelector, { type AgentMode } from "./AgentModeSelector";
import InlineDiff, { type PendingChange } from "./InlineDiff";

/* ─────────────────────── types ─────────────────────── */

interface AttachedFile {
  path: string;
  id: string;
}

interface AgentState {
  goal: string;
  status: "idle" | "working" | "paused" | "stopped" | "error";
  progress: number;
  tasksCompleted: number;
  totalTasks: number;
  elapsedTime: string;
  autoMode: boolean;
  thinking: string[];
  attachedFiles: AttachedFile[];
  logs: LogEntry[];
}

/* ─────────────────────── colors ─────────────────────── */

const C = {
  base: "#0c0c10",
  s1: "#12121a",
  s2: "#1a1a24",
  s3: "#22222e",
  accent: "#6366f1",
  t1: "#e8e8ec",
  t2: "#94949c",
  t3: "#6b6b73",
  t4: "#4a4a52",
  ok: "#22c55e",
  wrn: "#f59e0b",
  err: "#ef4444",
  inf: "#6366f1",
};

/* ─────────────────────── sub-components ─────────────────────── */

function StatusBar({ state }: { state: AgentState }) {
  const statusColor =
    state.status === "working" ? C.wrn : state.status === "error" ? C.err : C.ok;

  return (
    <div className="flex items-center gap-6 px-3 py-1.5 border-b border-white/[0.04] text-[10px] text-[#6b6b73] tracking-normal"
      style={{ fontFamily: '"Geist Mono", "JetBrains Mono", monospace' }}
    >
      <span>
        STATUS:{" "}
        <span style={{ color: statusColor }} className="uppercase">
          {state.status}
        </span>
      </span>
      <span>
        PROGRESS:{" "}
        <span style={{ color: C.t2 }}>{state.progress}%</span>
      </span>
      <span>
        TASKS:{" "}
        <span style={{ color: C.t2 }}>
          {state.tasksCompleted}/{state.totalTasks}
        </span>
      </span>
      <span>
        TIME:{" "}
        <span style={{ color: C.t2 }}>{state.elapsedTime}</span>
      </span>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[10px] font-semibold uppercase tracking-[0.08em] cursor-pointer px-2 py-[3px] rounded-[2px] border border-white/[0.04] transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
        backgroundColor: C.s2,
        color: C.t2,
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.target as HTMLElement).style.backgroundColor = C.s3;
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.backgroundColor = C.s2;
      }}
    >
      {label}
    </button>
  );
}

function AutoToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="text-[10px] font-semibold uppercase tracking-[0.08em] cursor-pointer px-2 py-[3px] rounded-[2px] border ml-auto"
      style={{
        fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
        backgroundColor: enabled ? C.s2 : C.base,
        color: enabled ? C.ok : C.t4,
        borderColor: enabled ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.04)",
      }}
    >
      AUTO:{enabled ? "ON" : "OFF"}
    </button>
  );
}

function FileChip({
  file,
  onRemove,
}: {
  file: AttachedFile;
  onRemove: (id: string) => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-[#6b6b73] rounded-[2px] border border-white/[0.04] px-1.5 py-0.5"
      style={{
        fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
        backgroundColor: C.s2,
      }}
    >
      {file.path}
      <span
        onClick={() => onRemove(file.id)}
        className="cursor-pointer text-[10px] leading-none"
        style={{ color: C.t4 }}
        onMouseEnter={(e) => {
          (e.target as HTMLElement).style.color = C.err;
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLElement).style.color = C.t4;
        }}
      >
        [x]
      </span>
    </span>
  );
}

/* ─────────────────────── main component ─────────────────────── */

function AgentPanel() {
  const [state, setState] = useState<AgentState>({
    goal: "",
    status: "idle",
    progress: 0,
    tasksCompleted: 0,
    totalTasks: 0,
    elapsedTime: "00:00:00",
    autoMode: false,
    thinking: [],
    attachedFiles: [],
    logs: [],
  });
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [fileInput, setFileInput] = useState("");
  const [agentMode, setAgentMode] = useState<AgentMode>("code");
  const [viewMode, setViewMode] = useState<"terminal" | "diff">("terminal");

  // Listen for agent events from Rust backend
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    const setupListener = async () => {
      const unlisten = await listen<{
        session_id: string;
        type: string;
        content: string;
        timestamp: number;
      }>(`agent:${sessionId}`, (event) => {
        if (cancelled) return;

        const { type, content, timestamp } = event.payload;
        const now = new Date(timestamp * 1000);
        const timeStr = now.toTimeString().slice(0, 8);

        setState((prev) => {
          const newLogs: LogEntry[] = [
            ...prev.logs,
            {
              timestamp: timeStr,
              level: type === "error" ? "ERR" : type === "complete" ? "OK" : "INF",
              message: content,
              source: type,
            },
          ];

          // Keep only last 500 log entries
          if (newLogs.length > 500) newLogs.splice(0, newLogs.length - 500);

          let newStatus = prev.status;
          let newProgress = prev.progress;
          let newTasksCompleted = prev.tasksCompleted;
          const newThinking = [...prev.thinking];

          switch (type) {
            case "thought":
              newThinking.push(content);
              if (newThinking.length > 20) newThinking.shift();
              break;
            case "task_start":
              newStatus = "working";
              break;
            case "task_complete":
              newTasksCompleted = prev.tasksCompleted + 1;
              newProgress = Math.min(100, prev.progress + 8);
              break;
            case "complete":
              newStatus = "idle";
              newProgress = 100;
              break;
            case "error":
              newStatus = "error";
              break;
          }

          return {
            ...prev,
            status: newStatus,
            progress: newProgress,
            tasksCompleted: newTasksCompleted,
            totalTasks: type === "task_start" ? prev.totalTasks + 1 : prev.totalTasks,
            thinking: newThinking,
            logs: newLogs,
          };
        });
      });

      if (!cancelled) {
        unlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    };

    setupListener();

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [sessionId]);

  const startAgent = useCallback(async () => {
    if (!state.goal.trim()) return;

    setState((prev) => ({ ...prev, status: "working", progress: 0, tasksCompleted: 0, totalTasks: 0, logs: [] }));

    try {
      const sid = await invoke<string>("start_agent", {
        goal: state.goal,
        projectPath: ".",
        mode: agentMode,
      });
      setSessionId(sid);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: "error",
        logs: [
          ...prev.logs,
          {
            timestamp: new Date().toTimeString().slice(0, 8),
            level: "ERR",
            message: `Failed to start agent: ${err}`,
            source: "system",
          },
        ],
      }));
    }
  }, [state.goal]);

  const pauseAgent = useCallback(async () => {
    if (!sessionId) return;
    await invoke("pause_agent", { sessionId });
    setState((prev) => ({ ...prev, status: "paused" }));
  }, [sessionId]);

  const resumeAgent = useCallback(async () => {
    if (!sessionId) return;
    await invoke("resume_agent", { sessionId });
    setState((prev) => ({ ...prev, status: "working" }));
  }, [sessionId]);

  const stopAgent = useCallback(async () => {
    if (!sessionId) return;
    await invoke("stop_agent", { sessionId });
    setState((prev) => ({ ...prev, status: "stopped" }));
    setSessionId(null);
  }, [sessionId]);

  const handleCommand = useCallback((cmd: string) => {
    setState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        {
          timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
          level: "INF",
          message: `> ${cmd}`,
          source: "user",
        },
      ],
    }));
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      attachedFiles: prev.attachedFiles.filter((f) => f.id !== id),
    }));
  }, []);

  const handleFileInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && fileInput.trim()) {
        const path = fileInput.trim().replace(/^@/, "");
        setState((prev) => ({
          ...prev,
          attachedFiles: [
            ...prev.attachedFiles,
            { path, id: crypto.randomUUID() },
          ],
        }));
        setFileInput("");
      }
    },
    [fileInput]
  );

  const toggleAuto = useCallback(() => {
    setState((prev) => ({ ...prev, autoMode: !prev.autoMode }));
  }, []);

  // ── diff action handlers ──
  const handleAcceptChange = useCallback((id: string) => {
    setPendingChanges((prev) =>
      prev.map((c) => (c.id === id ? { ...c, accepted: true } : c))
    );
    // Log acceptance
    setState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        {
          timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
          level: "OK",
          message: `accepted changes in ${pendingChanges.find((c) => c.id === id)?.filePath ?? id}`,
          source: "diff",
        },
      ],
    }));
  }, [pendingChanges]);

  const handleRejectChange = useCallback((id: string) => {
    setPendingChanges((prev) =>
      prev.map((c) => (c.id === id ? { ...c, accepted: false } : c))
    );
    setState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        {
          timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
          level: "WRN",
          message: `rejected changes in ${pendingChanges.find((c) => c.id === id)?.filePath ?? id}`,
          source: "diff",
        },
      ],
    }));
  }, [pendingChanges]);

  const handleAcceptAll = useCallback(() => {
    setPendingChanges((prev) => prev.map((c) => ({ ...c, accepted: true })));
    setState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        {
          timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
          level: "OK",
          message: "accepted all pending changes",
          source: "diff",
        },
      ],
    }));
  }, []);

  const handleRejectAll = useCallback(() => {
    setPendingChanges((prev) => prev.map((c) => ({ ...c, accepted: false })));
    setState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        {
          timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
          level: "WRN",
          message: "rejected all pending changes",
          source: "diff",
        },
      ],
    }));
  }, []);

  // Count of still-pending changes
  const pendingCount = pendingChanges.filter((c) => c.accepted === null).length;

  // Determine pause/resume label based on current status
  const pauseLabel = state.status === "paused" ? "RESUME" : "PAUSE";
  const handlePauseResume = state.status === "paused" ? resumeAgent : pauseAgent;

  return (
    <div
      className="flex flex-col h-full overflow-hidden border border-white/[0.04]"
      style={{
        backgroundColor: C.base,
        fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
      }}
    >
      {/* ── GOAL + MODE SELECTOR ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04]">
        {/* Agent Mode Selector */}
        <AgentModeSelector mode={agentMode} onChange={setAgentMode} />

        {/* Mode badge — shows current mode with color */}
        <span
          className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0"
          style={{
            fontFamily: 'inherit',
            backgroundColor: {
              code: "rgba(99,102,241,0.15)",
              architect: "rgba(167,139,250,0.15)",
              debug: "rgba(245,158,11,0.15)",
              review: "rgba(6,182,212,0.15)",
              security: "rgba(16,185,129,0.15)",
              devops: "rgba(249,115,22,0.15)",
            }[agentMode],
            color: {
              code: "#6366f1",
              architect: "#a78bfa",
              debug: "#f59e0b",
              review: "#06b6d4",
              security: "#10b981",
              devops: "#f97316",
            }[agentMode],
          }}
        >
          {agentMode}
        </span>

        {/* Goal input (editable when idle/stopped/error) */}
        {state.status === "idle" || state.status === "stopped" || state.status === "error" ? (
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-semibold text-[#e8e8ec] whitespace-nowrap">GOAL:</span>
            <input
              type="text"
              value={state.goal}
              onChange={(e) => setState((prev) => ({ ...prev, goal: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") startAgent();
              }}
              placeholder="Enter goal and press Enter..."
              className="flex-1 min-w-0 bg-transparent border-none border-b border-[#4a4a52] text-[11px] text-[#e8e8ec] outline-none px-0 py-0.5"
              style={{
                fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
                caretColor: C.accent,
              }}
              spellCheck={false}
              autoComplete="off"
            />
            <ControlButton label="START" onClick={startAgent} />
          </div>
        ) : (
          <div
            className="flex-1 text-[11px] font-semibold text-[#e8e8ec] truncate min-w-0"
            title={state.goal}
          >
            GOAL: {state.goal}
          </div>
        )}

        {/* Pending changes badge */}
        {pendingCount > 0 && (
          <button
            onClick={() => setViewMode(viewMode === "diff" ? "terminal" : "diff")}
            className="flex items-center gap-1 h-5 px-2 rounded-[2px] text-[9px] font-semibold tracking-[0.06em] cursor-pointer flex-shrink-0"
            style={{
              fontFamily: 'inherit',
              backgroundColor: viewMode === "diff" ? `${C.accent}22` : C.s2,
              border: `1px solid ${viewMode === "diff" ? C.accent : "rgba(255,255,255,0.04)"}`,
              color: viewMode === "diff" ? C.accent : C.t3,
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: viewMode === "diff" ? C.accent : C.wrn,
              }}
            />
            {pendingCount} pending
          </button>
        )}
      </div>

      {/* ── STATUS BAR ── */}
      <StatusBar state={state} />

      {/* ── CONTROLS ── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/[0.04]">
        <ControlButton
          label={pauseLabel}
          onClick={handlePauseResume}
          disabled={state.status !== "working" && state.status !== "paused"}
        />
        <ControlButton
          label="STOP"
          onClick={stopAgent}
          disabled={state.status !== "working" && state.status !== "paused"}
        />
        <ControlButton label="CHECKPOINT" />
        <ControlButton label="LOG" />
        {/* Toggle between terminal and diff view */}
        {pendingCount > 0 && (
          <ControlButton
            label={viewMode === "diff" ? "TERMINAL" : "DIFF"}
            onClick={() => setViewMode(viewMode === "diff" ? "terminal" : "diff")}
          />
        )}
        <AutoToggle enabled={state.autoMode} onToggle={toggleAuto} />
      </div>

      {/* ── MAIN CONTENT: Terminal or InlineDiff ── */}
      <div className="flex-1 min-h-0">
        {viewMode === "diff" && pendingCount > 0 ? (
          <InlineDiff
            changes={pendingChanges}
            onAccept={handleAcceptChange}
            onReject={handleRejectChange}
            onAcceptAll={handleAcceptAll}
            onRejectAll={handleRejectAll}
          />
        ) : (
          <TerminalOutput
            logs={state.logs}
            onCommand={handleCommand}
            showInput
          />
        )}
      </div>

      {/* ── THINKING ── */}
      <div className="border-t border-white/[0.04]">
        {/* thinking header */}
        <button
          onClick={() => setThinkingOpen(!thinkingOpen)}
          className="flex items-center gap-1.5 w-full px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b6b73] cursor-pointer border-none"
          style={{
            fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
            backgroundColor: C.s1,
            borderBottom: thinkingOpen ? "1px solid rgba(255,255,255,0.04)" : "none",
          }}
        >
          <span style={{ color: C.t4 }}>{thinkingOpen ? "▼" : "▶"}</span>
          THINKING
        </button>

        {thinkingOpen && (
          <div
            className="px-3 py-1.5 max-h-[100px] overflow-auto"
            style={{
              backgroundColor: C.s2,
              scrollbarWidth: "thin",
              scrollbarColor: `${C.s3} transparent`,
            }}
          >
            {state.thinking.map((line, i) => (
              <div
                key={i}
                className="text-[10px] leading-4"
                style={{
                  color: C.t3,
                  fontFamily: 'inherit',
                }}
              >
                <span className="mr-1.5" style={{ color: C.accent }}>&gt;</span>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── ATTACHED FILES ── */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-1.5 border-t border-white/[0.04]">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b6b73]"
          style={{ fontFamily: 'inherit' }}
        >
          ATTACHED:
        </span>
        {state.attachedFiles.map((file) => (
          <FileChip key={file.id} file={file} onRemove={handleRemoveFile} />
        ))}
        <input
          type="text"
          value={fileInput}
          onChange={(e) => setFileInput(e.target.value)}
          onKeyDown={handleFileInputKeyDown}
          placeholder="@filename"
          className="bg-transparent border-0 border-b border-[#4a4a52] outline-none text-xs text-[#e8e8ec] px-0 py-0.5"
          style={{
            fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
            width: "140px",
            caretColor: C.accent,
          }}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {/* scrollbar styles */}
      <style>{`
        div::-webkit-scrollbar { width: 4px; height: 4px; }
        div::-webkit-scrollbar-track { background: transparent; }
        div::-webkit-scrollbar-thumb { background: ${C.s3}; border-radius: 2px; }
        div::-webkit-scrollbar-thumb:hover { background: #3a3a4f; }
      `}</style>
    </div>
  );
}

export default AgentPanel;
