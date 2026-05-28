import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Plus,
  MessageSquare,
  AlertCircle,
  CircleDot,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Send,
  Bot,
  Zap,
  Shield,
  Code,
  Search,
  Wrench,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { GlassCard } from "./premium/GlassCard";
import { GlowButton } from "./premium/GlowButton";
import { StatusBadge } from "./premium/StatusBadge";
import { ProgressRing } from "./premium/ProgressRing";

interface AgentRole {
  id: string;
  name: string;
  role: string;
  status: "active" | "idle" | "error";
  currentTask?: string;
  progress: number;
  color: string;
}

interface AgentMessage {
  type: string;
  fromAgent: string;
  toAgent?: string;
  content: string;
  timestamp: number;
}

interface Task {
  id: string;
  title: string;
  assignee: string;
  status: "pending" | "active" | "completed" | "failed";
  priority: "low" | "medium" | "high";
}

interface Conflict {
  id: string;
  agents: string[];
  issue: string;
  severity: "low" | "high";
}

const agentColors: Record<string, string> = {
  Orchestrator: "#89b4fa",
  Developer: "#a6e3a1",
  Security: "#f38ba8",
  Researcher: "#cba6f7",
};

const demoAgents: AgentRole[] = [
  {
    id: "a1",
    name: "Alpha",
    role: "Orchestrator",
    status: "active",
    currentTask: "Coordinating team workflow",
    progress: 78,
    color: "#89b4fa",
  },
  {
    id: "a2",
    name: "Beta",
    role: "Developer",
    status: "active",
    currentTask: "Implementing auth module",
    progress: 45,
    color: "#a6e3a1",
  },
  {
    id: "a3",
    name: "Gamma",
    role: "Security",
    status: "idle",
    currentTask: "Waiting for code review",
    progress: 0,
    color: "#f38ba8",
  },
  {
    id: "a4",
    name: "Delta",
    role: "Researcher",
    status: "active",
    currentTask: "Analyzing API documentation",
    progress: 62,
    color: "#cba6f7",
  },
];

const demoMessages: AgentMessage[] = [
  {
    type: "request",
    fromAgent: "Orchestrator",
    toAgent: "Developer",
    content: "Please start implementing the authentication module. We need OAuth2 + JWT support.",
    timestamp: Date.now() - 300000,
  },
  {
    type: "response",
    fromAgent: "Developer",
    toAgent: "Orchestrator",
    content: "On it. I'll set up Passport.js with OAuth2 strategy and JWT token management.",
    timestamp: Date.now() - 240000,
  },
  {
    type: "alert",
    fromAgent: "Security",
    content: "Heads up: The current JWT implementation doesn't include refresh token rotation. Recommend adding for security.",
    timestamp: Date.now() - 180000,
  },
  {
    type: "request",
    fromAgent: "Orchestrator",
    toAgent: "Security",
    content: "Can you audit the auth flow once Developer pushes the initial implementation?",
    timestamp: Date.now() - 120000,
  },
  {
    type: "response",
    fromAgent: "Security",
    toAgent: "Orchestrator",
    content: "Confirmed. I'll run a security audit including token validation, CSRF checks, and session management.",
    timestamp: Date.now() - 60000,
  },
  {
    type: "info",
    fromAgent: "Researcher",
    content: "Found relevant RFC 6749 and RFC 7636 (PKCE) documentation. Sharing with the team.",
    timestamp: Date.now() - 30000,
  },
];

const demoTasks: Task[] = [
  { id: "t1", title: "Set up OAuth2 provider config", assignee: "Developer", status: "completed", priority: "high" },
  { id: "t2", title: "Implement JWT token generation", assignee: "Developer", status: "active", priority: "high" },
  { id: "t3", title: "Create refresh token rotation", assignee: "Developer", status: "pending", priority: "medium" },
  { id: "t4", title: "Security audit auth flow", assignee: "Security", status: "pending", priority: "high" },
  { id: "t5", title: "Document API endpoints", assignee: "Researcher", status: "active", priority: "low" },
  { id: "t6", title: "Configure rate limiting", assignee: "Orchestrator", status: "completed", priority: "medium" },
  { id: "t7", title: "Set up error monitoring", assignee: "Developer", status: "failed", priority: "medium" },
  { id: "t8", title: "Review PKCE implementation", assignee: "Security", status: "pending", priority: "high" },
];

const demoConflicts: Conflict[] = [
  {
    id: "c1",
    agents: ["Developer", "Security"],
    issue: "Developer suggests storing JWTs in localStorage; Security recommends httpOnly cookies instead",
    severity: "high",
  },
];

const kanbanColumns = [
  { id: "pending", label: "Pending", icon: <Clock size={12} />, color: "#6c7086" },
  { id: "active", label: "Active", icon: <Zap size={12} />, color: "#89b4fa" },
  { id: "completed", label: "Completed", icon: <CheckCircle2 size={12} />, color: "#a6e3a1" },
  { id: "failed", label: "Failed", icon: <XCircle size={12} />, color: "#f38ba8" },
];

export default function MultiAgentPanel() {
  const [activeSubTab, setActiveSubTab] = useState<"team" | "chat" | "board">("team");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>(demoMessages);
  const [agents, setAgents] = useState<AgentRole[]>(demoAgents);
  const [tasks, setTasks] = useState<Task[]>(demoTasks);
  const [conflicts] = useState<Conflict[]>(demoConflicts);
  const [showCreateTeam, setShowCreateTeam] = useState(false);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "Orchestrator": return <Bot size={12} />;
      case "Developer": return <Code size={12} />;
      case "Security": return <Shield size={12} />;
      case "Researcher": return <Search size={12} />;
      default: return <Wrench size={12} />;
    }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const newMsg: AgentMessage = {
      type: "request",
      fromAgent: "You",
      content: chatInput,
      timestamp: Date.now(),
    };
    setMessages([...messages, newMsg]);
    setChatInput("");
  };

  const moveTask = (taskId: string, newStatus: Task["status"]) => {
    setTasks(tasks.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-construct-border/50">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-construct-accent" />
          <span className="text-sm font-semibold text-construct-text">Agent Team</span>
          <span className="px-1.5 py-0.5 bg-construct-success/10 rounded text-[10px] text-construct-success">
            {agents.filter((a) => a.status === "active").length} active
          </span>
          {conflicts.length > 0 && (
            <span className="px-1.5 py-0.5 bg-construct-error/10 rounded text-[10px] text-construct-error">
              {conflicts.length} conflict
            </span>
          )}
        </div>
        <GlowButton size="sm" onClick={() => setShowCreateTeam(true)}>
          <Plus size={12} />
          Create Team
        </GlowButton>
      </div>

      {/* Conflict Alerts */}
      <AnimatePresence>
        {conflicts.map((conflict) => (
          <motion.div
            key={conflict.id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mx-4 mt-2 p-2.5 rounded-xl border border-construct-error/30 bg-construct-error/5 flex items-start gap-2">
              <AlertCircle size={14} className="text-construct-error shrink-0 mt-0.5" />
              <div>
                <div className="text-[11px] font-semibold text-construct-error">
                  Conflict: {conflict.agents.join(" vs ")}
                </div>
                <div className="text-[10px] text-construct-textMuted">{conflict.issue}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 px-4 py-1 border-b border-construct-border/30">
        {[
          { id: "team" as const, label: "Team", icon: <Users size={10} /> },
          { id: "chat" as const, label: "Chat", icon: <MessageSquare size={10} /> },
          { id: "board" as const, label: "Board", icon: <CheckCircle2 size={10} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`
              flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all
              ${activeSubTab === tab.id
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
        {/* Team Tab */}
        {activeSubTab === "team" && (
          <div className="space-y-3">
            {/* Agent Cards Row */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
              {agents.map((agent) => (
                <GlassCard
                  key={agent.id}
                  className="p-2.5 relative"
                  glow={agent.status === "active" ? "accent" : "none"}
                >
                  {/* Pulse glow for active agents */}
                  {agent.status === "active" && (
                    <motion.div
                      className="absolute inset-0 rounded-[20px] pointer-events-none"
                      style={{
                        boxShadow: `0 0 20px ${agent.color}20`,
                      }}
                      animate={{
                        boxShadow: [
                          `0 0 10px ${agent.color}10`,
                          `0 0 30px ${agent.color}25`,
                          `0 0 10px ${agent.color}10`,
                        ],
                      }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}

                  <div className="flex items-center gap-2 mb-2">
                    {/* Avatar */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-construct-panel"
                      style={{ backgroundColor: agent.color }}
                    >
                      {agent.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-construct-text truncate">{agent.name}</div>
                      <div className="flex items-center gap-1 text-[10px]" style={{ color: agent.color }}>
                        {getRoleIcon(agent.role)}
                        {agent.role}
                      </div>
                    </div>
                  </div>

                  <StatusBadge
                    status={agent.status}
                    text={agent.status === "active" ? "Active" : agent.status === "idle" ? "Idle" : "Error"}
                    pulse={agent.status === "active"}
                    className="mb-2"
                  />

                  {agent.currentTask && (
                    <div className="text-[10px] text-construct-textMuted truncate mb-1.5">
                      {agent.currentTask}
                    </div>
                  )}

                  {/* Progress */}
                  {agent.progress > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: agent.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${agent.progress}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                        />
                      </div>
                      <span className="text-[9px] text-construct-textMuted">{agent.progress}%</span>
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          </div>
        )}

        {/* Chat Tab */}
        {activeSubTab === "chat" && (
          <div className="flex flex-col h-full">
            {/* Messages */}
            <div className="flex-1 space-y-2 overflow-auto mb-3">
              {messages.map((msg, index) => {
                const isFromYou = msg.fromAgent === "You";
                const agentColor = agentColors[msg.fromAgent] || "#6c7086";

                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className={`flex gap-2 ${isFromYou ? "flex-row-reverse" : ""}`}
                  >
                    {/* Avatar */}
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-construct-panel shrink-0"
                      style={{ backgroundColor: agentColor }}
                    >
                      {msg.fromAgent[0]}
                    </div>

                    <div className={`max-w-[80%] ${isFromYou ? "items-end" : "items-start"}`}>
                      {/* Meta */}
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[9px] font-medium" style={{ color: agentColor }}>
                          {msg.fromAgent}
                        </span>
                        {msg.toAgent && (
                          <>
                            <ChevronRight size={8} className="text-construct-textMuted" />
                            <span className="text-[9px] text-construct-textMuted">{msg.toAgent}</span>
                          </>
                        )}
                        <span className="text-[9px] text-construct-textMuted">{formatTime(msg.timestamp)}</span>
                      </div>

                      {/* Message Bubble */}
                      <div
                        className={`px-2.5 py-1.5 rounded-xl text-[11px] ${
                          isFromYou
                            ? "bg-construct-accent/20 text-construct-text border border-construct-accent/20"
                            : "bg-[rgba(255,255,255,0.04)] text-construct-text border border-construct-border/30"
                        }`}
                      >
                        {msg.content}
                      </div>

                      {/* Type Badge */}
                      <span
                        className={`inline-block mt-0.5 px-1 rounded text-[8px] capitalize ${
                          msg.type === "alert"
                            ? "bg-construct-warning/10 text-construct-warning"
                            : msg.type === "request"
                            ? "bg-construct-accent/10 text-construct-accent"
                            : "bg-[rgba(255,255,255,0.04)] text-construct-textMuted"
                        }`}
                      >
                        {msg.type}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* @mention Input */}
            <div className="flex items-center gap-2 pt-2 border-t border-construct-border/30">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  placeholder="@agent_name message..."
                  className="w-full h-8 px-3 bg-[rgba(255,255,255,0.04)] border border-construct-border/50 rounded-lg text-xs text-construct-text placeholder-construct-textMuted outline-none focus:border-construct-accent/50 transition-colors"
                />
              </div>
              <GlowButton size="sm" onClick={handleSendMessage} disabled={!chatInput.trim()}>
                <Send size={10} />
              </GlowButton>
            </div>
          </div>
        )}

        {/* Board Tab */}
        {activeSubTab === "board" && (
          <div className="grid grid-cols-4 gap-2">
            {kanbanColumns.map((col) => {
              const colTasks = tasks.filter((t) => t.status === col.id);
              return (
                <div key={col.id} className="flex flex-col">
                  {/* Column Header */}
                  <div className="flex items-center gap-1.5 px-2 py-1.5 mb-2 rounded-lg bg-[rgba(255,255,255,0.03)]">
                    <span style={{ color: col.color }}>{col.icon}</span>
                    <span className="text-[11px] font-semibold text-construct-text">{col.label}</span>
                    <span className="ml-auto text-[10px] text-construct-textMuted">{colTasks.length}</span>
                  </div>

                  {/* Task Cards */}
                  <div className="space-y-1.5">
                    {colTasks.map((task) => (
                      <motion.div
                        key={task.id}
                        layout
                        className="p-2 rounded-xl bg-[rgba(255,255,255,0.04)] border border-construct-border/30 hover:border-construct-border/60 transition-colors"
                      >
                        <div className="text-[10px] font-medium text-construct-text mb-1">{task.title}</div>
                        <div className="flex items-center justify-between">
                          <span
                            className="px-1 rounded text-[8px]"
                            style={{
                              backgroundColor: `${agentColors[task.assignee] || "#6c7086"}20`,
                              color: agentColors[task.assignee] || "#6c7086",
                            }}
                          >
                            {task.assignee}
                          </span>
                          <span
                            className={`text-[8px] capitalize ${
                              task.priority === "high"
                                ? "text-construct-error"
                                : task.priority === "medium"
                                ? "text-construct-warning"
                                : "text-construct-textMuted"
                            }`}
                          >
                            {task.priority}
                          </span>
                        </div>

                        {/* Move buttons */}
                        <div className="flex gap-1 mt-1.5 pt-1.5 border-t border-construct-border/20">
                          {col.id !== "pending" && (
                            <button
                              onClick={() => moveTask(task.id, "pending")}
                              className="text-[8px] text-construct-textMuted hover:text-construct-text transition-colors"
                            >
                              To Do
                            </button>
                          )}
                          {col.id !== "active" && (
                            <button
                              onClick={() => moveTask(task.id, "active")}
                              className="text-[8px] text-construct-textMuted hover:text-construct-accent transition-colors"
                            >
                              Start
                            </button>
                          )}
                          {col.id !== "completed" && (
                            <button
                              onClick={() => moveTask(task.id, "completed")}
                              className="text-[8px] text-construct-textMuted hover:text-construct-success transition-colors"
                            >
                              Done
                            </button>
                          )}
                          {col.id !== "failed" && (
                            <button
                              onClick={() => moveTask(task.id, "failed")}
                              className="text-[8px] text-construct-textMuted hover:text-construct-error transition-colors"
                            >
                              Fail
                            </button>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
