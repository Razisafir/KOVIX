import { useState } from "react";
import {
  Terminal,
  MessageSquare,
  ListChecks,
  X,
  ChevronUp,
} from "lucide-react";

interface Tab {
  id: string;
  icon: React.ReactNode;
  label: string;
}

const tabs: Tab[] = [
  { id: "terminal", icon: <Terminal size={14} />, label: "Terminal" },
  { id: "problems", icon: <ListChecks size={14} />, label: "Problems" },
  { id: "chat", icon: <MessageSquare size={14} />, label: "Chat" },
];

function Panel() {
  const [activeTab, setActiveTab] = useState("terminal");

  return (
    <div className="flex flex-col w-full h-full">
      {/* Tab Bar */}
      <div className="flex items-center justify-between h-8 bg-construct-panel border-b border-construct-border">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center h-8 px-3 gap-1.5 text-xs border-r border-construct-border
                transition-colors duration-100
                ${
                  activeTab === tab.id
                    ? "bg-construct-bg text-construct-text border-t-2 border-t-construct-accent"
                    : "text-construct-textMuted hover:text-construct-text hover:bg-construct-hover"
                }
              `}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center pr-1">
          <button
            onClick={() => {}}
            className="flex items-center justify-center w-6 h-6 rounded text-construct-textMuted hover:text-construct-text hover:bg-construct-hover transition-colors"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => {}}
            className="flex items-center justify-center w-6 h-6 rounded text-construct-textMuted hover:text-construct-text hover:bg-construct-hover transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {activeTab === "terminal" && (
          <div className="font-mono text-xs space-y-1">
            <div className="text-construct-textMuted">
              $ construct --version
            </div>
            <div className="text-construct-text">0.1.0</div>
            <div className="text-construct-textMuted mt-2">
              $ npm run dev
            </div>
            <div className="text-construct-success">
              VITE v6.0 ready in 342 ms
            </div>
            <div className="text-construct-accent">
              ➜ Local: http://localhost:5173/
            </div>
            <div className="text-construct-textMuted mt-2">
              $ cargo tauri dev
            </div>
            <div className="text-construct-text">
              Running ConstructApp...
            </div>
            <div className="text-construct-textMuted animate-pulse">_</div>
          </div>
        )}

        {activeTab === "problems" && (
          <div className="text-xs">
            <div className="flex items-center py-1.5 px-2 text-construct-success border-b border-construct-border">
              <ListChecks size={14} className="mr-2" />
              No problems detected
            </div>
          </div>
        )}

        {activeTab === "chat" && (
          <div className="text-xs text-construct-textMuted">
            <p>AI Assistant chat panel.</p>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                placeholder="Ask anything..."
                className="flex-1 h-7 px-2 bg-construct-bg border border-construct-border rounded text-xs text-construct-text placeholder-construct-textMuted outline-none focus:border-construct-accent transition-colors"
              />
              <button className="h-7 px-3 bg-construct-accent hover:bg-construct-accentHover text-construct-panel rounded text-xs font-medium transition-colors">
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Panel;
