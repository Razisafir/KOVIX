import { useState, useRef, useEffect } from "react";
import { Code, Layout, Bug, Eye, Shield, Server } from "lucide-react";

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
  ok: "#10b981",
  wrn: "#f59e0b",
  border: "rgba(255,255,255,0.04)",
};

const ff = '"Geist Mono", "JetBrains Mono", monospace';

/* ─────────────────────── types ─────────────────────── */

export type AgentMode = "code" | "architect" | "debug" | "review" | "security" | "devops";

interface AgentModeSelectorProps {
  mode: AgentMode;
  onChange: (mode: AgentMode) => void;
}

interface ModeConfig {
  id: AgentMode;
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

const modes: ModeConfig[] = [
  {
    id: "code",
    label: "CODE",
    icon: <Code size={11} />,
    color: "#6366f1",      // Indigo — primary accent
    description: "Write and edit code",
  },
  {
    id: "architect",
    label: "ARCH",
    icon: <Layout size={11} />,
    color: "#a78bfa",      // Purple — design thinking
    description: "Design and plan architecture",
  },
  {
    id: "debug",
    label: "DEBUG",
    icon: <Bug size={11} />,
    color: "#f59e0b",      // Amber — caution/alert
    description: "Find and fix bugs",
  },
  {
    id: "review",
    label: "REVIEW",
    icon: <Eye size={11} />,
    color: "#06b6d4",      // Cyan — observant
    description: "Code review and quality check",
  },
  {
    id: "security",
    label: "SEC",
    icon: <Shield size={11} />,
    color: "#10b981",      // Emerald — safety
    description: "Security audit and hardening",
  },
  {
    id: "devops",
    label: "DEVOPS",
    icon: <Server size={11} />,
    color: "#f97316",      // Orange — infrastructure
    description: "CI/CD, Docker, deployment",
  },
];

/* ─────────────────────── component ─────────────────────── */

function AgentModeSelector({ mode, onChange }: AgentModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeMode = modes.find((m) => m.id === mode) ?? modes[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Current mode button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 22,
          padding: "0 8px",
          backgroundColor: C.s2,
          border: `1px solid ${C.border}`,
          borderLeft: `2px solid ${activeMode.color}`,
          cursor: "pointer",
          fontFamily: ff,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: activeMode.color,
          outline: "none",
          transition: "background-color 0.1s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = C.s3;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = C.s2;
        }}
      >
        {activeMode.icon}
        <span>{activeMode.label}</span>
        <span
          style={{
            fontSize: 8,
            marginLeft: 2,
            color: C.t4,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.1s",
            display: "inline-block",
          }}
        >
          ▼
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            zIndex: 100,
            minWidth: 200,
            backgroundColor: C.s1,
            border: `1px solid ${C.border}`,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            fontFamily: ff,
          }}
        >
          {modes.map((m) => {
            const isSelected = m.id === mode;
            return (
              <button
                key={m.id}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                title={m.description}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  height: 28,
                  padding: "0 10px",
                  border: "none",
                  borderBottom: `1px solid ${C.border}`,
                  backgroundColor: isSelected ? C.s2 : "transparent",
                  color: isSelected ? m.color : C.t2,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 10,
                  fontWeight: isSelected ? 600 : 400,
                  letterSpacing: "0.06em",
                  textAlign: "left",
                  outline: "none",
                  transition: "background-color 50ms",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    C.s2;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    isSelected ? C.s2 : "transparent";
                }}
              >
                <span style={{ color: m.color, opacity: 0.8 }}>{m.icon}</span>
                <span>{m.label}</span>
                <span style={{ color: C.t4, fontSize: 9, marginLeft: 4, fontWeight: 400, letterSpacing: "normal" }}>
                  {m.description}
                </span>
                {isSelected && (
                  <span style={{ marginLeft: "auto", fontSize: 9, color: m.color }}>
                    ●
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AgentModeSelector;
