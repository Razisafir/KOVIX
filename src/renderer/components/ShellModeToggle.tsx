import { Terminal, Zap, Shield } from "lucide-react";

const C = {
  base: "#0c0c10", s1: "#12121a", s2: "#1a1a24", s3: "#22222e",
  accent: "#6366f1", t1: "#e8e8ec", t2: "#94949c", t3: "#6b6b73", t4: "#4a4a52",
  ok: "#10b981", wrn: "#f59e0b", err: "#ef4444", inf: "#60a5fa"
};
const ff = '"Geist Mono", "JetBrains Mono", monospace';

interface ShellModeToggleProps {
  shellMode: boolean;
  onToggle: (shellMode: boolean) => void;
}

export function ShellModeToggle({ shellMode, onToggle }: ShellModeToggleProps) {
  const baseBtn: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    borderRadius: "2px",
    fontSize: "10px",
    fontWeight: 500,
    fontFamily: ff,
    textTransform: "uppercase",
    border: "none",
    cursor: "pointer",
    transition: "background-color 0.15s, color 0.15s",
    letterSpacing: "0.05em",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <button
        onClick={() => onToggle(false)}
        style={{
          ...baseBtn,
          backgroundColor: !shellMode ? C.accent : C.s2,
          color: !shellMode ? C.t1 : C.t3,
        }}
      >
        <Zap size={10} />
        Agent
      </button>
      <button
        onClick={() => onToggle(true)}
        style={{
          ...baseBtn,
          backgroundColor: shellMode ? C.accent : C.s2,
          color: shellMode ? C.t1 : C.t3,
        }}
      >
        <Terminal size={10} />
        Shell
        <Shield size={9} style={{ color: C.wrn }} />
      </button>
    </div>
  );
}

export default ShellModeToggle;
