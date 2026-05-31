import useAppStore from "../stores/useAppStore";

function StatusBar() {
  const branch = "feat/plan-act-mode";
  const rightPanelVisible = useAppStore((s) => s.rightPanelVisible);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const agentStatus = useAppStore((s) => s.agentStatus);

  return (
    <footer className="h-7 flex-shrink-0 flex items-center justify-between px-3 text-[10px] font-mono relative z-50"
      style={{
        background: "rgba(20, 22, 25, 0.8)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderTop: "1px solid rgba(0, 229, 255, 0.12)",
      }}
    >
      {/* Left section */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="led-green" />
          <span className="text-diff-add">memory active</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={agentStatus === "running" ? "led-cyan" : "led-gold"} />
          <span className={agentStatus === "running" ? "text-accent-cyan" : "text-accent-gold"}>
            Claude Sonnet
          </span>
        </div>
        <div className="text-text-secondary">
          main.py · line 25
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-4">
        <button
          onClick={togglePanel}
          className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary cursor-pointer bg-transparent border-none transition-colors"
        >
          <span className="material-symbols-outlined text-[12px]">terminal</span>
          Terminal
        </button>
        <button
          onClick={toggleRightPanel}
          className="flex items-center gap-1.5 cursor-pointer bg-transparent border-none transition-colors"
          style={{
            color: rightPanelVisible ? "#00e5ff" : "#849495",
          }}
        >
          <span className="material-symbols-outlined text-[12px]">smart_toy</span>
          Agent
        </button>
        <div className="text-text-secondary flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[12px]">edit_note</span>
          {branch}
        </div>
        <div className="text-text-secondary">
          2 pending · 0 errors
        </div>
      </div>
    </footer>
  );
}

export default StatusBar;
