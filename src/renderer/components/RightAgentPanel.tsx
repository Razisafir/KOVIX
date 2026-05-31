import { useState, useEffect } from "react";
import useAppStore from "../stores/useAppStore";

// Tab configuration
const tabs = [
  { id: "chat", icon: "message_square", label: "Chat" },
  { id: "agent", icon: "smart_toy", label: "Agent" },
  { id: "memory", icon: "brain", label: "Memory" },
  { id: "skills", icon: "puzzle", label: "Skills" },
  { id: "mcp", icon: "plug", label: "MCP" },
];

function RightAgentPanel() {
  const rightPanelTab = useAppStore((s) => s.rightPanelTab);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const agentMode = useAppStore((s) => s.agentMode);
  const setAgentMode = useAppStore((s) => s.setAgentMode);
  const agentStatus = useAppStore((s) => s.agentStatus);
  const [goalInput, setGoalInput] = useState("");

  // Listen for panel-tab events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) {
        setRightPanelTab(detail.tab);
      }
    };
    window.addEventListener("construct:panel-tab", handler);
    return () => window.removeEventListener("construct:panel-tab", handler);
  }, [setRightPanelTab]);

  const renderChatContent = () => (
    <div className="flex-1 flex flex-col">
      {/* Chat messages area */}
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {/* Welcome message */}
        <div className="glass-panel p-4" style={{ animation: "fade-in 300ms ease" }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-accent-cyan text-[20px]">smart_toy</span>
            <span className="text-sm font-medium font-sans text-text-primary">Construct Agent</span>
          </div>
          <div className="text-xs text-text-secondary leading-relaxed">
            I can help you code, debug, review, and manage your project. 
            Describe what you want to accomplish.
          </div>
        </div>
        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          {["Explain this code", "Find bugs", "Add tests", "Refactor"].map((action) => (
            <button
              key={action}
              className="btn-ghost text-[10px] font-mono px-3 py-1.5"
              onClick={() => setGoalInput(action)}
            >
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderAgentContent = () => (
    <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
      {/* Agent mode selector */}
      <div className="glass-panel p-3">
        <div className="micro-label text-text-secondary mb-2">Mode</div>
        <div className="flex flex-wrap gap-1.5">
          {(["code", "architect", "debug", "review", "security", "devops"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setAgentMode(mode)}
              className={`text-[10px] font-mono px-2.5 py-1 rounded-md border cursor-pointer transition-all duration-150 ${
                agentMode === mode
                  ? "bg-accent-cyan-dim border-accent-cyan/40 text-accent-cyan"
                  : "bg-transparent border-border-subtle text-text-secondary hover:text-text-primary hover:border-text-secondary/30"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Agent status */}
      <div className="glass-panel p-3">
        <div className="flex items-center justify-between">
          <div className="micro-label text-text-secondary">Status</div>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border ${
            agentStatus === "idle" ? "bg-accent-cyan-dim border-accent-cyan/30 text-accent-cyan" :
            agentStatus === "running" ? "bg-status-running-bg border-status-running/30 text-status-running" :
            "bg-accent-gold-dim border-accent-gold/30 text-accent-gold"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              agentStatus === "idle" ? "led-cyan" :
              agentStatus === "running" ? "led-green" :
              "led-gold"
            }`} />
            {agentStatus}
          </div>
        </div>
        <div className="mt-2 text-[11px] font-mono text-text-secondary">
          Model: claude-sonnet-4-20250514
        </div>
      </div>

      {/* Memory context */}
      <div className="glass-panel p-3">
        <div className="flex items-center gap-2 text-xs text-diff-add mb-2">
          <span className="material-symbols-outlined text-[16px]">memory</span>
          <span className="font-mono">3 memories recalled</span>
        </div>
        <div className="flex gap-1.5">
          {["auth-flow", "api-integration", "ui-components"].map((tag) => (
            <span key={tag} className="text-[9px] font-mono px-2 py-0.5 rounded bg-diff-add/10 text-diff-add border border-diff-add/20">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  const renderMemoryContent = () => (
    <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
      {/* Memory search */}
      <div className="input-glass flex items-center px-3 py-2">
        <span className="material-symbols-outlined text-[14px] text-text-secondary mr-2">search</span>
        <input
          type="text"
          placeholder="Search memories..."
          className="flex-1 bg-transparent border-none outline-none text-[11px] font-mono text-text-primary placeholder:text-text-secondary/50"
        />
      </div>
      {/* Memory stats */}
      <div className="glass-panel p-3">
        <div className="micro-label text-text-secondary mb-2">Usage</div>
        <div className="font-mono text-[11px] text-text-secondary space-y-1">
          <div className="flex justify-between"><span>Contexts</span><span className="text-accent-cyan">1,247</span></div>
          <div className="flex justify-between"><span>Vectors</span><span className="text-accent-cyan">8,932</span></div>
          <div className="flex justify-between"><span>Tokens</span><span className="text-accent-gold">12,456 / 200K</span></div>
        </div>
        <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full w-[6%] bg-accent-cyan rounded-full" style={{ boxShadow: "0 0 8px rgba(0, 229, 255, 0.4)" }} />
        </div>
      </div>
    </div>
  );

  const renderSkillsContent = () => (
    <div className="flex-1 overflow-auto p-4">
      <div className="glass-panel p-3 text-center">
        <span className="material-symbols-outlined text-[24px] text-accent-cyan mb-2">extension</span>
        <div className="text-xs text-text-secondary">Skill marketplace coming soon</div>
      </div>
    </div>
  );

  const renderMcpContent = () => (
    <div className="flex-1 overflow-auto p-4">
      <div className="glass-panel p-3 text-center">
        <span className="material-symbols-outlined text-[24px] text-accent-gold mb-2">hub</span>
        <div className="text-xs text-text-secondary">MCP connectors coming soon</div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (rightPanelTab) {
      case "chat": return renderChatContent();
      case "agent": return renderAgentContent();
      case "memory": return renderMemoryContent();
      case "skills": return renderSkillsContent();
      case "mcp": return renderMcpContent();
      default: return renderChatContent();
    }
  };

  return (
    <aside className="flex flex-col h-full glass-panel-heavy" style={{ width: 380, borderLeft: "1px solid var(--glass-border)" }}>
      {/* ── Panel Header ── */}
      <div className="h-12 px-4 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        <div className="flex items-center gap-2">
          <span className="led-cyan" />
          <span className="text-sm font-medium font-sans text-text-primary">Agent</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setRightPanelTab("chat")}
            className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-accent-cyan hover:bg-accent-cyan-dim transition-colors cursor-pointer border-none bg-transparent"
            title="New chat"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
          </button>
          <button
            onClick={toggleRightPanel}
            className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors cursor-pointer border-none bg-transparent"
            title="Close panel"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex items-center shrink-0 px-2 gap-0.5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
        {tabs.map((tab) => {
          const isActive = rightPanelTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setRightPanelTab(tab.id)}
              className={`flex items-center gap-1.5 px-2.5 py-2 text-[10px] font-mono uppercase tracking-wider font-semibold border-0 cursor-pointer transition-all duration-150 rounded-t-md ${
                isActive
                  ? "text-accent-cyan border-b-2 border-b-accent-cyan bg-accent-cyan-dim/50"
                  : "text-text-secondary border-b-2 border-b-transparent bg-transparent hover:text-text-primary"
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col" style={{ background: "rgba(12, 14, 17, 0.4)" }}>
        {renderContent()}
      </div>

      {/* ── Bottom Input Area ── */}
      <div className="shrink-0 p-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--glass-border)", background: "var(--glass-bg-heavy)" }}>
        {/* Model selector + attach */}
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-md bg-transparent border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-cyan/30 cursor-pointer transition-colors">
            <span className="material-symbols-outlined text-[12px]">neurology</span>
            Claude Sonnet
          </button>
          <button className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-accent-cyan bg-transparent border border-border-subtle cursor-pointer transition-colors">
            <span className="material-symbols-outlined text-[13px]">attach_file</span>
          </button>
          <button className="w-6 h-6 rounded-md flex items-center justify-center text-text-secondary hover:text-accent-cyan bg-transparent border border-border-subtle cursor-pointer transition-colors">
            <span className="material-symbols-outlined text-[13px]">code</span>
          </button>
        </div>
        {/* Input box */}
        <div className="flex items-center input-glass px-3 py-2.5">
          <input
            type="text"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            placeholder="Ask anything... (@ to mention, / for commands)"
            className="flex-1 bg-transparent border-none outline-none text-[12px] font-sans text-text-primary placeholder:text-text-secondary/50 caret-accent-cyan"
          />
          <button className="ml-2 w-8 h-8 rounded-lg btn-primary flex items-center justify-center text-bg-onyx">
            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
          </button>
        </div>
        <div className="text-[9px] text-text-secondary/40 text-center font-mono">
          AI may make mistakes. Review generated code.
        </div>
      </div>
    </aside>
  );
}

export default RightAgentPanel;
