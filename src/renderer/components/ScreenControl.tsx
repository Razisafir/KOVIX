import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Lock,
  Unlock,
  Trash2,
  Plus,
} from "lucide-react";
import { GlassCard } from "./premium/GlassCard";
import { GlowButton } from "./premium/GlowButton";
import { StatusBadge } from "./premium/StatusBadge";

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

const actionTypeIcons: Record<string, React.ReactNode> = {
  click: <MousePointer size={12} />,
  type: <Type size={12} />,
  key: <Keyboard size={12} />,
  scroll: <ScrollText size={12} />,
  drag: <Move size={12} />,
  screenshot: <Camera size={12} />,
};

const actionTypeColors: Record<string, string> = {
  click: "#89b4fa",
  type: "#a6e3a1",
  key: "#cba6f7",
  scroll: "#f9e2af",
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
      // Starting recording - add an action
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

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-construct-border/50">
        <div className="flex items-center gap-2">
          <Monitor size={16} className="text-construct-accent" />
          <span className="text-sm font-semibold text-construct-text">Screen Control</span>
          <StatusBadge
            status={sandboxMode ? "active" : "warning"}
            text={sandboxMode ? "Sandbox" : "Unsafe"}
            pulse={sandboxMode}
          />
        </div>
        <div className="flex items-center gap-2">
          {sandboxMode ? (
            <ShieldCheck size={14} className="text-construct-success" />
          ) : (
            <Shield size={14} className="construct-warning" />
          )}
        </div>
      </div>

      {/* Safety Settings */}
      <div className="px-4 py-2 border-b border-construct-border/30">
        <div className="text-[10px] font-semibold text-construct-textMuted uppercase tracking-wider mb-2">
          Safety Settings
        </div>
        <div className="flex items-center gap-4">
          {/* Sandbox Mode */}
          <label className="flex items-center gap-2 cursor-pointer">
            <button
              onClick={() => setSandboxMode(!sandboxMode)}
              className={`relative w-8 h-4 rounded-full transition-colors ${
                sandboxMode ? "bg-construct-success/40" : "bg-construct-textMuted/20"
              }`}
            >
              <motion.div
                className="absolute top-0.5 w-3 h-3 rounded-full"
                style={{ backgroundColor: sandboxMode ? "#a6e3a1" : "#6c7086" }}
                animate={{ left: sandboxMode ? 16 : 2 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            </button>
            <span className="text-[10px] text-construct-text">Sandbox</span>
          </label>

          {/* Consent Required */}
          <label className="flex items-center gap-2 cursor-pointer">
            <button
              onClick={() => setConsentRequired(!consentRequired)}
              className={`relative w-8 h-4 rounded-full transition-colors ${
                consentRequired ? "bg-construct-accent/40" : "bg-construct-textMuted/20"
              }`}
            >
              <motion.div
                className="absolute top-0.5 w-3 h-3 rounded-full"
                style={{ backgroundColor: consentRequired ? "#89b4fa" : "#6c7086" }}
                animate={{ left: consentRequired ? 16 : 2 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            </button>
            <span className="text-[10px] text-construct-text">Require consent</span>
          </label>

          {/* Rate Limit */}
          <div className="flex items-center gap-2">
            <Zap size={10} className="text-construct-textMuted" />
            <span className="text-[10px] text-construct-textMuted">Rate:</span>
            <input
              type="range"
              min={1}
              max={60}
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              className="w-16 h-1 accent-construct-accent"
            />
            <span className="text-[10px] text-construct-accent">{rateLimit}/min</span>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 px-4 py-1 border-b border-construct-border/30">
        {[
          { id: "recorder" as const, label: "Recorder", icon: <MousePointer size={10} /> },
          { id: "screenshots" as const, label: "Screenshots", icon: <Camera size={10} /> },
          { id: "audit" as const, label: "Audit Log", icon: <Eye size={10} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all
              ${activeTab === tab.id
                ? "bg-construct-accent/15 text-construct-accent"
                : "text-construct-textMuted hover:text-construct-text"
              }
            `}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {/* Recorder Tab */}
        {activeTab === "recorder" && (
          <div className="space-y-3">
            {/* Playback Controls */}
            <GlassCard className="p-3" glow="accent">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* Record Button */}
                  <GlowButton
                    variant={isRecording ? "danger" : "primary"}
                    size="sm"
                    onClick={toggleRecording}
                  >
                    <div className={`w-2 h-2 rounded-full ${isRecording ? "bg-white animate-pulse" : "bg-white"}`} />
                    {isRecording ? "Stop" : "Record"}
                  </GlowButton>

                  {/* Playback controls */}
                  <div className="flex items-center gap-1 ml-2">
                    <GlowButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsPlaying(!isPlaying)}
                      disabled={actions.length === 0}
                    >
                      {isPlaying ? <Pause size={10} /> : <Play size={10} />}
                    </GlowButton>
                    <GlowButton variant="secondary" size="sm" disabled={actions.length === 0}>
                      <Square size={10} />
                    </GlowButton>
                    <GlowButton
                      variant={loopEnabled ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setLoopEnabled(!loopEnabled)}
                    >
                      <Repeat size={10} />
                    </GlowButton>
                  </div>
                </div>

                {/* Speed */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-construct-textMuted">Speed:</span>
                  <select
                    value={playbackSpeed}
                    onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                    className="h-6 px-1.5 bg-[rgba(255,255,255,0.04)] border border-construct-border/50 rounded text-[10px] text-construct-text outline-none"
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
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-construct-textMuted">{actions.length} actions</span>
                    <span className="text-construct-accent">{isPlaying ? "Playing..." : isRecording ? "Recording..." : "Ready"}</span>
                  </div>
                  <div className="h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg, #89b4fa, #a6e3a1)" }}
                      animate={{ width: isPlaying ? "100%" : isRecording ? ["0%", "100%"] : "0%" }}
                      transition={{
                        duration: isRecording ? 2 : isPlaying ? 3 / playbackSpeed : 0,
                        repeat: isRecording || isPlaying ? Infinity : 0,
                        ease: "linear",
                      }}
                    />
                  </div>
                </div>
              )}
            </GlassCard>

            {/* Action List */}
            <div className="space-y-1">
              {actions.map((action, index) => (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.03)] transition-colors group"
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${actionTypeColors[action.actionType]}20`, color: actionTypeColors[action.actionType] }}
                  >
                    {actionTypeIcons[action.actionType]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-construct-text capitalize">{action.actionType}</span>
                      <span className="text-[9px] text-construct-textMuted font-mono">{formatTime(action.timestamp)}</span>
                    </div>
                    <div className="text-[10px] text-construct-textMuted truncate">
                      {Object.entries(action.params)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(", ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
                      className="p-1 rounded text-construct-textMuted hover:text-construct-text hover:bg-[rgba(255,255,255,0.06)]"
                    >
                      {expandedAction === action.id ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    </button>
                    <button
                      onClick={() => deleteAction(action.id)}
                      className="p-1 rounded text-construct-textMuted hover:text-construct-error hover:bg-construct-error/10"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                  {action.approved ? (
                    <CheckCircle size={12} className="text-construct-success shrink-0" />
                  ) : (
                    <AlertTriangle size={12} className="text-construct-warning shrink-0" />
                  )}
                </motion.div>
              ))}
            </div>

            {actions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-construct-textMuted">
                <MousePointer size={24} className="mb-2 opacity-50" />
                <p className="text-xs">No recorded actions</p>
                <p className="text-[10px] mt-1">Click Record to start capturing</p>
              </div>
            )}
          </div>
        )}

        {/* Screenshots Tab */}
        {activeTab === "screenshots" && (
          <div className="grid grid-cols-3 gap-2">
            {demoScreenshots.map((shot) => (
              <GlassCard key={shot.id} className="p-2" hover>
                <div className="aspect-video bg-[rgba(255,255,255,0.04)] rounded-lg flex items-center justify-center mb-1.5 border border-construct-border/30">
                  <Camera size={20} className="text-construct-textMuted/30" />
                </div>
                <div className="text-[10px] font-medium text-construct-text">{shot.label}</div>
                <div className="text-[9px] text-construct-textMuted">{formatTime(shot.timestamp)}</div>
              </GlassCard>
            ))}
          </div>
        )}

        {/* Audit Log Tab */}
        {activeTab === "audit" && (
          <div className="space-y-1">
            {demoAuditLog.map((log) => (
              <div
                key={log.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.03)]"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    log.level === "success"
                      ? "bg-construct-success"
                      : log.level === "warning"
                      ? "bg-construct-warning"
                      : "bg-construct-accent"
                  }`}
                />
                <Clock size={10} className="text-construct-textMuted shrink-0" />
                <span className="text-[9px] text-construct-textMuted font-mono w-16 shrink-0">
                  {formatTime(log.timestamp)}
                </span>
                <span className="text-[11px] text-construct-text">{log.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
