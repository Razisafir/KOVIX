import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plug,
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  AlertCircle,
  Check,
  X,
  Settings,
  Shield,
  Globe,
  Database,
  CreditCard,
  Mail,
  Cloud,
  Server,
  Lock,
  Search,
  Wrench,
  FileCode,
  BarChart3,
  Box,
} from "lucide-react";
import { GlassCard } from "./premium/GlassCard";
import { GlowButton } from "./premium/GlowButton";
import { StatusBadge } from "./premium/StatusBadge";

interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface MCPConnection {
  id: string;
  name: string;
  serverUrl: string;
  status: "connected" | "disconnected" | "error";
  tools: MCPTool[];
  lastUsed: string;
  autoReconnect: boolean;
}

const mcpPresets = [
  { name: "GitHub", url: "https://api.github.com", icon: <Globe size={14} /> },
  { name: "Supabase", url: "https://api.supabase.io", icon: <Database size={14} /> },
  { name: "Stripe", url: "https://api.stripe.com", icon: <CreditCard size={14} /> },
  { name: "SendGrid", url: "https://api.sendgrid.com", icon: <Mail size={14} /> },
  { name: "AWS Lambda", url: "https://lambda.amazonaws.com", icon: <Cloud size={14} /> },
  { name: "Vercel", url: "https://api.vercel.com", icon: <Server size={14} /> },
  { name: "Auth0", url: "https://api.auth0.com", icon: <Lock size={14} /> },
  { name: "OpenAI", url: "https://api.openai.com", icon: <FileCode size={14} /> },
  { name: "Anthropic", url: "https://api.anthropic.com", icon: <FileCode size={14} /> },
  { name: "Google Search", url: "https://customsearch.googleapis.com", icon: <Search size={14} /> },
  { name: "Puppeteer", url: "http://localhost:3000", icon: <Wrench size={14} /> },
  { name: "Playwright", url: "http://localhost:3001", icon: <Wrench size={14} /> },
  { name: "PostgreSQL", url: "postgresql://localhost:5432", icon: <Database size={14} /> },
  { name: "Redis", url: "redis://localhost:6379", icon: <Database size={14} /> },
  { name: "MongoDB", url: "mongodb://localhost:27017", icon: <Database size={14} /> },
  { name: "Elasticsearch", url: "http://localhost:9200", icon: <Search size={14} /> },
  { name: "Sentry", url: "https://sentry.io/api", icon: <Shield size={14} /> },
  { name: "Datadog", url: "https://api.datadoghq.com", icon: <BarChart3 size={14} /> },
  { name: "Docker", url: "unix:///var/run/docker.sock", icon: <Box size={14} /> },
  { name: "Kubernetes", url: "https://kubernetes.default.svc", icon: <Server size={14} /> },
];

const demoConnections: MCPConnection[] = [
  {
    id: "1",
    name: "GitHub API",
    serverUrl: "https://api.github.com",
    status: "connected",
    lastUsed: "2 min ago",
    autoReconnect: true,
    tools: [
      { name: "list_repos", description: "List all repositories for authenticated user", parameters: {} },
      { name: "create_issue", description: "Create a new issue in a repository", parameters: {} },
      { name: "get_file", description: "Get file contents from a repository", parameters: {} },
      { name: "create_pr", description: "Create a pull request", parameters: {} },
      { name: "merge_pr", description: "Merge a pull request", parameters: {} },
    ],
  },
  {
    id: "2",
    name: "Supabase Backend",
    serverUrl: "https://api.supabase.io",
    status: "connected",
    lastUsed: "15 min ago",
    autoReconnect: true,
    tools: [
      { name: "query_db", description: "Execute SQL query on Supabase database", parameters: {} },
      { name: "insert_record", description: "Insert a record into a table", parameters: {} },
      { name: "auth_user", description: "Manage auth users", parameters: {} },
      { name: "storage_upload", description: "Upload file to Supabase storage", parameters: {} },
    ],
  },
  {
    id: "3",
    name: "Stripe Payments",
    serverUrl: "https://api.stripe.com",
    status: "error",
    lastUsed: "1 hr ago",
    autoReconnect: false,
    tools: [
      { name: "create_customer", description: "Create a new Stripe customer", parameters: {} },
      { name: "create_charge", description: "Create a charge", parameters: {} },
      { name: "create_subscription", description: "Create a subscription", parameters: {} },
      { name: "refund", description: "Process a refund", parameters: {} },
    ],
  },
];

export default function MCPConnector() {
  const [connections, setConnections] = useState<MCPConnection[]>(demoConnections);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [expandedTools, setExpandedTools] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleAddConnector = () => {
    if (!customName || !customUrl) return;
    const newConn: MCPConnection = {
      id: `conn-${Date.now()}`,
      name: customName,
      serverUrl: customUrl,
      status: "disconnected",
      lastUsed: "Never",
      autoReconnect: false,
      tools: [],
    };
    setConnections([...connections, newConn]);
    setShowAddModal(false);
    resetForm();
  };

  const resetForm = () => {
    setSelectedPreset("");
    setCustomName("");
    setCustomUrl("");
    setApiKey("");
  };

  const handlePresetChange = (presetName: string) => {
    setSelectedPreset(presetName);
    const preset = mcpPresets.find((p) => p.name === presetName);
    if (preset) {
      setCustomName(preset.name);
      setCustomUrl(preset.url);
    }
  };

  const handleTestConnection = async (connId: string) => {
    setTestingId(connId);
    // Simulate test
    await new Promise((r) => setTimeout(r, 1200));
    setConnections((prev) =>
      prev.map((c) =>
        c.id === connId
          ? { ...c, status: Math.random() > 0.3 ? "connected" : "error", lastUsed: "Just now" }
          : c
      )
    );
    setTestingId(null);
  };

  const handleToggleConnection = (connId: string) => {
    setConnections((prev) =>
      prev.map((c) =>
        c.id === connId
          ? { ...c, status: c.status === "connected" ? "disconnected" : c.status }
          : c
      )
    );
  };

  const handleDeleteConnection = (connId: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== connId));
  };

  const handleToggleAutoReconnect = (connId: string) => {
    setConnections((prev) =>
      prev.map((c) =>
        c.id === connId ? { ...c, autoReconnect: !c.autoReconnect } : c
      )
    );
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-construct-border/50">
        <div className="flex items-center gap-2">
          <Plug size={16} className="text-construct-accent" />
          <span className="text-sm font-semibold text-construct-text">MCP Connectors</span>
          <span className="px-1.5 py-0.5 bg-construct-accent/10 rounded text-[10px] text-construct-accent">
            {connections.filter((c) => c.status === "connected").length}/{connections.length} active
          </span>
        </div>
        <GlowButton size="sm" onClick={() => setShowAddModal(true)}>
          <Plus size={12} />
          Add Connector
        </GlowButton>
      </div>

      {/* Connections List */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
        {connections.map((conn) => (
          <GlassCard key={conn.id} className="p-3" glow={conn.status === "error" ? "error" : conn.status === "connected" ? "success" : "none"}>
            {/* Connection Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    conn.status === "connected"
                      ? "bg-construct-success/15 text-construct-success"
                      : conn.status === "error"
                      ? "bg-construct-error/15 text-construct-error"
                      : "bg-construct-textMuted/10 text-construct-textMuted"
                  }`}
                >
                  {conn.status === "connected" ? <Wifi size={16} /> : conn.status === "error" ? <AlertCircle size={16} /> : <WifiOff size={16} />}
                </div>
                <div>
                  <div className="text-xs font-semibold text-construct-text">{conn.name}</div>
                  <div className="text-[10px] text-construct-textMuted font-mono">{conn.serverUrl}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusBadge
                  status={conn.status === "connected" ? "connected" : conn.status === "error" ? "error" : "disconnected"}
                  pulse={conn.status === "connected"}
                />
                <span className="text-[10px] text-construct-textMuted">{conn.lastUsed}</span>
              </div>
            </div>

            {/* Stats Row */}
            <div className="flex items-center gap-4 mt-2 py-2 border-t border-construct-border/30">
              <div className="flex items-center gap-1 text-[10px] text-construct-textMuted">
                <Wrench size={10} />
                <span className="text-construct-text">{conn.tools.length}</span> tools
              </div>
              <div className="flex items-center gap-1 text-[10px] text-construct-textMuted">
                <RefreshCw size={10} />
                Auto-reconnect
                <button
                  onClick={() => handleToggleAutoReconnect(conn.id)}
                  className={`relative w-7 h-4 rounded-full transition-colors ${
                    conn.autoReconnect ? "bg-construct-success/40" : "bg-construct-textMuted/20"
                  }`}
                >
                  <motion.div
                    className="absolute top-0.5 w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: conn.autoReconnect ? "#a6e3a1" : "#6c7086",
                    }}
                    animate={{ left: conn.autoReconnect ? 14 : 2 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 mt-1">
              <GlowButton
                variant="secondary"
                size="sm"
                loading={testingId === conn.id}
                onClick={() => handleTestConnection(conn.id)}
              >
                <RefreshCw size={10} />
                Test
              </GlowButton>
              {conn.status === "connected" && (
                <GlowButton variant="secondary" size="sm" onClick={() => handleToggleConnection(conn.id)}>
                  <WifiOff size={10} />
                  Disconnect
                </GlowButton>
              )}
              <GlowButton variant="ghost" size="sm" onClick={() => handleDeleteConnection(conn.id)}>
                <Trash2 size={10} />
              </GlowButton>
              <div className="flex-1" />
              <GlowButton
                variant="ghost"
                size="sm"
                onClick={() => setExpandedTools(expandedTools === conn.id ? null : conn.id)}
              >
                {expandedTools === conn.id ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Tools
              </GlowButton>
            </div>

            {/* Tools Tree */}
            <AnimatePresence>
              {expandedTools === conn.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 pt-2 border-t border-construct-border/30 space-y-1">
                    {conn.tools.length === 0 ? (
                      <p className="text-[10px] text-construct-textMuted py-2">No tools available</p>
                    ) : (
                      conn.tools.map((tool) => (
                        <div
                          key={tool.name}
                          className="flex items-start gap-2 px-2 py-1.5 rounded-lg bg-[rgba(255,255,255,0.03)]"
                        >
                          <Wrench size={10} className="mt-0.5 text-construct-accent shrink-0" />
                          <div>
                            <div className="text-[11px] font-medium text-construct-text">{tool.name}</div>
                            <div className="text-[10px] text-construct-textMuted">{tool.description}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>
        ))}

        {/* Available Presets */}
        <div className="mt-4">
          <div className="text-[11px] font-semibold text-construct-textMuted mb-2">Available Presets</div>
          <div className="flex flex-wrap gap-2">
            {mcpPresets.slice(0, 6).map((preset) => (
              <button
                key={preset.name}
                onClick={() => {
                  handlePresetChange(preset.name);
                  setShowAddModal(true);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[rgba(255,255,255,0.04)] border border-construct-border/40 rounded-lg text-[10px] text-construct-textMuted hover:text-construct-text hover:border-construct-accent/30 transition-all"
              >
                {preset.icon}
                {preset.name}
              </button>
            ))}
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-construct-accent/10 border border-construct-accent/20 rounded-lg text-[10px] text-construct-accent hover:bg-construct-accent/20 transition-all"
            >
              <Plus size={10} />
              {mcpPresets.length} more...
            </button>
          </div>
        </div>
      </div>

      {/* Add Connector Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md mx-4 bg-[#1e1e2e] border border-construct-border rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-construct-border/50">
                <div className="flex items-center gap-2">
                  <Plus size={14} className="text-construct-accent" />
                  <span className="text-sm font-semibold text-construct-text">Add Connector</span>
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-construct-textMuted hover:text-construct-text transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-4 space-y-3">
                {/* Preset Selector */}
                <div>
                  <label className="block text-[11px] font-medium text-construct-text mb-1">
                    Preset
                  </label>
                  <select
                    value={selectedPreset}
                    onChange={(e) => handlePresetChange(e.target.value)}
                    className="w-full h-8 px-2.5 bg-[rgba(255,255,255,0.04)] border border-construct-border/50 rounded-lg text-xs text-construct-text outline-none focus:border-construct-accent/50 transition-colors"
                  >
                    <option value="">Custom...</option>
                    {mcpPresets.map((preset) => (
                      <option key={preset.name} value={preset.name}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-[11px] font-medium text-construct-text mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="My Connector"
                    className="w-full h-8 px-2.5 bg-[rgba(255,255,255,0.04)] border border-construct-border/50 rounded-lg text-xs text-construct-text placeholder-construct-textMuted outline-none focus:border-construct-accent/50 transition-colors"
                  />
                </div>

                {/* URL */}
                <div>
                  <label className="block text-[11px] font-medium text-construct-text mb-1">
                    Server URL
                  </label>
                  <input
                    type="text"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://api.example.com"
                    className="w-full h-8 px-2.5 bg-[rgba(255,255,255,0.04)] border border-construct-border/50 rounded-lg text-xs text-construct-text placeholder-construct-textMuted outline-none focus:border-construct-accent/50 transition-colors"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-[11px] font-medium text-construct-text mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full h-8 px-2.5 bg-[rgba(255,255,255,0.04)] border border-construct-border/50 rounded-lg text-xs text-construct-text placeholder-construct-textMuted outline-none focus:border-construct-accent/50 transition-colors"
                  />
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-construct-border/50">
                <GlowButton variant="secondary" size="sm" onClick={() => setShowAddModal(false)}>
                  Cancel
                </GlowButton>
                <GlowButton size="sm" onClick={handleAddConnector} disabled={!customName || !customUrl}>
                  <Check size={12} />
                  Test & Save
                </GlowButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
