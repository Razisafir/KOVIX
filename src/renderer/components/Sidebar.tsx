import { useState } from "react";

interface FileNode {
  name: string;
  type: "file" | "folder";
  indent: number;
  expanded?: boolean;
  mod?: "M" | "A" | "E";
  fileType?: string;
}

const fileTree: FileNode[] = [
  { name: "src", type: "folder", indent: 0, expanded: true },
  { name: "components", type: "folder", indent: 1, expanded: true },
  { name: "Sidebar.tsx", type: "file", indent: 2, mod: "M", fileType: "tsx" },
  { name: "Editor.tsx", type: "file", indent: 2, mod: "A", fileType: "tsx" },
  { name: "Panel.tsx", type: "file", indent: 2, fileType: "tsx" },
  { name: "StatusBar.tsx", type: "file", indent: 2, mod: "E", fileType: "tsx" },
  { name: "App.tsx", type: "file", indent: 1, mod: "M", fileType: "tsx" },
  { name: "main.tsx", type: "file", indent: 1, fileType: "tsx" },
  { name: "tests", type: "folder", indent: 0, expanded: false },
  { name: "test_agent.py", type: "file", indent: 1, fileType: "py" },
  { name: "test_memory.py", type: "file", indent: 1, fileType: "py" },
  { name: "requirements.txt", type: "file", indent: 0, fileType: "txt" },
  { name: "README.md", type: "file", indent: 0, fileType: "md" },
];

const recentMemories = [
  { text: "Uses FastAPI + async routes", time: "2 days ago", dotClass: "led-green" },
  { text: "Prefers snake_case, ruff for linting", time: "1 week ago", dotClass: "led-cyan" },
  { text: "Added ChromaDB for embeddings", time: "2 weeks ago", dotClass: "led-gold" },
];

/** Returns a Tailwind bg-* class for the file status dot */
function dotClass(mod?: string): string {
  if (mod === "M") return "bg-accent-gold";   // gold — modified
  if (mod === "A") return "bg-accent-cyan";    // cyan — added
  if (mod === "E") return "bg-diff-remove";    // red — error
  return "bg-c-text4";                          // muted — no status
}

/** Returns a Tailwind text-* class for the mod badge */
function modBadgeClass(mod?: string): string {
  if (mod === "M") return "text-accent-gold";   // gold
  if (mod === "A") return "text-accent-cyan";    // cyan
  if (mod === "E") return "text-diff-remove";    // red
  return "";
}

function Sidebar() {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["src", "components"])
  );
  const [activeFile, setActiveFile] = useState("main.py");

  const toggleFolder = (name: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <aside className="flex flex-col h-full" style={{ background: "rgba(12, 14, 17, 0.6)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
      {/* ── Explorer Header ── */}
      <div className="h-10 px-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(0, 229, 255, 0.08)" }}>
        <span className="font-mono text-[10px] font-semibold tracking-widest uppercase text-text-secondary">
          MY-API-PROJECT
        </span>
        <span className="material-symbols-outlined text-[16px] cursor-pointer text-text-secondary hover:text-accent-cyan transition-colors">
          more_horiz
        </span>
      </div>

      {/* ── File Tree ── */}
      <div className="flex-1 overflow-auto py-2 font-mono text-sm">
        <div className="flex flex-col gap-[2px]">
          {fileTree.map((node) => {
            const isFolder = node.type === "folder";
            const isExpanded = expandedFolders.has(node.name);
            const isActive = activeFile === node.name;

            return (
              <div
                key={node.name + node.indent}
                onClick={() => {
                  if (isFolder) toggleFolder(node.name);
                  else setActiveFile(node.name);
                }}
                className={
                  "flex items-center cursor-pointer border-l-2 transition-all duration-100 " +
                  (isActive
                    ? "border-accent-cyan text-text-primary"
                    : "border-transparent hover:bg-white/5 text-text-secondary")
                }
                style={{
                  height: 28,
                  paddingLeft: 16 + node.indent * 16,
                  paddingRight: 8,
                  backgroundColor: isActive ? "rgba(0, 229, 255, 0.06)" : undefined,
                }}
              >
                {isFolder ? (
                  <span className="material-symbols-outlined text-[16px] mr-1 text-text-secondary">
                    {isExpanded ? "arrow_drop_down" : "arrow_right"}
                  </span>
                ) : (
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mr-2 ${dotClass(node.mod)}`}
                    style={{ boxShadow: node.mod ? "0 0 6px currentColor" : undefined }}
                  />
                )}
                <span className="truncate text-[12px]">
                  {isFolder ? node.name + "/" : node.name}
                </span>
                {node.mod && (
                  <span
                    className={`text-[9px] font-semibold ml-2 font-mono ${modBadgeClass(node.mod)}`}
                  >
                    [{node.mod}]
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Recent Memory Section ── */}
      <div className="border-t flex flex-col" style={{ borderColor: "rgba(0, 229, 255, 0.08)" }}>
        <div className="h-9 px-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px] text-accent-gold">
            memory
          </span>
          <span className="font-mono text-[10px] font-semibold tracking-widest uppercase text-text-secondary">
            RECENT MEMORY
          </span>
        </div>
        <div className="overflow-auto p-3 flex flex-col gap-3">
          {recentMemories.map((mem, i) => (
            <div key={i} className="flex gap-2.5">
              <div className={`mt-1.5 ${mem.dotClass}`} />
              <div>
                <div className="text-[11px] text-text-primary">{mem.text}</div>
                <div className="text-[10px] text-text-secondary mt-0.5">{mem.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
