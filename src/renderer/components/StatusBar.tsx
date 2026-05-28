import {
  Layout,
  PanelBottom,
  PanelLeft,
  GitBranch,
  CircleDot,
} from "lucide-react";
import useAppStore from "@/stores/useAppStore";

function StatusBar() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const panelVisible = useAppStore((s) => s.panelVisible);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const cursorPosition = useAppStore((s) => s.cursorPosition);

  return (
    <footer className="flex items-center justify-between h-6 px-2 bg-construct-accent text-construct-panel shrink-0 select-none">
      {/* Left */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={toggleSidebar}
          title="Toggle Sidebar"
          className={`flex items-center justify-center w-5 h-5 rounded transition-colors ${
            sidebarVisible
              ? "bg-white/20"
              : "hover:bg-white/10"
          }`}
        >
          <PanelLeft size={12} />
        </button>
        <button
          onClick={togglePanel}
          title="Toggle Panel"
          className={`flex items-center justify-center w-5 h-5 rounded transition-colors ${
            panelVisible
              ? "bg-white/20"
              : "hover:bg-white/10"
          }`}
        >
          <PanelBottom size={12} />
        </button>
        <button
          title="Layout"
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-white/10 transition-colors"
        >
          <Layout size={12} />
        </button>
        <span className="mx-1.5 text-[10px] opacity-50">|</span>
        <div className="flex items-center gap-1 text-[11px]">
          <GitBranch size={11} />
          <span>main</span>
        </div>
      </div>

      {/* Center */}
      <div className="flex items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1">
          <CircleDot size={10} className="text-construct-success" />
          Ready
        </span>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 text-[11px]">
        <span>
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </span>
        <span>UTF-8</span>
        <span>TypeScript</span>
      </div>
    </footer>
  );
}

export default StatusBar;
