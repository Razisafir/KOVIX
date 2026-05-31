import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { TerminalOutput } from "./TerminalOutput";
import type { LogEntry } from "./TerminalOutput";
import AgentModeSelector from "./AgentModeSelector";
import InlineDiff, { type PendingChange, type DiffHunk as InlineDiffHunk, type DiffLine } from "./InlineDiff";
import useAppStore from "../stores/useAppStore";
import { useDiffStore } from "../stores/useDiffStore";
import { generateDiff } from "../utils/diffParser";
import type { FileDiff, DiffHunk } from "../types/diff";

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
  streamingText: string;
  isStreaming: boolean;
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
    streamingText: "",
    isStreaming: false,
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [fileInput, setFileInput] = useState("");
  const agentMode = useAppStore((s) => s.agentMode);
  const setAgentMode = useAppStore((s) => s.setAgentMode);
  const [viewMode, setViewMode] = useState<"terminal" | "diff">("terminal");

  // Ref for command palette agent actions (avoids use-before-declaration)
  const agentActionRef = useRef<{ start: () => void; stop: () => void; pause: () => void; resume: () => void }>({
    start: () => {},
    stop: () => {},
    pause: () => {},
    resume: () => {},
  });

  // Listen for command palette agent actions
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.action === "start") agentActionRef.current.start();
      else if (detail?.action === "stop") agentActionRef.current.stop();
      else if (detail?.action === "pause") agentActionRef.current.pause();
      else if (detail?.action === "resume") agentActionRef.current.resume();
    };
    window.addEventListener("construct:agent-action", handler);
    return () => window.removeEventListener("construct:agent-action", handler);
  }, []);

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

          let newStreamingText = prev.streamingText;
          let newIsStreaming = prev.isStreaming;

          switch (type) {
            case "thought":
              newThinking.push(content);
              if (newThinking.length > 20) newThinking.shift();
              // Clear streaming buffer when a thought completes
              newStreamingText = "";
              newIsStreaming = false;
              break;
            case "token":
              // Token-level streaming — accumulate for real-time display
              newStreamingText = prev.streamingText + content;
              newIsStreaming = true;
              // Don't add token events to log — they're displayed separately
              return {
                ...prev,
                streamingText: newStreamingText,
                isStreaming: newIsStreaming,
                status: prev.status === "idle" ? "working" : prev.status,
              };
            case "tool_call":
              newStreamingText = "";
              newIsStreaming = false;
              break;
            case "task_start":
              newStatus = "working";
              newStreamingText = "";
              newIsStreaming = false;
              break;
            case "task_complete":
              newTasksCompleted = prev.tasksCompleted + 1;
              newProgress = Math.min(100, prev.progress + 8);
              newStreamingText = "";
              newIsStreaming = false;
              break;
            case "complete":
              newStatus = "idle";
              newProgress = 100;
              newStreamingText = "";
              newIsStreaming = false;
              break;
            case "error":
              newStatus = "error";
              newStreamingText = "";
              newIsStreaming = false;
              break;
            case "done":
              // SSE stream closed
              newStreamingText = "";
              newIsStreaming = false;
              if (prev.status === "working") newStatus = "idle";
              break;
            case "stream_error":
              newStreamingText = "";
              newIsStreaming = false;
              break;
            case "stream_timeout":
              newIsStreaming = false;
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
            streamingText: newStreamingText,
            isStreaming: newIsStreaming,
          };
        });

        // Capture file changes for diff viewer
        // The backend sends tool_call events with JSON content containing file info
        if (type === "tool_call" || type === "file_change") {
          try {
            const data = JSON.parse(content);
            const toolName = data.tool || data.tool_name;
            if (toolName === "write_file" || toolName === "edit_file" || toolName === "create_file" || toolName === "delete_file") {
              const filePath = data.arguments?.path || data.arguments?.file_path || data.path || "";
              const newContent = data.arguments?.content || data.content || "";

              if (filePath) {
                // Handle delete_file: no new content, create a deletion diff
                if (toolName === "delete_file") {
                  const diffStore = useDiffStore.getState();
                  const activeId = diffStore.activeSessionId;
                  if (activeId) {
                    readTextFile(filePath)
                      .then((oldContent) => {
                        const oldLines = oldContent.split("\n");
                        const fileDiff: FileDiff = {
                          filePath,
                          status: "deleted",
                          hunks: [
                            {
                              id: "hunk-0",
                              oldStart: 1,
                              oldLines: oldLines.length,
                              newStart: 0,
                              newLines: 0,
                              oldContent: oldLines,
                              newContent: [],
                              header: `@@ -1,${oldLines.length} +0,0 @@`,
                              accepted: null,
                            },
                          ],
                          oldContent,
                          newContent: "",
                        };
                        diffStore.addFileDiff(activeId, fileDiff);
                      })
                      .catch(() => {
                        // File already gone — create minimal deletion diff
                        const fileDiff: FileDiff = {
                          filePath,
                          status: "deleted",
                          hunks: [],
                          oldContent: "",
                          newContent: "",
                        };
                        diffStore.addFileDiff(activeId, fileDiff);
                      });
                  }
                  return; // Don't fall through to write_file logic
                }

                if (!newContent) return; // Skip if no content for write/edit
                const diffStore = useDiffStore.getState();
                const activeId = diffStore.activeSessionId;

                if (activeId) {
                  // Try to read old content for comparison
                  readTextFile(filePath)
                    .then((oldContent) => {
                      const fileDiff = generateDiff(oldContent, newContent, filePath);
                      diffStore.addFileDiff(activeId, fileDiff);
                    })
                    .catch(() => {
                      // File doesn't exist yet — it's a new file
                      const newLines = newContent.split("\n");
                      const fileDiff: FileDiff = {
                        filePath,
                        status: "added",
                        hunks: [
                          {
                            id: `hunk-0`,
                            oldStart: 0,
                            oldLines: 0,
                            newStart: 1,
                            newLines: newLines.length,
                            oldContent: [],
                            newContent: newLines,
                            header: `@@ -0,0 +1,${newLines.length} @@`,
                            accepted: null,
                          },
                        ],
                        oldContent: "",
                        newContent,
                      };
                      diffStore.addFileDiff(activeId, fileDiff);
                    });
                }
              }
            }
          } catch {
            // Content wasn't JSON — not a tool_call event, ignore
          }
        }
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

    setState((prev) => ({ ...prev, status: "working", progress: 0, tasksCompleted: 0, totalTasks: 0, logs: [], streamingText: "", isStreaming: false }));

    try {
      const sid = await invoke<string>("start_agent", {
        goal: state.goal,
        projectPath: "~/construct-projects/default",
        mode: agentMode,
      });
      setSessionId(sid);
      // Create a diff session to track file changes from this agent run
      useDiffStore.getState().createSession(sid, []);

      // Start SSE streaming for real-time token-level updates
      invoke("stream_agent_events", { sessionId: sid }).catch((err) => {
        console.warn("SSE stream failed (falling back to polling):", err);
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: "error",
        streamingText: "",
        isStreaming: false,
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
  }, [state.goal, agentMode]);

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

  // Keep ref in sync for command palette agent actions
  agentActionRef.current = { start: startAgent, stop: stopAgent, pause: pauseAgent, resume: resumeAgent };

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

  // ── Derive pending changes from diff store ──
  const diffStoreFileDiffs = useDiffStore((s) => {
    if (!s.activeSessionId) return [];
    const session = s.sessions.get(s.activeSessionId);
    return session?.fileDiffs ?? [];
  });

  /** Convert a FileDiff (from store) to PendingChange (for InlineDiff) */
  const fileDiffToPendingChange = useCallback(
    (fd: FileDiff): PendingChange => {
      const hunks: InlineDiffHunk[] = fd.hunks.map((h: DiffHunk) => {
        const lines: DiffLine[] = [];
        const maxLen = Math.max(h.oldContent.length, h.newContent.length);
        let oldLine = h.oldStart;
        let newLine = h.newStart;

        // Interleave old (removed) and new (added) lines
        for (let i = 0; i < maxLen; i++) {
          const hasOld = i < h.oldContent.length;
          const hasNew = i < h.newContent.length;

          if (hasOld && hasNew && h.oldContent[i] === h.newContent[i]) {
            lines.push({ type: "context", content: h.oldContent[i], lineNumber: oldLine });
            oldLine++;
            newLine++;
          } else {
            if (hasOld) {
              lines.push({ type: "remove", content: h.oldContent[i], lineNumber: oldLine });
              oldLine++;
            }
            if (hasNew) {
              lines.push({ type: "add", content: h.newContent[i], lineNumber: newLine });
              newLine++;
            }
          }
        }

        return {
          oldStart: h.oldStart,
          oldLines: h.oldLines,
          newStart: h.newStart,
          newLines: h.newLines,
          lines,
        };
      });

      // Determine overall accepted status from hunks
      const allHunksAccepted = fd.hunks.every((h) => h.accepted === true);
      const allHunksRejected = fd.hunks.every((h) => h.accepted === false);
      const anyPending = fd.hunks.some((h) => h.accepted === null);
      const acceptedStatus: boolean | null = anyPending
        ? null
        : allHunksAccepted
          ? true
          : allHunksRejected
            ? false
            : null;

      return {
        id: fd.filePath,
        filePath: fd.filePath,
        description: `${fd.status}: ${fd.filePath}`,
        hunks,
        accepted: acceptedStatus,
      };
    },
    []
  );

  const pendingChanges = useMemo<PendingChange[]>(
    () => diffStoreFileDiffs.map(fileDiffToPendingChange),
    [diffStoreFileDiffs, fileDiffToPendingChange]
  );

  // ── diff action handlers (wired to useDiffStore) ──
  const handleAcceptChange = useCallback(
    (id: string) => {
      const activeId = useDiffStore.getState().activeSessionId;
      if (!activeId) return;
      // Accept all hunks for this file
      const session = useDiffStore.getState().sessions.get(activeId);
      if (!session) return;
      const fd = session.fileDiffs.find((f) => f.filePath === id);
      if (!fd) return;
      for (const h of fd.hunks) {
        useDiffStore.getState().acceptHunk(activeId, id, h.id);
      }
      setState((prev) => ({
        ...prev,
        logs: [
          ...prev.logs,
          {
            timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
            level: "OK",
            message: `accepted changes in ${id}`,
            source: "diff",
          },
        ],
      }));
    },
    []
  );

  const handleRejectChange = useCallback(
    (id: string) => {
      const activeId = useDiffStore.getState().activeSessionId;
      if (!activeId) return;
      const session = useDiffStore.getState().sessions.get(activeId);
      if (!session) return;
      const fd = session.fileDiffs.find((f) => f.filePath === id);
      if (!fd) return;
      for (const h of fd.hunks) {
        useDiffStore.getState().rejectHunk(activeId, id, h.id);
      }
      setState((prev) => ({
        ...prev,
        logs: [
          ...prev.logs,
          {
            timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
            level: "WRN",
            message: `rejected changes in ${id}`,
            source: "diff",
          },
        ],
      }));
    },
    []
  );

  const handleAcceptAll = useCallback(() => {
    const activeId = useDiffStore.getState().activeSessionId;
    if (activeId) useDiffStore.getState().acceptAll(activeId);
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
    const activeId = useDiffStore.getState().activeSessionId;
    if (activeId) useDiffStore.getState().rejectAll(activeId);
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

  // ── Apply accepted diffs to disk ──
  const applyAcceptedDiffs = useCallback(async () => {
    const { activeSessionId, sessions } = useDiffStore.getState();
    if (!activeSessionId) return;
    const session = sessions.get(activeSessionId);
    if (!session) return;

    let appliedCount = 0;
    let errorCount = 0;

    for (const fileDiff of session.fileDiffs) {
      const acceptedHunks = fileDiff.hunks.filter((h) => h.accepted === true);
      const rejectedHunks = fileDiff.hunks.filter((h) => h.accepted === false);

      // Skip if no decisions made on this file
      if (acceptedHunks.length === 0 && rejectedHunks.length === 0) {
        continue;
      }

      // Reconstruct final content from accepted hunks applied to oldContent
      let finalContent = fileDiff.oldContent;

      // Sort accepted hunks by oldStart descending so we apply from bottom to top
      // This prevents earlier hunks from shifting line numbers of later hunks
      const sortedAccepted = [...acceptedHunks].sort(
        (a, b) => b.oldStart - a.oldStart
      );

      for (const hunk of sortedAccepted) {
        if (!finalContent && hunk.oldStart <= 1) {
          // New file — just use new content directly
          finalContent = hunk.newContent.join("\n");
        } else {
          // Apply hunk to existing content
          const oldLines = finalContent.split("\n");
          const before = oldLines.slice(0, hunk.oldStart - 1);
          const after = oldLines.slice(hunk.oldStart - 1 + hunk.oldLines);
          finalContent = [...before, ...hunk.newContent, ...after].join("\n");
        }
      }

      // Write to disk using Tauri FS plugin
      try {
        await writeTextFile(fileDiff.filePath, finalContent);
        appliedCount++;

        setState((prev) => ({
          ...prev,
          logs: [
            ...prev.logs,
            {
              timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
              level: "OK",
              message: `applied ${acceptedHunks.length} hunks to ${fileDiff.filePath}`,
              source: "diff",
            },
          ],
        }));
      } catch (err) {
        errorCount++;
        setState((prev) => ({
          ...prev,
          logs: [
            ...prev.logs,
            {
              timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
              level: "ERR",
              message: `failed to write ${fileDiff.filePath}: ${err}`,
              source: "diff",
            },
          ],
        }));
      }
    }

    if (appliedCount > 0 || errorCount > 0) {
      setState((prev) => ({
        ...prev,
        logs: [
          ...prev.logs,
          {
            timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
            level: errorCount > 0 ? "WRN" : "OK",
            message: `apply complete: ${appliedCount} files written, ${errorCount} errors`,
            source: "diff",
          },
        ],
      }));
    }
  }, []);

  // Count of still-pending hunks across all files
  const pendingCount = useDiffStore((s) => s.getPendingCount());

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

      {/* ── STREAMING INDICATOR ── */}
      {state.isStreaming && (
        <div
          className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04]"
          style={{
            backgroundColor: "rgba(139, 92, 246, 0.08)",
          }}
        >
          <div
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: "#8b5cf6",
              animation: "pulse 1.5s infinite",
            }}
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{
              fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
              color: "#a78bfa",
            }}
          >
            Agent is thinking...
          </span>
          {state.streamingText && (
            <span
              className="flex-1 text-[10px] leading-4 truncate"
              style={{
                fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
                color: "#a78bfa",
                opacity: 0.8,
              }}
            >
              {state.streamingText.slice(-200)}
            </span>
          )}
        </div>
      )}

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
          <div className="flex flex-col h-full">
            {/* Apply/Reject toolbar for accepted diffs */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04]" style={{ backgroundColor: C.s1 }}>
              <button
                onClick={applyAcceptedDiffs}
                className="px-3 py-1.5 rounded text-[10px] font-semibold uppercase tracking-[0.06em] cursor-pointer border-none"
                style={{
                  fontFamily: 'inherit',
                  backgroundColor: "#22c55e",
                  color: "#fff",
                }}
              >
                Apply Accepted Changes
              </button>
              <button
                onClick={handleRejectAll}
                className="px-3 py-1.5 rounded text-[10px] font-semibold uppercase tracking-[0.06em] cursor-pointer border-none"
                style={{
                  fontFamily: 'inherit',
                  backgroundColor: "#ef4444",
                  color: "#fff",
                }}
              >
                Reject All
              </button>
              <span className="text-[9px] ml-auto" style={{ color: C.t3, fontFamily: '"Geist Mono", monospace' }}>
                {pendingCount} pending · accept hunks then click Apply
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <InlineDiff
                changes={pendingChanges}
                onAccept={handleAcceptChange}
                onReject={handleRejectChange}
                onAcceptAll={handleAcceptAll}
                onRejectAll={handleRejectAll}
              />
            </div>
          </div>
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
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}

export default AgentPanel;
