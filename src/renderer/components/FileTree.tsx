import React, { useState, useCallback, useEffect } from "react";

/* ─────────────────────── Types ─────────────────────── */

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children: TreeNode[];
  expanded?: boolean;
  isModified?: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

/* ─────────────────────── File Icons ─────────────────────── */

const FILE_ICON_MAP: Record<string, string> = {
  ts: "\u{1F539}", tsx: "\u269B\uFE0F", js: "\u{1F7E8}", jsx: "\u269B\uFE0F",
  py: "\u{1F40D}", rs: "\u{1F980}", go: "\u{1F439}", java: "\u2615",
  json: "\u{1F4CB}", md: "\u{1F4DD}", yml: "\u2699\uFE0F", yaml: "\u2699\uFE0F",
  css: "\u{1F3A8}", scss: "\u{1F3A8}", html: "\u{1F310}", dockerfile: "\u{1F433}",
  sh: "\u{1F4BB}", bash: "\u{1F4BB}", sql: "\u{1F4CA}", toml: "\u2699\uFE0F",
  txt: "\u{1F4C4}", svg: "\u{1F3A8}", xml: "\u{1F4C4}",
};

function getFileIcon(name: string, type: "file" | "folder", isExpanded?: boolean): string {
  if (type === "folder") return isExpanded ? "\u{1F4C2}" : "\u{1F4C1}";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return FILE_ICON_MAP[ext] || "\u{1F4C4}";
}

/* ─────────────────────── Build Tree from Flat Paths ─────────────────────── */

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "root", path: "", type: "folder", children: [] };

  for (const filePath of paths) {
    const parts = filePath.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const existingChild = current.children.find((c) => c.name === part);

      if (existingChild) {
        current = existingChild;
      } else {
        const newNode: TreeNode = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          type: isFile ? "file" : "folder",
          children: [],
          expanded: false,
        };
        current.children.push(newNode);
        current = newNode;
      }
    }
  }

  // Sort: folders first, then alphabetical
  const sortChildren = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortChildren);
  };
  sortChildren(root);

  return root;
}

/* ─────────────────────── Tree Item ─────────────────────── */

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  activeFilePath: string | null;
  onSelect: (path: string, type: "file" | "folder") => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
}

function TreeItem({
  node,
  depth,
  activeFilePath,
  onSelect,
  expandedFolders,
  toggleFolder,
}: TreeItemProps) {
  const isFolder = node.type === "folder";
  const isExpanded = expandedFolders.has(node.path);
  const isActive = node.path === activeFilePath;

  const statusDot = node.isNew
    ? "\u{1F7E2}"
    : node.isModified
    ? "\u{1F7E1}"
    : node.isDeleted
    ? "\u{1F534}"
    : null;

  return (
    <>
      <div
        className={`
          flex items-center cursor-pointer select-none transition-colors duration-75
          ${isActive ? "bg-[#00E5FF18] text-[#00E5FF]" : "text-[#E0E7FF] hover:bg-[#1A1F2E]"}
        `}
        style={{
          height: 22,
          paddingLeft: depth * 12 + 8,
          paddingRight: 8,
          borderLeft: isActive ? "2px solid #00E5FF" : "2px solid transparent",
        }}
        onClick={() => {
          if (isFolder) {
            toggleFolder(node.path);
          } else {
            onSelect(node.path, "file");
          }
        }}
      >
        {/* Expand arrow */}
        <span className="w-4 text-center text-[10px] text-[#4A5568] shrink-0">
          {isFolder ? (isExpanded ? "\u25BC" : "\u25B6") : ""}
        </span>

        {/* Icon */}
        <span className="text-[11px] mr-1 shrink-0">
          {getFileIcon(node.name, node.type, isExpanded)}
        </span>

        {/* Name */}
        <span className="truncate text-[11px] font-mono flex-1">
          {node.name}
        </span>

        {/* Status dot */}
        {statusDot && (
          <span className="ml-auto text-[8px] shrink-0">{statusDot}</span>
        )}
      </div>

      {/* Children */}
      {isFolder && isExpanded && (
        <>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onSelect={onSelect}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
            />
          ))}
        </>
      )}
    </>
  );
}

/* ─────────────────────── FileTree Component ─────────────────────── */

interface FileTreeProps {
  onFileSelect?: (path: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({ onFileSelect }) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["src", "src/core", "src/components"])
  );
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeNode | null>(null);

  // Build tree from project files (using Tauri FS or fallback to static data)
  useEffect(() => {
    // In a real app, this would use @tauri-apps/plugin-fs to read the directory
    // For now, use a representative project structure
    const projectPaths = [
      "src/core/executor.py",
      "src/core/llm_service.py",
      "src/core/safety.py",
      "src/core/shadow_fs.py",
      "src/core/sandbox.py",
      "src/core/telemetry.py",
      "src/core/code_graph.py",
      "src/core/hybrid_search.py",
      "src/tools/__init__.py",
      "src/tools/shadow_wrappers.py",
      "src/tools/sandboxed_commands.py",
      "src/tools/file_tools.py",
      "src/tools/shell_tools.py",
      "src/tools/git_tools.py",
      "src/memory/__init__.py",
      "src/memory/semantic.py",
      "src/agents/__init__.py",
      "src/agents/orchestrator.py",
      "src/security/agent_shield.py",
      "src/app.py",
      "src/main.py",
      "frontend/src/renderer/App.tsx",
      "frontend/src/renderer/main.tsx",
      "frontend/src/renderer/components/MonacoEditor.tsx",
      "frontend/src/renderer/components/FileTree.tsx",
      "frontend/src/renderer/components/IDELayout.tsx",
      "frontend/src/renderer/components/TerminalPanel.tsx",
      "frontend/src/renderer/components/InlineAgent.tsx",
      "frontend/src/renderer/components/StatusBar.tsx",
      "frontend/src/renderer/components/DiffViewer.tsx",
      "frontend/src/renderer/components/TraceViewer.tsx",
      "frontend/src/renderer/stores/useAppStore.ts",
      "frontend/src/renderer/stores/useDiffStore.ts",
      "frontend/src/main/src/lib.rs",
      "frontend/src/main/src/terminal.rs",
      "requirements.txt",
      "pyproject.toml",
      "README.md",
      "Dockerfile",
      "docker-compose.yml",
      ".gitignore",
      "package.json",
      "Cargo.toml",
    ];

    const tree = buildTree(projectPaths);
    setTreeData(tree);
  }, []);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (path: string, type: "file" | "folder") => {
      if (type === "folder") {
        toggleFolder(path);
      } else {
        setActiveFilePath(path);
        onFileSelect?.(path);
      }
    },
    [onFileSelect, toggleFolder]
  );

  return (
    <div className="h-full flex flex-col bg-[#0A0E1A] text-[#E0E7FF] overflow-hidden font-sans">
      {/* Explorer Header */}
      <div className="h-[30px] flex items-center px-3 shrink-0 border-b border-[#1A1F2E]">
        <span className="text-[10px] font-bold tracking-widest uppercase text-[#4A5568]">
          Explorer
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="text-[14px] text-[#4A5568] hover:text-[#00E5FF] cursor-pointer bg-transparent border-none transition-colors"
            title="New File"
          >
            +
          </button>
          <button
            className="text-[12px] text-[#4A5568] hover:text-[#00E5FF] cursor-pointer bg-transparent border-none transition-colors"
            title="Refresh"
          >
            \u21BB
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto py-[2px]">
        {treeData?.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={0}
            activeFilePath={activeFilePath}
            onSelect={handleSelect}
            expandedFolders={expandedFolders}
            toggleFolder={toggleFolder}
          />
        ))}
      </div>

      {/* Recent Memory (legacy from Sidebar) */}
      <div className="border-t border-[#1A1F2E] shrink-0">
        <div className="h-[26px] flex items-center px-3">
          <span className="text-[10px] font-bold tracking-widest uppercase text-[#4A5568]">
            Recent Memory
          </span>
        </div>
        <div className="px-3 pb-2 flex flex-col gap-[6px]">
          {[
            { text: "auth-flow", color: "#00E5FF" },
            { text: "api-integration", color: "#E9C349" },
            { text: "ui-components", color: "#00E5FF" },
          ].map((mem, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className="w-[6px] h-[6px] rounded-full shrink-0"
                style={{ backgroundColor: mem.color, boxShadow: `0 0 6px ${mem.color}40` }}
              />
              <span className="text-[10px] text-[#849495] truncate">
                {mem.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FileTree;
