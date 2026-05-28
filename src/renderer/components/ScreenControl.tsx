import { useState, useRef } from "react";
import type { ReactNode } from "react";
import {
  Monitor,
  Shield,
  ShieldCheck,
  Play,
  Pause,
  Square,
  Repeat,
  MousePointer,
  Keyboard,
  Type,
  ScrollText,
  Move,
  Camera,
  Clock,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Zap,
  Eye,
  Trash2,
} from "lucide-react";

const C = {
  base: "#0c0c10", s1: "#12121a", s2: "#1a1a24", s3: "#22222e",
  accent: "#6366f1", t1: "#e8e8ec", t2: "#94949c", t3: "#6b6b73", t4: "#4a4a52",
  ok: "#10b981", wrn: "#f59e0b", err: "#ef4444", inf: "#60a5fa"
};
const ff = '"Geist Mono", "JetBrains Mono", monospace';

interface ScreenAction {
  id: string;
  actionType: string;
  params: Record<string, unknown>;
  timestamp: number;
  approved: boolean;
}

interface Screenshot {
  id: string;
  timestamp: number;
  label: string;
}

const actionTypeIcons: Record<string, ReactNode> = {
  click: <MousePointer size={12} />,
  type: <Type size={12} />,
  key: <Keyboard size={12} />,
  scroll: <ScrollText size={12} />,
  drag: <Move size={12} />,
  screenshot: <Camera size={12} />,
};

const actionTypeColors: Record<string, string> = {
  click: C.accent,
  type: C.ok,
  key: "#cba6f7",
  scroll: C.wrn,
  drag: "#fab387",
  screenshot: "#94e2d5",
};

const demoActions: ScreenAction[] = [
  {
    id: "1",
    actionType: "click",
    params: { x: 482, y: 315, target: "submit-button" },
    timestamp: Date.now() - 300000,
    approved: true,
  },
  {
    id: "2",
    actionType: "type",
    params: { text: "admin@example.com", target: "email-input" },
    timestamp: Date.now() - 240000,
    approved: true,
  },
  {
    id: "3",
    actionType: "key",
    params: { key: "Enter" },
    timestamp: Date.now() - 180000,
    approved: true,
  },
  {
    id: "4",
    actionType: "scroll",
    params: { direction: "down", amount: 300 },
    timestamp: Date.now() - 120000,
    approved: true,
  },
  {
    id: "5",
    actionType: "screenshot",
    params: { fullPage: false },
    timestamp: Date.now() - 60000,
    approved: true,
  },
];

const demoScreenshots: Screenshot[] = [
  { id: "s1", timestamp: Date.now() - 60000, label: "Login page" },
  { id: "s2", timestamp: Date.now() - 300000, label: "Dashboard" },
  { id: "s3", timestamp: Date.now() - 600000, label: "Settings modal" },
];

const demoAuditLog = [
  { id: "a1", action: "Safety mode enabled", timestamp: Date.now() - 3600000, level: "info" },
  { id: "a2", action: "Screen access granted", timestamp: Date.now() - 3300000, level: "success" },
  { id: "a3", action: "Action requires approval: click at (482, 315)", timestamp: Date.now() - 3000000, level: "warning" },
  { id: "a4", action: "Action approved by user", timestamp: Date.now() - 2950000, level: "success" },
  { id: "a5", action: "Recording session started", timestamp: Date.now() - 2000000, level: "info" },
];

export default function ScreenControl() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [sandboxMode, setSandboxMode] = useState(true);
  const [consentRequired, setConsentRequired] = useState(true);
  const [rateLimit, setRateLimit] = useState(10);
  const [actions, setActions] = useState<ScreenAction[]>(demoActions);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"recorder" | "screenshots" | "audit">("recorder");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const toggleRecording = () => {
    setIsRecording(!isRecording);
    if (!isRecording) {
      const newAction: ScreenAction = {
        id: `action-${Date.now()}`,
        actionType: "key",
        params: { key: "Record started" },
        timestamp: Date.now(),
        approved: true,
      };
      setActions([...actions, newAction]);
    }
  };

  const deleteAction = (id: string) => {
    setActions(actions.filter((a) => a.id !== id));
  };

  // ── Shared Styles ──────────────────────────────────────────
  const tabBtnBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 10px",
    borderRadius: "2px",
    fontSize: "10px",
    fontWeight: 500,
    fontFamily: ff,
    border: "none",
    cursor: "pointer",
    transition: "background-color 0.15s, color 0.15s",
  };

  const smallBtn = (bg: string, color: string): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 10px",
    borderRadius: "2px",
    fontSize: "10px",
    fontWeight: 500,
    fontFamily: ff,
    border: "none",
    cursor: "pointer",
    backgroundColor: bg,
    color: color,
    transition: "background-color 0.15s",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto", fontFamily: ff }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: `1px solid ${C.s3}`,
        backgroundColor: C.s1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Monitor size={16} style={{ color: C.accent }} />
          <span style={{ fontSize: "13px", fontWeight: 600, color: C.t1 }}>Screen Control</span>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 8px",
            borderRadius: "2px",
            fontSize: "9px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            backgroundColor: sandboxMode ? `${C.ok}20` : `${C.wrn}20`,
            color: sandboxMode ? C.ok : C.wrn,
          }}>
            {sandboxMode ? "Sandbox" : "Unsafe"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {sandboxMode ? (
            <ShieldCheck size={14} style={{ color: C.ok }} />
          ) : (
            <Shield size={14} style={{ color: C.wrn }} />
          )}
        </div>
      </div>

      {/* Safety Settings */}
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.s3}`, backgroundColor: C.s1 }}>
        <div style={{ fontSize: "10px", fontWeight: 600, color: C.t3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
          Safety Settings
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          {/* Sandbox Mode Toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <button
              onClick={() => setSandboxMode(!sandboxMode)}
              style={{
                position: "relative",
                width: "32px",
                height: "16px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                backgroundColor: sandboxMode ? `${C.ok}40` : `${C.t3}20`,
                transition: "background-color 0.15s",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  width: "12px",
                  height: "12px",
                  borderRadius: "6px",
                  backgroundColor: sandboxMode ? C.ok : C.t3,
                  left: sandboxMode ? "16px" : "2px",
                  transition: "left 0.15s, background-color 0.15s",
                }}
              />
            </button>
            <span style={{ fontSize: "10px", color: C.t1 }}>Sandbox</span>
          </label>

          {/* Consent Required Toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <button
              onClick={() => setConsentRequired(!consentRequired)}
              style={{
                position: "relative",
                width: "32px",
                height: "16px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                backgroundColor: consentRequired ? `${C.accent}40` : `${C.t3}20`,
                transition: "background-color 0.15s",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  width: "12px",
                  height: "12px",
                  borderRadius: "6px",
                  backgroundColor: consentRequired ? C.accent : C.t3,
                  left: consentRequired ? "16px" : "2px",
                  transition: "left 0.15s, background-color 0.15s",
                }}
              />
            </button>
            <span style={{ fontSize: "10px", color: C.t1 }}>Require consent</span>
          </label>

          {/* Rate Limit */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Zap size={10} style={{ color: C.t3 }} />
            <span style={{ fontSize: "10px", color: C.t3 }}>Rate:</span>
            <input
              type="range"
              min={1}
              max={60}
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              style={{ width: "64px", height: "4px", accentColor: C.accent }}
            />
            <span style={{ fontSize: "10px", color: C.accent, fontFamily: ff }}>{rateLimit}/min</span>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 16px", borderBottom: `1px solid ${C.s3}`, backgroundColor: C.s1 }}>
        {[
          { id: "recorder" as const, label: "Recorder", icon: <MousePointer size={10} /> },
          { id: "screenshots" as const, label: "Screenshots", icon: <Camera size={10} /> },
          { id: "audit" as const, label: "Audit Log", icon: <Eye size={10} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...tabBtnBase,
              backgroundColor: activeTab === tab.id ? `${C.accent}15` : "transparent",
              color: activeTab === tab.id ? C.accent : C.t3,
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px", backgroundColor: C.base }}>
        {/* Recorder Tab */}
        {activeTab === "recorder" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Playback Controls */}
            <div style={{
              padding: "12px",
              border: `1px solid ${C.s3}`,
              backgroundColor: C.s1,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {/* Record Button */}
                  <button
                    onClick={toggleRecording}
                    style={smallBtn(isRecording ? C.err : C.accent, C.t1)}
                  >
                    <div style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: isRecording ? "0px" : "4px",
                      backgroundColor: C.t1,
                    }} />
                    {isRecording ? "Stop" : "Record"}
                  </button>

                  {/* Playback controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "8px" }}>
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      disabled={actions.length === 0}
                      style={{
                        ...smallBtn(C.s3, C.t2),
                        opacity: actions.length === 0 ? 0.4 : 1,
                        cursor: actions.length === 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      {isPlaying ? <Pause size={10} /> : <Play size={10} />}
                    </button>
                    <button
                      disabled={actions.length === 0}
                      style={{
                        ...smallBtn(C.s3, C.t2),
                        opacity: actions.length === 0 ? 0.4 : 1,
                        cursor: actions.length === 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      <Square size={10} />
                    </button>
                    <button
                      onClick={() => setLoopEnabled(!loopEnabled)}
                      style={smallBtn(loopEnabled ? C.accent : C.s3, loopEnabled ? C.t1 : C.t2)}
                    >
                      <Repeat size={10} />
                    </button>
                  </div>
                </div>

                {/* Speed */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "10px", color: C.t3 }}>Speed:</span>
                  <select
                    value={playbackSpeed}
                    onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                    style={{
                      height: "24px",
                      padding: "0 6px",
                      backgroundColor: C.s1,
                      border: `1px solid ${C.s3}`,
                      borderRadius: "2px",
                      fontSize: "10px",
                      color: C.t1,
                      outline: "none",
                      fontFamily: ff,
                    }}
                  >
                    <option value={0.25}>0.25x</option>
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                    <option value={4}>4x</option>
                  </select>
                </div>
              </div>

              {/* Progress */}
              {actions.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", marginBottom: "4px" }}>
                    <span style={{ color: C.t3 }}>{actions.length} actions</span>
                    <span style={{ color: C.accent }}>
                      {isPlaying ? "Playing..." : isRecording ? "Recording..." : "Ready"}
                    </span>
                  </div>
                  <div style={{ height: "4px", backgroundColor: C.s2, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: isRecording ? "60%" : isPlaying ? "100%" : "0%",
                        background: `linear-gradient(90deg, ${C.accent}, ${C.ok})`,
                        transition: "width 0.3s linear",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Action List */}
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {actions.map((action) => (
                <div
                  key={action.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 8px",
                    borderRadius: "2px",
                    transition: "background-color 0.15s",
                    cursor: "default",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = C.s1; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                >
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "2px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      backgroundColor: `${actionTypeColors[action.actionType]}20`,
                      color: actionTypeColors[action.actionType],
                    }}
                  >
                    {actionTypeIcons[action.actionType]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 500, color: C.t1, textTransform: "capitalize" }}>
                        {action.actionType}
                      </span>
                      <span style={{ fontSize: "9px", color: C.t3, fontFamily: ff }}>
                        {formatTime(action.timestamp)}
                      </span>
                    </div>
                    <div style={{ fontSize: "10px", color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {Object.entries(action.params)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(", ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    <button
                      onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
                      style={{
                        padding: "4px",
                        borderRadius: "2px",
                        border: "none",
                        backgroundColor: "transparent",
                        color: C.t3,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {expandedAction === action.id ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    </button>
                    <button
                      onClick={() => deleteAction(action.id)}
                      style={{
                        padding: "4px",
                        borderRadius: "2px",
                        border: "none",
                        backgroundColor: "transparent",
                        color: C.t3,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = C.err; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = C.t3; }}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                  {action.approved ? (
                    <CheckCircle size={12} style={{ color: C.ok, flexShrink: 0 }} />
                  ) : (
                    <AlertTriangle size={12} style={{ color: C.wrn, flexShrink: 0 }} />
                  )}
                </div>
              ))}
            </div>

            {actions.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 0", color: C.t3 }}>
                <MousePointer size={24} style={{ marginBottom: "8px", opacity: 0.5 }} />
                <p style={{ fontSize: "12px" }}>No recorded actions</p>
                <p style={{ fontSize: "10px", marginTop: "4px" }}>Click Record to start capturing</p>
              </div>
            )}
          </div>
        )}

        {/* Screenshots Tab */}
        {activeTab === "screenshots" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            {demoScreenshots.map((shot) => (
              <div
                key={shot.id}
                style={{
                  padding: "8px",
                  border: `1px solid ${C.s3}`,
                  backgroundColor: C.s1,
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.accent; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.s3; }}
              >
                <div style={{
                  aspectRatio: "16 / 9",
                  backgroundColor: C.s2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "6px",
                  border: `1px solid ${C.s3}`,
                }}>
                  <Camera size={20} style={{ color: C.t4 }} />
                </div>
                <div style={{ fontSize: "10px", fontWeight: 500, color: C.t1 }}>{shot.label}</div>
                <div style={{ fontSize: "9px", color: C.t3, fontFamily: ff }}>{formatTime(shot.timestamp)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Audit Log Tab */}
        {activeTab === "audit" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {demoAuditLog.map((log) => (
              <div
                key={log.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 8px",
                  borderRadius: "2px",
                  transition: "background-color 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = C.s1; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
              >
                <div
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "3px",
                    flexShrink: 0,
                    backgroundColor:
                      log.level === "success" ? C.ok : log.level === "warning" ? C.wrn : C.accent,
                  }}
                />
                <Clock size={10} style={{ color: C.t3, flexShrink: 0 }} />
                <span style={{ fontSize: "9px", color: C.t3, fontFamily: ff, width: "64px", flexShrink: 0 }}>
                  {formatTime(log.timestamp)}
                </span>
                <span style={{ fontSize: "11px", color: C.t1 }}>{log.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
