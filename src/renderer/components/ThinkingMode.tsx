import { useState } from "react";
import { Brain } from "lucide-react";

const C = {
  base: "#0c0c10", s1: "#12121a", s2: "#1a1a24", s3: "#22222e",
  accent: "#6366f1", t1: "#e8e8ec", t2: "#94949c", t3: "#6b6b73", t4: "#4a4a52",
  ok: "#10b981", wrn: "#f59e0b", err: "#ef4444", inf: "#60a5fa"
};
const ff = '"Geist Mono", "JetBrains Mono", monospace';

interface ThinkingModeProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  thinkingSteps?: string[];
}

export function ThinkingMode({
  enabled,
  onToggle,
  thinkingSteps = [],
}: ThinkingModeProps) {
  const [showSteps, setShowSteps] = useState(true);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: ff }}>
      {/* Toggle button */}
      <button
        onClick={() => onToggle(!enabled)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          borderRadius: 2,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          cursor: "pointer",
          border: enabled
            ? `1px solid ${C.accent}`
            : `1px solid ${C.s3}`,
          background: enabled
            ? C.s2
            : C.s1,
          color: enabled
            ? C.accent
            : C.t3,
          fontFamily: ff,
          transition: "none",
        }}
      >
        <Brain size={14} />
        <span>DEEP THINK {enabled ? "ON" : "OFF"}</span>
      </button>

      {/* Thinking steps visualization */}
      {enabled && thinkingSteps.length > 0 && (
        <div
          style={{
            display: showSteps ? "block" : "none",
            padding: "6px 8px",
            background: C.s2,
            borderLeft: `2px solid ${C.accent}`,
            borderRadius: 0,
          }}
        >
          <div
            onClick={() => setShowSteps(!showSteps)}
            style={{
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              color: C.t3,
              marginBottom: 4,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            {showSteps ? "[-]" : "[+]"} REASONING TRACE ({thinkingSteps.length})
          </div>

          {showSteps && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {thinkingSteps.map((step, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    lineHeight: "14px",
                    color: C.accent,
                    fontFamily: ff,
                  }}
                >
                  <span style={{ color: C.t4, marginRight: 4 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span style={{ color: C.t4, marginRight: 4 }}>&gt;</span>
                  {step}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ThinkingMode;
