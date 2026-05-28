import { useState, useEffect, useRef } from "react";
import {
  Zap,
  CheckCircle2,
  Circle,
  Play,
  Pause,
  Square,
  Save,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Cpu,
  HardDrive,
  Activity,
  ChevronRight,
  Sparkles,
  Bot,
  FileCode2,
  GitBranch,
  AlertTriangle,
  Radio,
} from "lucide-react";
import type {
  AutonomousStatus,
  LogEntry,
  SafetySetting,
  QueuedGoal,
  GoalPriority,
} from "../types/autonomous";

/* ───────────────────────── styles ───────────────────────── */

const glassCard =
  "bg-construct-panel/60 backdrop-blur-md border border-construct-border/50 rounded-lg";

const glowAccent = {
  boxShadow:
    "0 0 20px rgba(137, 180, 250, 0.15), 0 0 40px rgba(137, 180, 250, 0.05)",
};

const pulseGlow = "animate-pulse-glow";

/* ────────────────────── sub-components ────────────────────── */

function ProgressRing({
  percent,
  size = 120,
  strokeWidth = 8,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#313244"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#89b4fa"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

function ResourceBar({
  label,
  percent,
  color = "bg-construct-accent",
  icon,
}: {
  label: string;
  percent: number;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon && (
        <span className="text-construct-textMuted w-4">{icon}</span>
      )}
      <span className="text-[10px] text-construct-textMuted w-10">
        {label}
      </span>
      <div className="flex-1 h-2 bg-construct-border/40 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="text-[10px] text-construct-textMuted w-8 text-right">
        {Math.round(percent)}%
      </span>
    </div>
  );
}

function ToggleSwitch({
  enabled,
  onChange,
  size = "md",
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  size?: "sm" | "md" | "lg";
}) {
  const sizeMap = {
    sm: { w: "w-10", h: "h-5", knob: "w-4 h-4", translate: enabled ? "translate-x-5" : "translate-x-0.5" },
    md: { w: "w-14", h: "h-7", knob: "w-6 h-6", translate: enabled ? "translate-x-7" : "translate-x-0.5" },
    lg: { w: "w-20", h: "h-10", knob: "w-9 h-9", translate: enabled ? "translate-x-10" : "translate-x-0.5" },
  };
  const s = sizeMap[size];

  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative ${s.w} ${s.h} rounded-full transition-colors duration-300 ${
        enabled ? "bg-construct-accent" : "bg-construct-border"
      }`}
    >
      <span
        className={`absolute top-0.5 ${s.knob} bg-white rounded-full shadow transition-transform duration-300 ${s.translate}`}
      />
    </button>
  );
}

function SafetyCheckbox({
  setting,
  onToggle,
}: {
  setting: SafetySetting;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onToggle(setting.id)}
      className="flex items-start gap-2 w-full text-left group"
    >
      <div className="mt-0.5">
        {setting.enabled ? (
          <ShieldCheck size={14} className="text-construct-success" />
        ) : (
          <Shield size={14} className="text-construct-textMuted group-hover:text-construct-text" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`text-[11px] leading-tight ${
            setting.enabled
              ? "text-construct-text"
              : "text-construct-textMuted group-hover:text-construct-text"
          }`}
        >
          {setting.label}
        </div>
        <div className="text-[10px] text-construct-textMuted/70 leading-tight mt-0.5">
          {setting.description}
        </div>
      </div>
    </button>
  );
}

function TerminalOutput({ logs }: { logs: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const levelColors: Record<string, string> = {
    info: "text-construct-text",
    warn: "text-construct-warning",
    error: "text-construct-error",
  };

  const levelIcons: Record<string, string> = {
    info: ">",
    warn: "⚠",
    error: "✖",
  };

  return (
    <div
      ref={scrollRef}
      className="font-mono text-[10px] leading-relaxed h-40 overflow-y-auto space-y-0.5 pr-1 scrollbar-thin"
    >
      {logs.map((log, i) => (
        <div key={i} className={`${levelColors[log.level] || "text-construct-text"} flex gap-1.5`}>
          <span className="text-construct-textMuted/50 select-none shrink-0">
            {levelIcons[log.level] || ">"}
          </span>
          <span className="break-all">{log.message}</span>
        </div>
      ))}
      <div className="text-construct-accent animate-pulse">_</div>
    </div>
  );
}

function GoalQueueItem({ goal }: { goal: QueuedGoal }) {
  const priorityColors: Record<GoalPriority, string> = {
    critical: "text-construct-error",
    high: "text-construct-warning",
    normal: "text-construct-accent",
    low: "text-construct-textMuted",
  };

  const statusIcon =
    goal.status === "completed" ? (
      <CheckCircle2 size={14} className="text-construct-success shrink-0" />
    ) : goal.status === "active" ? (
      <Activity size={14} className="text-construct-accent shrink-0 animate-pulse" />
    ) : (
      <Circle size={14} className="text-construct-textMuted/50 shrink-0" />
    );

  return (
    <div
      className={`flex items-center gap-2 py-1.5 px-2 rounded-md ${
        goal.status === "active" ? "bg-construct-accent/5 border border-construct-accent/20" : ""
      }`}
    >
      {statusIcon}
      <span className="flex-1 text-[11px] text-construct-text truncate">
        {goal.description}
      </span>
      <span className={`text-[9px] uppercase tracking-wider ${priorityColors[goal.priority]}`}>
        {goal.priority}
      </span>
      <span className="text-[10px] text-construct-textMuted w-16 text-right">
        {goal.status}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: AutonomousStatus }) {
  const config: Record<AutonomousStatus, { color: string; icon: React.ReactNode; label: string }> = {
    disabled: {
      color: "bg-construct-textMuted/20 text-construct-textMuted",
      icon: <Zap size={12} />,
      label: "DISABLED",
    },
    idle: {
      color: "bg-construct-accent/20 text-construct-accent",
      icon: <Bot size={12} />,
      label: "IDLE",
    },
    running: {
      color: "bg-construct-success/20 text-construct-success",
      icon: <Radio size={12} className="animate-pulse" />,
      label: "ACTIVE",
    },
    paused: {
      color: "bg-construct-warning/20 text-construct-warning",
      icon: <Pause size={12} />,
      label: "PAUSED",
    },
    throttled: {
      color: "bg-construct-warning/20 text-construct-warning",
      icon: <AlertTriangle size={12} />,
      label: "THROTTLED",
    },
    error: {
      color: "bg-construct-error/20 text-construct-error",
      icon: <ShieldAlert size={12} />,
      label: "ERROR",
    },
  };

  const c = config[status];
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wider ${c.color}`}
    >
      {c.icon}
      {c.label}
    </div>
  );
}

/* ────────────────────── demo data ────────────────────── */

const DEMO_GOALS: QueuedGoal[] = [
  {
    id: "1",
    description: "Create login component with form UI",
    priority: "high",
    status: "completed",
    progress_percent: 100,
  },
  {
    id: "2",
    description: "Add form validation (email, password)",
    priority: "high",
    status: "completed",
    progress_percent: 100,
  },
  {
    id: "3",
    description: "Connect to auth API endpoint",
    priority: "critical",
    status: "active",
    progress_percent: 67,
  },
  {
    id: "4",
    description: "Write unit tests for login flow",
    priority: "normal",
    status: "pending",
    progress_percent: 0,
  },
  {
    id: "5",
    description: "Run tests and verify coverage",
    priority: "normal",
    status: "pending",
    progress_percent: 0,
  },
];

const DEMO_LOGS: LogEntry[] = [
  { timestamp: Date.now() - 1000 * 60 * 15, level: "info", message: "Autonomous mode initialized", source: "orchestrator" },
  { timestamp: Date.now() - 1000 * 60 * 14, level: "info", message: "Loading goal queue: 5 tasks", source: "planner" },
  { timestamp: Date.now() - 1000 * 60 * 13, level: "info", message: "Analyzing project structure...", source: "analyzer" },
  { timestamp: Date.now() - 1000 * 60 * 12, level: "info", message: "Found: src/, components/, hooks/, lib/", source: "analyzer" },
  { timestamp: Date.now() - 1000 * 60 * 11, level: "info", message: "Planning tasks for: Build login system", source: "planner" },
  { timestamp: Date.now() - 1000 * 60 * 10, level: "info", message: "Task 1/5: Create login component", source: "executor" },
  { timestamp: Date.now() - 1000 * 60 * 9, level: "info", message: "Generating Login.tsx with form fields", source: "codegen" },
  { timestamp: Date.now() - 1000 * 60 * 8, level: "info", message: "File written: src/components/Login.tsx", source: "fs" },
  { timestamp: Date.now() - 1000 * 60 * 7, level: "info", message: "Task 2/5: Add form validation", source: "executor" },
  { timestamp: Date.now() - 1000 * 60 * 6, level: "info", message: "Using zod schema for validation", source: "codegen" },
  { timestamp: Date.now() - 1000 * 60 * 5, level: "info", message: "File updated: src/components/Login.tsx", source: "fs" },
  { timestamp: Date.now() - 1000 * 60 * 4, level: "info", message: "Checkpoint saved (auto)", source: "checkpoint" },
  { timestamp: Date.now() - 1000 * 60 * 3, level: "warn", message: "Task 3/5: Connect to auth API — needs API key", source: "executor" },
  { timestamp: Date.now() - 1000 * 60 * 2, level: "info", message: "Using VITE_AUTH_API_ENDPOINT from .env", source: "config" },
  { timestamp: Date.now() - 1000 * 60 * 1, level: "info", message: "Writing auth hook: useAuth.ts", source: "codegen" },
  { timestamp: Date.now() - 1000 * 30, level: "info", message: "File written: src/hooks/useAuth.ts", source: "fs" },
  { timestamp: Date.now() - 1000 * 15, level: "info", message: "Implementing login mutation with error handling", source: "codegen" },
  { timestamp: Date.now() - 1000 * 5, level: "info", message: "Progress: 67% — 2/5 tasks completed", source: "orchestrator" },
];

const DEMO_SAFETY: SafetySetting[] = [
  {
    id: "delete-files",
    label: "Require approval for file deletion",
    enabled: true,
    description: "Prompts before deleting any source file",
  },
  {
    id: "git-reset",
    label: "Require approval for git reset --hard",
    enabled: true,
    description: "Prevents destructive git operations",
  },
  {
    id: "architecture",
    label: "Require approval for architecture decisions",
    enabled: true,
    description: "Asks before changing project structure",
  },
  {
    id: "auth-payment",
    label: "Require approval for auth/payment code changes",
    enabled: true,
    description: "Extra safeguard for sensitive code",
  },
  {
    id: "test-exec",
    label: "Require approval for test execution",
    enabled: false,
    description: "Prompts before running test suites",
  },
];

/* ────────────────────── main panel ────────────────────── */

function AutonomousPanel() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<AutonomousStatus>("disabled");
  const [progress, setProgress] = useState(67);
  const [goals, setGoals] = useState<QueuedGoal[]>(DEMO_GOALS);
  const [logs, setLogs] = useState<LogEntry[]>(DEMO_LOGS);
  const [safety, setSafety] = useState<SafetySetting[]>(DEMO_SAFETY);
  const [currentGoal, setCurrentGoal] = useState<string | null>(
    "Build complete login system with authentication"
  );
  const [checkpoints, setCheckpoints] = useState(12);
  const [tasksCompleted, setTasksCompleted] = useState(2);
  const [cpuLimit, setCpuLimit] = useState(40);
  const [memLimit, setMemLimit] = useState(2048);

  /* simulated live resource metrics */
  const [cpuUsage, setCpuUsage] = useState(34);
  const [memUsage, setMemUsage] = useState(28);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      setCpuUsage((prev) => Math.max(20, Math.min(60, prev + (Math.random() - 0.5) * 10)));
      setMemUsage((prev) => Math.max(20, Math.min(50, prev + (Math.random() - 0.5) * 6)));
    }, 3000);
    return () => clearInterval(interval);
  }, [enabled]);

  const handleToggle = (val: boolean) => {
    setEnabled(val);
    if (val) {
      setStatus("running");
      addLog({
        timestamp: Date.now(),
        level: "info",
        message: "Autonomous mode ENABLED — starting execution",
        source: "orchestrator",
      });
    } else {
      setStatus("disabled");
      setCurrentGoal(null);
      addLog({
        timestamp: Date.now(),
        level: "warn",
        message: "Autonomous mode DISABLED — execution halted",
        source: "orchestrator",
      });
    }
  };

  const addLog = (entry: LogEntry) => {
    setLogs((prev) => [...prev.slice(-99), entry]);
  };

  const handlePause = () => {
    setStatus("paused");
    addLog({
      timestamp: Date.now(),
      level: "warn",
      message: "Execution paused by user",
      source: "orchestrator",
    });
  };

  const handleResume = () => {
    setStatus("running");
    addLog({
      timestamp: Date.now(),
      level: "info",
      message: "Execution resumed",
      source: "orchestrator",
    });
  };

  const handleStop = () => {
    setStatus("idle");
    setProgress(0);
    addLog({
      timestamp: Date.now(),
      level: "error",
      message: "Execution stopped — progress reset",
      source: "orchestrator",
    });
  };

  const handleCheckpoint = () => {
    setCheckpoints((c) => c + 1);
    addLog({
      timestamp: Date.now(),
      level: "info",
      message: `Checkpoint saved manually (#${checkpoints + 1})`,
      source: "checkpoint",
    });
  };

  const toggleSafety = (id: string) => {
    setSafety((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  /* ──────────────── disabled view ──────────────── */

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
        <div
          className={`${glassCard} p-8 max-w-md w-full flex flex-col items-center gap-5`}
        >
          {/* Header */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-construct-accent">
              <Sparkles size={20} />
              <span className="text-xs font-semibold tracking-[0.2em] uppercase">
                Construct
              </span>
              <Sparkles size={20} />
            </div>
            <h2 className="text-lg font-bold text-construct-text tracking-tight">
              Autonomous Mode
            </h2>
            <p className="text-[11px] text-construct-textMuted text-center leading-relaxed max-w-xs">
              Let the agent work 24/7 toward your goals. It plans, codes, tests,
              and commits — even while you sleep.
            </p>
          </div>

          {/* Big Toggle */}
          <div className="flex flex-col items-center gap-3 py-2">
            <span className="text-[10px] text-construct-textMuted uppercase tracking-wider">
              Autonomous Mode
            </span>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-semibold ${
                  enabled ? "text-construct-accent" : "text-construct-textMuted"
                }`}
              >
                OFF
              </span>
              <ToggleSwitch enabled={enabled} onChange={handleToggle} size="lg" />
              <span
                className={`text-xs font-semibold ${
                  enabled ? "text-construct-success" : "text-construct-textMuted"
                }`}
              >
                ON
              </span>
            </div>
          </div>

          {/* Features */}
          <div className="w-full space-y-2">
            <div className="text-[10px] text-construct-textMuted uppercase tracking-wider mb-2">
              Features
            </div>
            {[
              "Background execution with progress tracking",
              "Automatic checkpoints every 5 minutes",
              "Resume after interruption seamlessly",
              "Resource-aware throttling (CPU / Memory)",
              "Smart safety pauses for destructive actions",
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-2">
                <CheckCircle2 size={12} className="text-construct-success shrink-0" />
                <span className="text-[11px] text-construct-text">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ──────────────── enabled view ──────────────── */

  return (
    <div className="flex flex-col h-full gap-2 p-1 overflow-auto">
      {/* Top bar: status + toggle */}
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          {status === "running" && (
            <span className="text-[10px] text-construct-textMuted animate-pulse">
              Working on: {currentGoal}
            </span>
          )}
        </div>
        <ToggleSwitch enabled={enabled} onChange={handleToggle} />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-[220px_1fr] gap-2 min-h-0">
        {/* Left column */}
        <div className="flex flex-col gap-2">
          {/* Progress Ring Card */}
          <div
            className={`${glassCard} p-3 flex flex-col items-center gap-2 ${
              status === "running" ? pulseGlow : ""
            }`}
            style={status === "running" ? glowAccent : undefined}
          >
            <div className="relative">
              <ProgressRing percent={progress} size={110} strokeWidth={8} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-construct-text">
                  {Math.round(progress)}%
                </span>
                <span className="text-[9px] text-construct-textMuted uppercase tracking-wider">
                  progress
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-construct-textMuted">
              <div className="flex items-center gap-1">
                <CheckCircle2 size={10} className="text-construct-success" />
                <span>{tasksCompleted} done</span>
              </div>
              <div className="flex items-center gap-1">
                <Save size={10} className="text-construct-accent" />
                <span>{checkpoints} CPs</span>
              </div>
            </div>
          </div>

          {/* Goal Card */}
          <div className={`${glassCard} p-3`}>
            <div className="flex items-center gap-1.5 text-construct-accent mb-2">
              <ChevronRight size={12} />
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                Current Goal
              </span>
            </div>
            <p className="text-[11px] text-construct-text leading-relaxed">
              {currentGoal || "No active goal"}
            </p>
            <div className="flex items-center gap-1.5 mt-2 text-[10px] text-construct-textMuted">
              <Clock size={10} />
              <span>Started {new Date(Date.now() - 1000 * 60 * 15).toLocaleTimeString()}</span>
            </div>
          </div>

          {/* Control Buttons */}
          <div className={`${glassCard} p-2 grid grid-cols-2 gap-1.5`}>
            {status === "running" ? (
              <button
                onClick={handlePause}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-construct-warning/10 hover:bg-construct-warning/20 text-construct-warning text-[10px] font-medium transition-colors"
              >
                <Pause size={12} />
                Pause
              </button>
            ) : (
              <button
                onClick={handleResume}
                className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-construct-success/10 hover:bg-construct-success/20 text-construct-success text-[10px] font-medium transition-colors"
              >
                <Play size={12} />
                Resume
              </button>
            )}
            <button
              onClick={handleStop}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-construct-error/10 hover:bg-construct-error/20 text-construct-error text-[10px] font-medium transition-colors"
            >
              <Square size={12} />
              Stop
            </button>
            <button
              onClick={handleCheckpoint}
              className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-construct-accent/10 hover:bg-construct-accent/20 text-construct-accent text-[10px] font-medium transition-colors"
            >
              <Save size={12} />
              Force Checkpoint
            </button>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-2 min-h-0">
          {/* Task Queue */}
          <div className={`${glassCard} p-3`}>
            <div className="flex items-center gap-1.5 text-construct-accent mb-2">
              <FileCode2 size={12} />
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                Task Queue
              </span>
              <span className="text-[10px] text-construct-textMuted ml-auto">
                {goals.filter((g) => g.status === "completed").length}/{goals.length}
              </span>
            </div>
            <div className="space-y-0.5 max-h-36 overflow-y-auto pr-1 scrollbar-thin">
              {goals.map((goal) => (
                <GoalQueueItem key={goal.id} goal={goal} />
              ))}
            </div>
          </div>

          {/* Resources */}
          <div className={`${glassCard} p-3`}>
            <div className="flex items-center gap-1.5 text-construct-accent mb-2">
              <Cpu size={12} />
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                Resources
              </span>
            </div>
            <div className="space-y-2">
              <ResourceBar
                label="CPU"
                percent={cpuUsage}
                color={cpuUsage > 50 ? "bg-construct-warning" : "bg-construct-accent"}
                icon={<Cpu size={10} />}
              />
              <ResourceBar
                label="Mem"
                percent={memUsage}
                color={memUsage > 50 ? "bg-construct-warning" : "bg-construct-success"}
                icon={<HardDrive size={10} />}
              />
            </div>
          </div>

          {/* Terminal Output */}
          <div className={`${glassCard} p-3 flex-1 min-h-0`}>
            <div className="flex items-center gap-1.5 text-construct-accent mb-2">
              <Terminal size={12} />
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                Live Output
              </span>
              {status === "running" && (
                <span className="ml-auto flex items-center gap-1 text-[9px] text-construct-success">
                  <span className="w-1.5 h-1.5 rounded-full bg-construct-success animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <TerminalOutput logs={logs} />
          </div>
        </div>
      </div>

      {/* Bottom: Safety Settings */}
      <div className={`${glassCard} p-3`}>
        <div className="flex items-center gap-1.5 text-construct-accent mb-2">
          <Shield size={12} />
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            Safety Settings
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
          {safety.map((setting) => (
            <SafetyCheckbox
              key={setting.id}
              setting={setting}
              onToggle={toggleSafety}
            />
          ))}
        </div>

        {/* Limits */}
        <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-construct-border/30">
          <div>
            <div className="text-[10px] text-construct-textMuted mb-1">CPU Limit</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-construct-border/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-construct-accent rounded-full"
                  style={{ width: `${cpuLimit}%` }}
                />
              </div>
              <span className="text-[10px] text-construct-textMuted w-8">{cpuLimit}%</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-construct-textMuted mb-1">Memory Limit</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-construct-border/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-construct-success rounded-full"
                  style={{ width: `${(memLimit / 4096) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-construct-textMuted w-10">{memLimit} MB</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-construct-textMuted mb-1">Checkpoint Interval</div>
            <div className="flex items-center gap-1 text-[10px] text-construct-text">
              <GitBranch size={10} className="text-construct-accent" />
              Every 5 minutes
            </div>
          </div>
        </div>
      </div>

      {/* CSS animation */}
      <style>{`
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 10px rgba(137, 180, 250, 0.2); }
          50% { box-shadow: 0 0 25px rgba(137, 180, 250, 0.4), 0 0 50px rgba(137, 180, 250, 0.1); }
        }
        .animate-pulse-glow {
          animation: pulse-glow 2s ease-in-out infinite;
        }
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: #313244;
          border-radius: 2px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: #45475a;
        }
      `}</style>
    </div>
  );
}

export default AutonomousPanel;
