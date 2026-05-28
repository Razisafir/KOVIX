import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import Panel from "./components/Panel";
import StatusBar from "./components/StatusBar";
import useAppStore from "./stores/useAppStore";

function App() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const panelVisible = useAppStore((s) => s.panelVisible);

  return (
    <div className="flex flex-col w-full h-full bg-construct-bg">
      {/* Toolbar */}
      <div className="flex items-center h-9 px-3 bg-construct-panel border-b border-construct-border shrink-0">
        <span className="text-xs font-semibold tracking-wide text-construct-textMuted uppercase select-none">
          Construct
        </span>
      </div>

      {/* Main Layout */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {sidebarVisible && (
          <aside className="w-60 shrink-0 bg-construct-sidebar border-r border-construct-border">
            <Sidebar />
          </aside>
        )}

        {/* Center - Editor */}
        <main className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0">
            <Routes>
              <Route path="/" element={<Editor />} />
              <Route path="/editor" element={<Editor />} />
            </Routes>
          </div>

          {/* Bottom Panel */}
          {panelVisible && (
            <div className="h-48 shrink-0 bg-construct-panel border-t border-construct-border">
              <Panel />
            </div>
          )}
        </main>
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}

export default App;
