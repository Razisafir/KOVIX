import { useState, useEffect, useCallback, useRef } from "react";
import useAppStore from "../stores/useAppStore";
import { useDiffStore } from "../stores/useDiffStore";
import { generateDiff } from "../utils/diffParser";
import type { FileDiff } from "../types/diff";
import {
  isTauri,
  getInvoke,
  getListen,
  getReadTextFile,
  getWriteTextFile,
  reconstructContent,
} from "../utils/tauriHelpers";

// Tab configuration
const tabs = [
  { id: "chat", icon: "message_square", label: "Chat" },
  { id: "agent", icon: "smart_toy", label: "Agent" },
  { id: "memory", icon: "brain", label: "Memory" },
  { id: "skills", icon: "puzzle", label: "Skills" },
  { id: "mcp", icon: "plug", label: "MCP" },
];

/** A single chat/agent message in the panel */
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  type?: "text" | "thought" | "tool_call" | "token" | "error" | "complete";
}

function RightAgentPanel() {
  const rightPanelTab = useAppStore((s) => s.rightPanelTab);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const agentMode = useAppStore((s) => s.agentMode);
  const setAgentMode = useAppStore((s) => s.setAgentMode);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const setAgentStatus = useAppStore((s) => s.setAgentStatus);
  const setAgentSessionId = useAppStore((s) => s.setAgentSessionId);

  const [goalInput, setGoalInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Pending diff count from store
  const pendingDiffCount = useDiffStore((s) => s.getPendingCount());

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Listen for panel-tab events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) {
        setRightPanelTab(detail.tab);
      }
    };
    window.addEventListener("construct:panel-tab", handler);
    return () => window.removeEventListener("construct:panel-tab", handler);
  }, [setRightPanelTab]);

  // Listen for agent events from Rust backend when sessionId changes
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    const setupListener = async () => {
      const listenFn = getListen();
      if (!listenFn) return;

      const unlisten = await listenFn(
        `agent:${sessionId}`,
        (event: unknown) => {
          if (cancelled) return;

          const payload = (event as { payload: { type: string; content: string; timestamp: number } }).payload;
          const { type, content } = payload;

          switch (type) {
            case "thought":
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  role: "assistant",
                  content,
                  timestamp: Date.now(),
                  type: "thought",
                },
              ]);
              setStreamingText("");
              setIsStreaming(false);
              break;

            case "token":
              setStreamingText((prev) => prev + content);
              setIsStreaming(true);
              break;

            case "tool_call":
              setStreamingText("");
              setIsStreaming(false);
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  role: "assistant",
                  content,
                  timestamp: Date.now(),
                  type: "tool_call",
                },
              ]);
              // Intercept file-change tool calls and generate diffs
              handleToolCall(content);
              break;

            case "task_start":
              setAgentStatus("running");
              break;

            case "task_complete":
              break;

            case "complete":
              setAgentStatus("idle");
              setStreamingText("");
              setIsStreaming(false);
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  role: "system",
                  content: "Agent completed.",
                  timestamp: Date.now(),
                  type: "complete",
                },
              ]);
              break;

            case "error":
              setAgentStatus("failed");
              setStreamingText("");
              setIsStreaming(false);
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  role: "system",
                  content: `Error: ${content}`,
                  timestamp: Date.now(),
                  type: "error",
                },
              ]);
              break;

            case "done":
              setStreamingText("");
              setIsStreaming(false);
              if (agentStatus === "running") setAgentStatus("idle");
              break;

            case "stream_error":
            case "stream_timeout":
              setIsStreaming(false);
              break;
          }
        }
      );

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
  }, [sessionId, agentStatus, setAgentStatus]);

  /** Handle tool_call events that modify files — generate diffs and add to diff store */
  const handleToolCall = useCallback((content: string) => {
    try {
      const data = JSON.parse(content);
      const toolName = data.tool || data.tool_name;
      if (
        toolName === "write_file" ||
        toolName === "edit_file" ||
        toolName === "create_file" ||
        toolName === "delete_file"
      ) {
        const filePath = data.arguments?.path || data.arguments?.file_path || data.path || "";
        const newContent = data.arguments?.content || data.content || "";

        if (!filePath) return;

        const diffStore = useDiffStore.getState();
        const activeId = diffStore.activeSessionId;
        if (!activeId) return;

        if (toolName === "delete_file") {
          // Delete: read old content, create deletion diff
          const readFn = getReadTextFile();
          if (isTauri() && readFn) {
            readFn(filePath)
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

        // Write/create/edit file: generate diff
        const readFn = getReadTextFile();
        if (isTauri() && readFn) {
          readFn(filePath)
            .then((oldContent) => {
              const fileDiff = generateDiff(oldContent, newContent, filePath);
              diffStore.addFileDiff(activeId, fileDiff);
            })
            .catch(() => {
              // File doesn't exist — it's a new file
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
        } else {
          // Web mode: generate diff with empty old content
          const fileDiff = generateDiff("", newContent, filePath);
          diffStore.addFileDiff(activeId, fileDiff);
        }
      }
    } catch {
      // Content wasn't JSON — ignore
    }
  }, []);

  /** Start the agent with the given goal */
  const startAgent = useCallback(
    async (goal: string) => {
      if (!goal.trim() || isSending) return;

      setIsSending(true);
      setAgentStatus("running");

      // Add user message to chat
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: "user",
        content: goal,
        timestamp: Date.now(),
        type: "text",
      };
      setMessages((prev) => [...prev, userMsg]);
      setGoalInput("");
      setStreamingText("");
      setIsStreaming(false);

      try {
        if (isTauri() && getInvoke()) {
          // Tauri mode: invoke Rust backend
          const sid = await getInvoke()!("start_agent", {
            goal,
            projectPath: "~/construct-projects/default",
            mode: agentMode,
          }) as string;
          setSessionId(sid);
          setAgentSessionId(sid);
          useDiffStore.getState().createSession(sid, []);

          // Start SSE stream for real-time tokens
          getInvoke()!("stream_agent_events", { sessionId: sid }).catch((err: unknown) => {
            console.warn("[RightAgentPanel] SSE stream failed (falling back to polling):", err);
          });
        } else {
          // Web mode: simulate agent response via backend API
          try {
            const response = await fetch("http://127.0.0.1:8000/agent/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                goal,
                project_path: ".",
                mode: agentMode,
              }),
            });
            if (response.ok) {
              const data = await response.json();
              const sid = data.session_id;
              setSessionId(sid);
              setAgentSessionId(sid);
              useDiffStore.getState().createSession(sid, []);

              // Start polling for events
              pollAgentOutput(sid);
            } else {
              throw new Error(`Agent start failed: ${response.status}`);
            }
          } catch (apiErr) {
            // Backend not available — show mock response
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}-mock`,
                role: "assistant",
                content: `I'll help you with: "${goal}". (Agent backend not connected — running in demo mode)`,
                timestamp: Date.now(),
                type: "thought",
              },
            ]);
            setAgentStatus("idle");
          }
        }
      } catch (err) {
        setAgentStatus("failed");
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-error`,
            role: "system",
            content: `Failed to start agent: ${err}`,
            timestamp: Date.now(),
            type: "error",
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [agentMode, isSending, setAgentStatus, setAgentSessionId]
  );

  /** Poll agent output from the HTTP API (fallback when Tauri events aren't available) */
  const pollAgentOutput = useCallback(
    (sid: string) => {
      let since = 0;
      const interval = setInterval(async () => {
        try {
          const response = await fetch(
            `http://127.0.0.1:8000/agent/${sid}/output?since=${since}`
          );
          if (!response.ok) {
            clearInterval(interval);
            return;
          }
          const data = await response.json();
          if (data.events && data.events.length > 0) {
            since += data.events.length;
            for (const event of data.events) {
              const { type, content } = event;
              switch (type) {
                case "thought":
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                      role: "assistant",
                      content,
                      timestamp: Date.now(),
                      type: "thought",
                    },
                  ]);
                  break;
                case "tool_call":
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                      role: "assistant",
                      content,
                      timestamp: Date.now(),
                      type: "tool_call",
                    },
                  ]);
                  handleToolCall(content);
                  break;
                case "complete":
                  setAgentStatus("idle");
                  clearInterval(interval);
                  break;
                case "error":
                  setAgentStatus("failed");
                  clearInterval(interval);
                  break;
              }
            }
          }

          // Check if session is done
          const statusResp = await fetch(`http://127.0.0.1:8000/agent/${sid}/status`);
          if (statusResp.ok) {
            const statusData = await statusResp.json();
            if (["completed", "failed", "waiting"].includes(statusData.status)) {
              setAgentStatus("idle");
              clearInterval(interval);
            }
          }
        } catch {
          clearInterval(interval);
        }
      }, 1000);
    },
    [handleToolCall, setAgentStatus]
  );

  /** Apply all accepted diffs to disk */
  const applyAcceptedDiffs = useCallback(async () => {
    const { activeSessionId: activeId, sessions } = useDiffStore.getState();
    if (!activeId) return;
    const session = sessions.get(activeId);
    if (!session) return;

    let appliedCount = 0;

    for (const fileDiff of session.fileDiffs) {
      const acceptedHunks = fileDiff.hunks.filter((h) => h.accepted === true);
      if (acceptedHunks.length === 0) continue;

      const finalContent = reconstructContent(fileDiff.oldContent, fileDiff.hunks);

      try {
        const writeFn = getWriteTextFile();
        if (isTauri() && writeFn) {
          await writeFn(fileDiff.filePath, finalContent);
          console.log("[RightAgentPanel] Wrote to disk:", fileDiff.filePath);
        }
        appliedCount++;
      } catch (err) {
        console.error("[RightAgentPanel] Failed to write:", fileDiff.filePath, err);
      }
    }

    if (appliedCount > 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-apply`,
          role: "system",
          content: `Applied ${appliedCount} file(s) to disk.`,
          timestamp: Date.now(),
          type: "complete",
        },
      ]);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        startAgent(goalInput);
      }
    },
    [goalInput, startAgent]
  );

  const handleSendClick = useCallback(() => {
    startAgent(goalInput);
  }, [goalInput, startAgent]);

  const renderChatContent = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Chat messages area */}
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
        {/* Welcome message if no messages */}
        {messages.length === 0 && (
          <div className="glass-panel p-4" style={{ animation: "fade-in 300ms ease" }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-accent-cyan text-[20px]">smart_toy</span>
              <span className="text-sm font-medium font-sans text-text-primary">Construct Agent</span>
            </div>
            <div className="text-xs text-text-secondary leading-relaxed">
              I can help you code, debug, review, and manage your project. 
              Describe what you want to accomplish.
            </div>
          </div>
        )}

        {/* Render messages */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`glass-panel p-3 ${
              msg.role === "user"
                ? "border-accent-cyan/20"
                : msg.type === "error"
                  ? "border-diff-remove/30"
                  : msg.type === "complete"
                    ? "border-diff-add/30"
                    : ""
            }`}
            style={{ animation: "fade-in 200ms ease" }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-[14px] text-text-secondary">
                {msg.role === "user"
                  ? "person"
                  : msg.type === "thought"
                    ? "psychology"
                    : msg.type === "tool_call"
                      ? "build"
                      : msg.type === "error"
                        ? "error"
                        : "smart_toy"}
              </span>
              <span className="text-[10px] font-mono text-text-secondary uppercase">
                {msg.role === "user" ? "You" : msg.type || "Agent"}
              </span>
            </div>
            <div className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap break-words">
              {msg.type === "tool_call" ? (
                <details>
                  <summary className="cursor-pointer text-accent-cyan text-[11px]">
                    Tool call — click to expand
                  </summary>
                  <pre className="mt-1 text-[10px] text-text-secondary overflow-auto max-h-40">
                    {msg.content}
                  </pre>
                </details>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {/* Streaming text */}
        {isStreaming && streamingText && (
          <div className="glass-panel p-3 border-accent-cyan/20" style={{ animation: "fade-in 200ms ease" }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-[14px] text-accent-cyan animate-pulse">psychology</span>
              <span className="text-[10px] font-mono text-accent-cyan uppercase">Thinking</span>
            </div>
            <div className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap">
              {streamingText}
              <span className="animate-pulse text-accent-cyan">|</span>
            </div>
          </div>
        )}

        {/* Apply Changes button when there are pending diffs */}
        {pendingDiffCount > 0 && !isStreaming && (
          <div className="glass-panel p-3 border-diff-add/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-diff-add">difference</span>
                <span className="text-xs text-diff-add font-mono">{pendingDiffCount} pending change(s)</span>
              </div>
              <button
                onClick={applyAcceptedDiffs}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[10px] font-mono font-semibold border cursor-pointer transition-colors"
                style={{
                  backgroundColor: "rgba(74, 222, 128, 0.1)",
                  borderColor: "rgba(74, 222, 128, 0.3)",
                  color: "var(--c-ok)",
                }}
              >
                <span className="material-symbols-outlined text-[12px]">check</span>
                Apply Accepted
              </button>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>
    </div>
  );

  const renderAgentContent = () => (
    <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
      {/* Agent mode selector */}
      <div className="glass-panel p-3">
        <div className="micro-label text-text-secondary mb-2">Mode</div>
        <div className="flex flex-wrap gap-1.5">
          {(["code", "architect", "debug", "review", "security", "devops"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setAgentMode(mode)}
              className={`text-[10px] font-mono px-2.5 py-1 rounded-md border cursor-pointer transition-all duration-150 ${
                agentMode === mode
                  ? "bg-accent-cyan-dim border-accent-cyan/40 text-accent-cyan"
                  : "bg-transparent border-border-subtle text-text-secondary hover:text-text-primary hover:border-text-secondary/30"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Agent status */}
      <div className="glass-panel p-3">
        <div className="flex items-center justify-between">
          <div className="micro-label text-text-secondary">Status</div>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border ${
            agentStatus === "idle" ? "bg-accent-cyan-dim border-accent-cyan/30 text-accent-cyan" :
            agentStatus === "running" ? "bg-status-running-bg border-status-running/30 text-status-running" :
            "bg-accent-gold-dim border-accent-gold/30 text-accent-gold"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              agentStatus === "idle" ? "led-cyan" :
              agentStatus === "running" ? "led-green" :
              "led-gold"
            }`} />
            {agentStatus}
          </div>
        </div>
        <div className="mt-2 text-[11px] font-mono text-text-secondary">
          Model: claude-sonnet-4-20250514
        </div>
      </div>

      {/* Session info */}
      {sessionId && (
        <div className="glass-panel p-3">
          <div className="micro-label text-text-secondary mb-1">Session</div>
          <div className="text-[11px] font-mono text-accent-cyan">{sessionId}</div>
        </div>
      )}

      {/* Memory context */}
      <div className="glass-panel p-3">
        <div className="flex items-center gap-2 text-xs text-diff-add mb-2">
          <span className="material-symbols-outlined text-[16px]">memory</span>
          <span className="font-mono">3 memories recalled</span>
        </div>
        <div className="flex gap-1.5">
          {["auth-flow", "api-integration", "ui-components"].map((tag) => (
            <span key={tag} className="text-[9px] font-mono px-2 py-0.5 rounded bg-diff-add/10 text-diff-add border border-diff-add/20">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  const renderMemoryContent = () => (
    <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
      {/* Memory search */}
      <div className="input-glass flex items-center px-3 py-2">
        <span className="material-symbols-outlined text-[14px] text-text-secondary mr-2">search</span>
        <input
          type="text"
          placeholder="Search memories..."
          className="flex-1 bg-transparent border-none outline-none text-[11px] font-mono text-text-primary placeholder:text-text-secondary/50"
        />
      </div>
      {/* Memory stats */}
      <div className="glass-panel p-3">
        <div className="micro-label text-text-secondary mb-2">Usage</div>
        <div className="font-mono text-[11px] text-text-secondary space-y-1">
          <div className="flex justify-between"><span>Contexts</span><span className="text-accent-cyan">1,247</span></div>
          <div className="flex justify-between"><span>Vectors</span><span className="text-accent-cyan">8,932</span></div>
          <div className="flex justify-between"><span>Tokens</span><span className="text-accent-gold">12,456 / 200K</span></div>
        </div>
        <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full w-[6%] bg-accent-cyan rounded-full" style={{ boxShadow: "0 0 8px rgba(0, 229, 255, 0.4)" }} />
        </div>
      </div>
    </div>
  );

  const renderSkillsContent = () => (
    <div className="flex-1 overflow-auto p-4">
      <div className="glass-panel p-3 text-center">
        <span className="material-symbols-outlined text-[24px] text-accent-cyan mb-2">extension</span>
        <div className="text-xs text-text-secondary">Skill marketplace coming soon</div>
      </div>
    </div>
  );

  const renderMcpContent = () => (
    <div className="flex-1 overflow-auto p-4">
      <div className="glass-panel p-3 text-center">
        <span className="material-symbols-outlined text-[24px] text-accent-gold mb-2">hub</span>
        <div className="text-xs text-text-secondary">MCP connectors coming soon</div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (rightPanelTab) {
      case "chat": return renderChatContent();
      case "agent": return renderAgentContent();
      case "memory": return renderMemoryContent();
      case "skills": return renderSkillsContent();
      case "mcp": return renderMcpContent();
      default: return renderChatContent();
    }
  };

  return (
    <aside className="flex flex-col h-full glass-panel-heavy" style={{ width: 380, borderLeft: "1px solid var(--glass-border)" }}>
      {/* ── Panel Header ── */}
      <div className="h-12 px-4 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${
            agentStatus === "running" ? "bg-status-running animate-pulse" :
            agentStatus === "idle" ? "led-cyan" :
            "led-gold"
          }`} />
          <span className="text-sm font-medium font-sans text-text-primary">Agent</span>
          {sessionId && (
            <span className="text-[9px] font-mono text-text-secondary ml-1">{sessionId.slice(0, 8)}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setRightPanelTab("chat")}
            className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-accent-cyan hover:bg-accent-cyan-dim transition-colors cursor-pointer border-none bg-transparent"
            title="New chat"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
          </button>
          <button
            onClick={toggleRightPanel}
            className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors cursor-pointer border-none bg-transparent"
            title="Close panel"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex items-center shrink-0 px-2 gap-0.5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        {tabs.map((tab) => {
          const isActive = rightPanelTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setRightPanelTab(tab.id)}
              className={`flex items-center gap-1.5 px-2.5 py-2 text-[10px] font-mono uppercase tracking-wider font-semibold border-0 cursor-pointer transition-all duration-150 rounded-t-md ${
                isActive
                  ? "text-accent-cyan border-b-2 border-b-accent-cyan bg-accent-cyan-dim/50"
                  : "text-text-secondary border-b-2 border-b-transparent bg-transparent hover:text-text-primary"
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col" style={{ background: "rgba(12, 14, 17, 0.4)" }}>
        {renderContent()}
      </div>

      {/* ── Bottom Input Area ── */}
      <div className="shrink-0 p-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--glass-border)", background: "var(--glass-bg-heavy)" }}>
        {/* Model selector + attach */}
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-md bg-transparent border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-cyan/30 cursor-pointer transition-colors">
            <span className="material-symbols-outlined text-[12px]">neurology</span>
            Claude Sonnet
          </button>
          <button className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-accent-cyan bg-transparent border border-border-subtle cursor-pointer transition-colors">
            <span className="material-symbols-outlined text-[13px]">attach_file</span>
          </button>
          <button className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-accent-cyan bg-transparent border border-border-subtle cursor-pointer transition-colors">
            <span className="material-symbols-outlined text-[13px]">code</span>
          </button>
        </div>
        {/* Input box */}
        <div className="flex items-center input-glass px-3 py-2.5">
          <input
            type="text"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything... (@ to mention, / for commands)"
            disabled={isSending}
            className="flex-1 bg-transparent border-none outline-none text-[12px] font-sans text-text-primary placeholder:text-text-secondary/50 caret-accent-cyan disabled:opacity-50"
          />
          <button
            onClick={handleSendClick}
            disabled={!goalInput.trim() || isSending}
            className="ml-2 w-8 h-8 rounded-lg btn-primary flex items-center justify-center text-bg-onyx disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-opacity"
          >
            <span className="material-symbols-outlined text-[16px]">
              {isSending ? "hourglass_top" : "arrow_upward"}
            </span>
          </button>
        </div>
        <div className="text-[9px] text-text-secondary/40 text-center font-mono">
          AI may make mistakes. Review generated code.
        </div>
      </div>
    </aside>
  );
}

export default RightAgentPanel;
