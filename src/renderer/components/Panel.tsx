import { useEffect } from "react";
import useAppStore from "../stores/useAppStore";
import { useDiffStore } from "../stores/useDiffStore";
import DiffPanel from "./DiffPanel";

interface Tab {
  id: string;
  icon: string;
  label: string;
  badge?: number;
}

function Panel() {
  const panelTab = useAppStore((s) => s.panelTab);
  const setPanelTab = useAppStore((s) => s.setPanelTab);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const pendingDiffCount = useDiffStore((s) => s.getPendingCount());

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) {
        setPanelTab(detail.tab);
      }
    };
    window.addEventListener("construct:panel-tab", handler);
    return () => window.removeEventListener("construct:panel-tab", handler);
  }, [setPanelTab]);

  const tabs: Tab[] = [
    { id: "terminal", icon: "terminal", label: "Terminal" },
    { id: "chat", icon: "chat", label: "Chat" },
    { id: "agent", icon: "smart_toy", label: "Agent" },
    { id: "memory", icon: "memory", label: "Memory" },
    { id: "changes", icon: "commit", label: "Changes", badge: pendingDiffCount || undefined },
    { id: "skills", icon: "extension", label: "Skills" },
    { id: "mcp", icon: "hub", label: "MCP" },
    { id: "screen", icon: "screenshot_monitor", label: "Screen" },
    { id: "agents", icon: "group", label: "Agents" },
    { id: "auto", icon: "bolt", label: "Auto" },
  ];

  const renderTerminal = () => (
    <div className="font-mono text-[11px] leading-[18px] p-2 text-text-secondary">
      <div>$ construct --version</div>
      <div className="text-text-primary">0.1.0-alpha</div>
      <div className="mt-1">$ npm run dev</div>
      <div className="text-c-ok">vite v6.0 ready in 342ms</div>
      <div className="text-accent-cyan">
        local: http://localhost:5173/
      </div>
      <div className="mt-1">$ cargo tauri dev</div>
      <div className="text-text-primary">Running ConstructApp...</div>
      <div className="mt-1 text-accent-cyan">_</div>
    </div>
  );

  const renderChat = () => (
    <div className="p-2">
      <div className="text-[11px] mb-2 text-text-secondary">
        AI assistant panel. Type to send messages.
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          placeholder="Ask anything..."
          className="flex-1 h-[26px] px-2 rounded-md text-[11px] font-mono outline-none bg-bg-onyx border border-border-subtle text-text-primary placeholder:text-c-text4 focus:border-c-border-active"
        />
        <button className="h-[26px] px-3 rounded-md text-[10px] font-semibold font-mono text-bg-onyx uppercase tracking-wider cursor-pointer border-0 bg-accent-cyan hover:bg-accent-cyan/90 transition-colors">
          Send
        </button>
      </div>
    </div>
  );

  const renderAgent = () => (
    <div className="p-2">
      <div className="micro-label mb-2 text-text-secondary">
        Agent Status
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] w-[60px] text-c-text4">State</span>
        <span className="text-[11px] text-c-text2">idle</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] w-[60px] text-c-text4">Model</span>
        <span className="text-[11px] text-c-text2">
          claude-sonnet-4-20250514
        </span>
      </div>
    </div>
  );

  const renderMemory = () => (
    <div className="p-2">
      <div className="micro-label mb-2 text-text-secondary">
        Memory Usage
      </div>
      <div className="font-mono text-[11px] leading-[18px] text-c-text2">
        <div>Contexts: 1,247</div>
        <div>Vectors: 8,932</div>
        <div>Tokens: 12,456 / 200,000</div>
        <div>Usage: 6.2%</div>
      </div>
    </div>
  );

  const renderPlaceholder = (label: string) => (
    <div className="p-2">
      <div className="text-[11px] font-mono text-text-secondary">
        {label} panel content.
      </div>
    </div>
  );

  const renderContent = () => {
    switch (panelTab) {
      case "terminal": return renderTerminal();
      case "chat": return renderChat();
      case "agent": return renderAgent();
      case "memory": return renderMemory();
      case "changes": return <DiffPanel />;
      case "skills": return renderPlaceholder("Skills");
      case "mcp": return renderPlaceholder("MCP");
      case "screen": return renderPlaceholder("Screen");
      case "agents": return renderPlaceholder("Multi-agent");
      case "auto": return renderPlaceholder("Autonomous");
      default: return renderTerminal();
    }
  };

  return (
    <div className="flex flex-col w-full h-full" style={{ background: "rgba(12, 14, 17, 0.6)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
      {/* Tab Bar */}
      <div className="flex items-center justify-between h-9 shrink-0" style={{ background: "rgba(20, 22, 25, 0.6)", borderBottom: "1px solid rgba(0, 229, 255, 0.08)" }}>
        <div className="flex overflow-hidden flex-1">
          {tabs.map((tab) => {
            const isActive = panelTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setPanelTab(tab.id)}
                className={`
                  relative flex items-center h-full px-[10px] gap-[5px] border-0 cursor-pointer shrink-0
                  whitespace-nowrap font-mono text-[10px] uppercase tracking-wider font-semibold
                  transition-all duration-100
                  ${isActive
                    ? "text-accent-cyan border-b-2 border-b-accent-cyan"
                    : "text-text-secondary border-b-2 border-b-transparent bg-transparent hover:text-text-primary"
                  }
                `}
                style={{ backgroundColor: isActive ? "rgba(0, 229, 255, 0.06)" : undefined }}
              >
                <span className="material-symbols-outlined text-[13px]">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.badge && tab.badge > 0 && (
                  <span className="absolute top-0.5 right-1 text-[7px] font-bold leading-none px-[3px] py-[1px] rounded-full bg-accent-gold text-bg-onyx">
                    {tab.badge > 9 ? "9+" : tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center pr-1 shrink-0">
          <button
            onClick={togglePanel}
            className="flex items-center justify-center w-[22px] h-[22px] rounded-md border-0 cursor-pointer bg-transparent text-text-secondary hover:text-accent-cyan transition-colors"
            title="Close panel"
          >
            <span className="material-symbols-outlined text-[14px]">expand_more</span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto" style={{ background: "rgba(12, 14, 17, 0.3)" }}>
        {renderContent()}
      </div>
    </div>
  );
}

export default Panel;
