import { Brain } from "lucide-react";

interface ContextBarProps {
  percent: number;
  onClick?: () => void;
}

const C = {
  s2: "#1a1a24",
  s3: "#22222e",
  accent: "#6366f1",
  t2: "#94949c",
  t3: "#6b6b73",
  ok: "#10b981",
  wrn: "#f59e0b",
  err: "#ef4444",
};

export function ContextBar({ percent, onClick }: ContextBarProps) {
  const barColor =
    percent < 70 ? C.ok : percent < 90 ? C.wrn : C.err;

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        background: "none",
        border: "none",
        cursor: "pointer",
        fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
      }}
      title="Context window usage"
    >
      <Brain size={10} color={C.t3} />
      <span style={{ fontSize: "10px", color: C.t3, fontVariantNumeric: "tabular-nums" }}>
        {Math.round(percent)}%
      </span>
      <div
        style={{
          width: "32px",
          height: "4px",
          background: C.s3,
          borderRadius: "0px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            background: barColor,
            width: `${percent}%`,
            transition: "width 100ms ease",
            borderRadius: "0px",
          }}
        />
      </div>
    </button>
  );
}

export default ContextBar;
