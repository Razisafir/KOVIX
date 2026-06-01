import { lazy, Suspense } from "react";
import useAppStore from "../stores/useAppStore";

const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel ?? m.default ?? m.TerminalPanel }))
);

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

  const tabs: Tab[] = [
    { id: "problems", icon: "warning", label: "Problems" },
    { id: "output", icon: "output", label: "Output" },
    { id: "debug-console", icon: "bug_report", label: "Debug Console" },
    { id: "terminal", icon: "terminal", label: "Terminal" },
    { id: "ports", icon: "lan", label: "Ports" },
  ];

  const renderPlaceholder = (label: string, icon: string) => (
    <div className="flex flex-col items-center justify-center h-full gap-3 font-mono">
      <span className="material-symbols-outlined text-[28px] opacity-30 text-text-secondary">{icon}</span>
      <span className="text-[11px] font-semibold tracking-wider text-text-secondary">{label}</span>
      <span className="text-[10px] opacity-60 text-text-secondary">Coming in v0.2.0</span>
    </div>
  );

  const renderContent = () => {
    switch (panelTab) {
      case "terminal":
        return (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full font-mono text-[11px] text-text-secondary">
                loading terminal...
              </div>
            }
          >
            <TerminalPanel />
          </Suspense>
        );
      case "problems": return renderPlaceholder("Problems", "warning");
      case "output": return renderPlaceholder("Output", "output");
      case "debug-console": return renderPlaceholder("Debug Console", "bug_report");
      case "ports": return renderPlaceholder("Ports", "lan");
      default: return renderPlaceholder("Terminal", "terminal");
    }
  };

  return (
    <div className="flex flex-col w-full h-full glass-panel bg-panel-bg">
      {/* Tab Bar */}
      <div className="flex items-center justify-between h-10 shrink-0 bg-bg-onyx border-b border-border-subtle">
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
                  transition-colors duration-[50ms] border-r border-border-subtle
                  ${isActive
                    ? "text-accent-cyan border-b-2 border-b-accent-cyan bg-c-s2"
                    : "text-text-secondary border-b-2 border-b-transparent bg-transparent hover:text-text-primary"
                  }
                `}
              >
                <span className="material-symbols-outlined text-[13px]">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.badge && tab.badge > 0 && (
                  <span className="absolute top-0.5 right-1 text-[7px] font-bold leading-none px-[3px] py-[1px] rounded-full bg-c-warn text-bg-onyx">
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
            className="flex items-center justify-center w-[22px] h-[22px] rounded-md border-0 cursor-pointer bg-transparent text-text-secondary hover:text-text-primary transition-colors"
            title="Close panel"
          >
            <span className="material-symbols-outlined text-[14px]">expand_more</span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden bg-bg-onyx">
        {renderContent()}
      </div>
    </div>
  );
}

export default Panel;
