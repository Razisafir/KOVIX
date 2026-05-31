import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import type { LogEntry } from "./TerminalOutput";
import { type PendingChange, type DiffHunk_ as InlineDiffHunk } from "./InlineDiff";
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
  const [_thinkingOpen, _setThinkingOpen] = useState(true);
  const [fileInput, setFileInput] = useState("");
  const agentMode = useAppStore((s) => s.agentMode);
  const _setAgentMode = useAppStore((s) => s.setAgentMode);
  const [_viewMode, _setViewMode] = useState<"terminal" | "diff">("terminal");

  const agentActionRef = useRef<{ start: () => void; stop: () => void; pause: () => void; resume: () => void }>({
    start: () => {},
    stop: () => {},
    pause: () => {},
    resume: () => {},
  });

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
              newStreamingText = "";
              newIsStreaming = false;
              break;
            case "token":
              newStreamingText = prev.streamingText + content;
              newIsStreaming = true;
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
              newStreamingText = "";
              newIsStreaming = false;
              if (prev.status === "working") newStatus = "idle";
              break;
            case "stream_error":
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

        if (type === "tool_call" || type === "file_change") {
          try {
            const data = JSON.parse(content);
            const toolName = data.tool || data.tool_name;
            if (toolName === "write_file" || toolName === "edit_file" || toolName === "create_file" || toolName === "delete_file") {
              const filePath = data.arguments?.path || data.arguments?.file_path || data.path || "";
              const newContent = data.arguments?.content || data.content || "";

              if (filePath) {
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
                          hunks: [{
                            id: "hunk-0",
                            oldStart: 1,
                            oldLines: oldLines.length,
                            newStart: 0,
                            newLines: 0,
                            oldContent: oldLines,
                            newContent: [],
                            header: `@@ -1,${oldLines.length} +0,0 @@`,
                            accepted: null,
                          }],
                          oldContent,
                          newContent: "",
                        };
                        diffStore.addFileDiff(activeId, fileDiff);
                      })
                      .catch(() => {
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
                  return;
                }

                if (!newContent) return;
                const diffStore = useDiffStore.getState();
                const activeId = diffStore.activeSessionId;

                if (activeId) {
                  readTextFile(filePath)
                    .then((oldContent) => {
                      const fileDiff = generateDiff(oldContent, newContent, filePath);
                      diffStore.addFileDiff(activeId, fileDiff);
                    })
                    .catch(() => {
                      const newLines = newContent.split("\n");
                      const fileDiff: FileDiff = {
                        filePath,
                        status: "added",
                        hunks: [{
                          id: `hunk-0`,
                          oldStart: 0,
                          oldLines: 0,
                          newStart: 1,
                          newLines: newLines.length,
                          oldContent: [],
                          newContent: newLines,
                          header: `@@ -0,0 +1,${newLines.length} @@`,
                          accepted: null,
                        }],
                        oldContent: "",
                        newContent,
                      };
                      diffStore.addFileDiff(activeId, fileDiff);
                    });
                }
              }
            }
          } catch {
            // Content wasn't JSON
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
      useDiffStore.getState().createSession(sid, []);

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

  agentActionRef.current = { start: startAgent, stop: stopAgent, pause: pauseAgent, resume: resumeAgent };

  const _handleCommand = useCallback((cmd: string) => {
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

  const _handleRemoveFile = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      attachedFiles: prev.attachedFiles.filter((f) => f.id !== id),
    }));
  }, []);

  const _handleFileInputKeyDown = useCallback(
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

  const _toggleAuto = useCallback(() => {
    setState((prev) => ({ ...prev, autoMode: !prev.autoMode }));
  }, []);

  const diffStoreFileDiffs = useDiffStore((s) => {
    if (!s.activeSessionId) return [];
    const session = s.sessions.get(s.activeSessionId);
    return session?.fileDiffs ?? [];
  });

  const fileDiffToPendingChange = useCallback(
    (fd: FileDiff): PendingChange => {
      const hunks: InlineDiffHunk[] = fd.hunks.map((h: DiffHunk) => {
        const lines: DiffLine[] = [];
        const maxLen = Math.max(h.oldContent.length, h.newContent.length);
        let oldLine = h.oldStart;
        let newLine = h.newStart;

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

  const _pendingChanges = useMemo<PendingChange[]>(
    () => diffStoreFileDiffs.map(fileDiffToPendingChange),
    [diffStoreFileDiffs, fileDiffToPendingChange]
  );

  const _handleAcceptChange = useCallback(
    (id: string) => {
      const activeId = useDiffStore.getState().activeSessionId;
      if (!activeId) return;
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

  const _handleRejectChange = useCallback(
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

  const _handleAcceptAll = useCallback(() => {
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

  const _handleRejectAll = useCallback(() => {
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

  const _applyAcceptedDiffs = useCallback(async () => {
    const { activeSessionId, sessions } = useDiffStore.getState();
    if (!activeSessionId) return;
    const session = sessions.get(activeSessionId);
    if (!session) return;

    let appliedCount = 0;
    let errorCount = 0;

    for (const fileDiff of session.fileDiffs) {
      const acceptedHunks = fileDiff.hunks.filter((h) => h.accepted === true);
      const rejectedHunks = fileDiff.hunks.filter((h) => h.accepted === false);

      if (acceptedHunks.length === 0 && rejectedHunks.length === 0) {
        continue;
      }

      let finalContent = fileDiff.oldContent;
      const sortedAccepted = [...acceptedHunks].sort(
        (a, b) => b.oldStart - a.oldStart
      );

      for (const hunk of sortedAccepted) {
        if (!finalContent && hunk.oldStart <= 1) {
          finalContent = hunk.newContent.join("\n");
        } else {
          const oldLines = finalContent.split("\n");
          const before = oldLines.slice(0, hunk.oldStart - 1);
          const after = oldLines.slice(hunk.oldStart - 1 + hunk.oldLines);
          finalContent = [...before, ...hunk.newContent, ...after].join("\n");
        }
      }

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

  const _pendingCount = useDiffStore((s) => s.getPendingCount());

  // Suppress unused-local warnings for callbacks reserved for future wiring
  void _setAgentMode; void _thinkingOpen; void _setThinkingOpen;
  void _viewMode; void _setViewMode; void _handleCommand;
  void _handleRemoveFile; void _handleFileInputKeyDown;
  void _toggleAuto; void _pendingChanges; void _handleAcceptChange;
  void _handleRejectChange; void _handleAcceptAll; void _handleRejectAll;
  void _applyAcceptedDiffs; void _pendingCount;

  /* Status-dependent classes for the status badge pill */
  const statusPillClasses = {
    idle: "bg-accent-cyan-dim border-accent-cyan/30 text-accent-cyan",
    working: "bg-status-running-bg border-status-running/30 text-status-running",
    paused: "bg-accent-gold-dim border-accent-gold/30 text-accent-gold",
    stopped: "bg-tertiary-dim border-tertiary/30 text-tertiary",
    error: "bg-diff-remove-bg border-diff-remove/30 text-diff-remove",
  };

  const statusDotClasses = {
    idle: "bg-accent-cyan",
    working: "bg-status-running animate-pulse",
    paused: "bg-accent-gold animate-pulse",
    stopped: "bg-tertiary",
    error: "bg-diff-remove animate-pulse",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-panel-bg font-mono glass-panel">
      {/* ── Agent Header ── */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-border-subtle">
        <div className="flex items-center gap-2 text-lg font-medium font-sans text-text-primary">
          <span className="material-symbols-outlined">smart_toy</span>
          Agent
        </div>
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono border ${statusPillClasses[state.status]}`}
        >
          <span
            className={`w-2 h-2 rounded-full ${statusDotClasses[state.status]}`}
          />
          {state.status}
        </div>
      </div>

      {/* ── Memory Context Banner ── */}
      <div className="p-4 border-b border-border-subtle">
        <div className="bg-bg-onyx border border-diff-add/30 rounded-md p-2 flex items-center gap-2 text-sm text-diff-add">
          <span className="material-symbols-outlined text-[18px]">memory</span>
          Recalled 3 relevant memories
        </div>
        <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden flex">
          <div className="h-full w-1/3 bg-accent-cyan" />
          <div className="h-full w-1/3 bg-diff-add" />
          <div className="h-full w-1/3 bg-transparent" />
        </div>
      </div>

      {/* ── Timeline ── */}
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-6 relative">
        {/* Vertical Line */}
        <div className="absolute left-[31px] top-4 bottom-4 w-[2px] bg-border-subtle z-0" />

        {/* Item 1: Read Context */}
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-md bg-bg-onyx border border-border-subtle flex items-center justify-center flex-shrink-0 mt-1">
            <span className="material-symbols-outlined text-[16px] text-text-secondary">description</span>
          </div>
          <div>
            <div className="text-sm font-medium font-sans text-text-primary">Read memory context</div>
            <div className="text-xs text-text-secondary mt-1">FastAPI project · snake_case · ruff · async</div>
          </div>
        </div>

        {/* Item 2: Scanned structure */}
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-md bg-bg-onyx border border-border-subtle flex items-center justify-center flex-shrink-0 mt-1">
            <span className="material-symbols-outlined text-[16px] text-text-secondary">folder_open</span>
          </div>
          <div>
            <div className="text-sm font-medium font-sans text-text-primary">Scanned project structure</div>
            <div className="text-xs text-text-secondary mt-1">8 files · 1,240 lines · 2 open issues</div>
          </div>
        </div>

        {/* Item 3: Proposing diff (active - with cyan glow) */}
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-md bg-bg-onyx border border-accent-cyan/50 text-accent-cyan flex items-center justify-center flex-shrink-0 mt-1 shadow-[0_0_10px_rgba(0,245,255,0.2)]">
            <span className="material-symbols-outlined text-[16px]">edit</span>
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium font-sans text-text-primary">Proposing diff — main.py</div>
            <div className="text-xs text-text-secondary mt-1">Add pending_diff buffer for plan/act mode</div>
            {/* Diff Snippet */}
            <div className="mt-3 bg-bg-onyx rounded-md border border-border-subtle p-2 font-mono text-xs overflow-x-auto">
              <div className="text-diff-add whitespace-pre">+ app.state.pending_diff = []</div>
              <div className="text-diff-remove whitespace-pre">- app.include_router(legacy_router)</div>
            </div>
          </div>
        </div>

        {/* Item 4: Run tests (pending) */}
        <div className="flex gap-4 relative z-10 opacity-50">
          <div className="w-8 h-8 rounded-md bg-bg-onyx border border-border-subtle flex items-center justify-center flex-shrink-0 mt-1">
            <span className="material-symbols-outlined text-[16px] text-text-secondary">play_arrow</span>
          </div>
          <div>
            <div className="text-sm font-medium font-sans text-text-primary">Run tests after apply</div>
            <div className="text-xs text-text-secondary mt-1">pytest tests/ — awaiting approval</div>
          </div>
        </div>

        {/* Item 5: Commit (pending) */}
        <div className="flex gap-4 relative z-10 opacity-50">
          <div className="w-8 h-8 rounded-md bg-bg-onyx border border-border-subtle flex items-center justify-center flex-shrink-0 mt-1">
            <span className="material-symbols-outlined text-[16px] text-text-secondary">commit</span>
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium font-sans text-text-primary">Commit with message</div>
            <div className="mt-2 bg-bg-onyx rounded-md border border-border-subtle p-2 font-mono text-xs text-text-secondary">
              feat: add plan/act diff buffer to main.py
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Interaction Area ── */}
      <div className="p-4 border-t border-border-subtle bg-panel-bg flex flex-col gap-3">
        {/* Action Buttons */}
        <div className="flex gap-3">
          <button className="flex-1 py-2 bg-status-running-bg border border-status-running/30 text-status-running rounded-md text-sm font-medium flex items-center justify-center gap-2 hover:bg-status-running/20 transition-colors">
            <span className="material-symbols-outlined text-[18px]">check</span>
            Apply diff
          </button>
          <button className="flex-1 py-2 bg-bg-onyx border border-border-subtle text-text-secondary hover:text-text-primary rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-colors">
            <span className="material-symbols-outlined text-[18px]">close</span>
            Skip
          </button>
          <button className="w-10 flex-shrink-0 py-2 bg-bg-onyx border border-border-subtle text-diff-remove rounded-md flex items-center justify-center hover:bg-diff-remove/10 transition-colors">
            <span className="material-symbols-outlined text-[18px]">stop</span>
          </button>
        </div>
        {/* Input Box */}
        <div className="relative flex items-center bg-bg-onyx rounded-lg border border-border-subtle focus-within:border-accent-cyan/50 focus-within:shadow-[0_0_10px_rgba(0,245,255,0.1)] transition-all">
          <button className="pl-3 text-text-secondary hover:text-text-primary">
            <span className="material-symbols-outlined text-[20px]">attach_file</span>
          </button>
          <input
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-text-primary py-3 placeholder:text-text-secondary/50 outline-none caret-accent-cyan"
            placeholder="Describe next goal..."
            type="text"
          />
          <button className="pr-3 pl-2 text-text-secondary hover:text-accent-cyan transition-colors">
            <div className="w-8 h-8 rounded-md border border-border-subtle flex items-center justify-center bg-panel-bg hover:border-accent-cyan/50">
              <span className="material-symbols-outlined text-[18px]">send</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default AgentPanel;
