import { useState } from "react";

/* ─── Types ─── */
interface Agent {
  id: string;
  role: string;
  status: "idle" | "working";
  task: string;
  progress: number;
  time: string;
  color: string;
}

interface AgentMessage {
  id: string;
  timestamp: string;
  from: string;
  to: string;
  type: "REQ" | "RES" | "CMP" | "ERR";
  content: string;
}

/* ─── Colors ─── */
const BASE = "#0c0c10";
const S1 = "#12121a";
const S2 = "#1a1a24";

const ACCENT = "#6366f1";
const TEXT = "#e8e8ec";
const TEXT_MUTED = "#94949c";
const TEXT_DIM = "#6b6b73";
const TEXT_FAINT = "#4a4a52";
const BORDER = "rgba(255,255,255,0.04)";
const GREEN = "#22c55e";
const RED = "#ef4444";
const AMBER = "#f59e0b";
const CYAN = "#06b6d4";
const ff = '"Geist Mono", "JetBrains Mono", monospace';

/* ─── Demo Data ─── */
const roleColors: Record<string, string> = {
  code: ACCENT,
  security: GREEN,
  ui: AMBER,
  research: CYAN,
  devops: "#ec4899",
  test: "#a855f7",
};

const demoAgents: Agent[] = [
  { id: "a1", role: "code", status: "working", task: "DashboardLayout.tsx", progress: 67, time: "00:32", color: ACCENT },
  { id: "a2", role: "security", status: "idle", task: "--", progress: 0, time: "--", color: GREEN },
  { id: "a3", role: "ui", status: "idle", task: "--", progress: 0, time: "--", color: AMBER },
  { id: "a4", role: "research", status: "idle", task: "--", progress: 0, time: "--", color: CYAN },
  { id: "a5", role: "devops", status: "idle", task: "--", progress: 0, time: "--", color: "#ec4899" },
];

const demoMessages: AgentMessage[] = [
  { id: "m1", timestamp: "14:32:05", from: "code", to: "security", type: "REQ", content: "review auth implementation" },
  { id: "m2", timestamp: "14:32:08", from: "security", to: "code", type: "RES", content: "approved, no issues found" },
  { id: "m3", timestamp: "14:33:12", from: "code", to: "ui", type: "REQ", content: "design review for DashboardLayout" },
  { id: "m4", timestamp: "14:33:45", from: "ui", to: "code", type: "RES", content: "spacing needs adjustment, check padding on sidebar" },
  { id: "m5", timestamp: "14:34:01", from: "code", to: "ui", type: "CMP", content: "padding fixed, pushed changes" },
  { id: "m6", timestamp: "14:34:22", from: "code", to: "devops", type: "REQ", content: "deploy staging build" },
  { id: "m7", timestamp: "14:35:10", from: "devops", to: "code", type: "CMP", content: "deployed to staging" },
];

const typeColors: Record<string, string> = {
  REQ: ACCENT,
  RES: GREEN,
  CMP: CYAN,
  ERR: RED,
};

export default function MultiAgentPanel() {
  const [agents] = useState<Agent[]>(demoAgents);
  const [messages, setMessages] = useState<AgentMessage[]>(demoMessages);
  const [input, setInput] = useState("");
  const goal = "build saas dashboard";

  const handleSend = () => {
    if (!input.trim()) return;
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    const from = "user";
    let to = "all";
    let content = input.trim();

    const mentionMatch = content.match(/^@(\w+)\s+(.*)/);
    if (mentionMatch) {
      to = mentionMatch[1];
      content = mentionMatch[2];
    }

    const newMsg: AgentMessage = {
      id: `m-${Date.now()}`,
      timestamp: ts,
      from,
      to,
      type: "REQ",
      content,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput("");
  };

  const asciiBar = (pct: number): string => {
    if (pct <= 0) return "--";
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    return `[${"=".repeat(filled)}${" ".repeat(empty)}] ${pct}%`;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        fontFamily: ff,
        background: BASE,
        color: TEXT,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
          background: S1,
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: TEXT_MUTED,
          }}
        >
          Agent Team
        </span>
        <span style={{ fontSize: "10px", color: TEXT_DIM }}>
          {agents.filter((a) => a.status === "working").length}/{agents.length} active
        </span>
      </div>

      {/* Goal */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
          background: S1,
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: TEXT_DIM,
          }}
        >
          Goal
        </span>
        <span style={{ fontSize: "11px", color: TEXT_MUTED }}>{goal}</span>
      </div>

      {/* Agent Table */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${BORDER}` }}>
        {/* Table Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: S1,
          }}
        >
          {["ROLE", "STATUS", "TASK", "PROGRESS", "TIME"].map((h) => (
            <div
              key={h}
              style={{
                flex: h === "TASK" ? 2 : 1,
                padding: "6px 8px",
                fontSize: "10px",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: TEXT_DIM,
                whiteSpace: "nowrap",
              }}
            >
              {h}
            </div>
          ))}
        </div>

        {/* Agent Rows */}
        {agents.map((agent) => (
          <div
            key={agent.id}
            style={{
              display: "flex",
              alignItems: "center",
            }}
          >
            {/* ROLE */}
            <div
              style={{
                flex: 1,
                padding: "5px 8px",
                fontSize: "11px",
                fontWeight: 600,
                color: roleColors[agent.role] || TEXT_MUTED,
                fontFamily: ff,
                textTransform: "lowercase",
              }}
            >
              {agent.role}
            </div>
            {/* STATUS */}
            <div
              style={{
                flex: 1,
                padding: "5px 8px",
                fontSize: "11px",
                color: agent.status === "working" ? ACCENT : TEXT_DIM,
                fontFamily: ff,
                textTransform: "lowercase",
              }}
            >
              {agent.status}
            </div>
            {/* TASK */}
            <div
              style={{
                flex: 2,
                padding: "5px 8px",
                fontSize: "11px",
                color: agent.task === "--" ? TEXT_DIM : TEXT_MUTED,
                fontFamily: ff,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {agent.task}
            </div>
            {/* PROGRESS */}
            <div
              style={{
                flex: 1,
                padding: "5px 8px",
                fontSize: "10px",
                color: agent.progress > 0 ? ACCENT : TEXT_DIM,
                fontFamily: ff,
                whiteSpace: "nowrap",
              }}
            >
              {asciiBar(agent.progress)}
            </div>
            {/* TIME */}
            <div
              style={{
                flex: 1,
                padding: "5px 8px",
                fontSize: "11px",
                color: agent.time === "--" ? TEXT_DIM : TEXT_MUTED,
                fontFamily: ff,
              }}
            >
              {agent.time}
            </div>
          </div>
        ))}
      </div>

      {/* Messages Section */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Messages Header */}
        <div
          style={{
            padding: "6px 12px",
            fontSize: "10px",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: TEXT_DIM,
            borderBottom: `1px solid ${BORDER}`,
            background: S1,
            position: "sticky",
            top: 0,
            zIndex: 1,
          }}
        >
          Messages
        </div>

        {/* Message Rows */}
        <div style={{ flex: 1 }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0",
                padding: "3px 12px",
                fontSize: "11px",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              {/* Timestamp */}
              <span
                style={{
                  color: TEXT_FAINT,
                  fontFamily: ff,
                  minWidth: "56px",
                  flexShrink: 0,
                }}
              >
                {msg.timestamp}
              </span>

              {/* From */}
              <span
                style={{
                  color: roleColors[msg.from] || TEXT_MUTED,
                  fontWeight: 600,
                  minWidth: "60px",
                  flexShrink: 0,
                  textTransform: "lowercase",
                }}
              >
                {msg.from}
              </span>

              {/* Arrow */}
              <span style={{ color: TEXT_FAINT, margin: "0 4px" }}>→</span>

              {/* To */}
              <span
                style={{
                  color: roleColors[msg.to] || TEXT_MUTED,
                  minWidth: "60px",
                  flexShrink: 0,
                  textTransform: "lowercase",
                }}
              >
                {msg.to}
              </span>

              {/* Type Badge */}
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 600,
                  color: typeColors[msg.type] || TEXT_DIM,
                  background: S2,
                  padding: "1px 4px",
                  borderRadius: "2px",
                  marginRight: "8px",
                  minWidth: "26px",
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {msg.type}
              </span>

              {/* Content */}
              <span style={{ color: TEXT_MUTED }}>{msg.content}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          borderTop: `1px solid ${BORDER}`,
          flexShrink: 0,
          background: S1,
        }}
      >
        <span style={{ fontSize: "12px", color: ACCENT, fontWeight: 600 }}>{" > "}</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder="@role message"
          style={{
            flex: 1,
            padding: "4px 0",
            fontSize: "11px",
            fontFamily: ff,
            background: "transparent",
            color: TEXT,
            border: "none",
            outline: "none",
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          style={{
            padding: "3px 10px",
            fontSize: "10px",
            fontFamily: ff,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            background: S2,
            color: input.trim() ? ACCENT : TEXT_DIM,
            border: "none",
            borderRadius: "2px",
            cursor: input.trim() ? "pointer" : "default",
          }}
        >
          SEND
        </button>
      </div>
    </div>
  );
}
