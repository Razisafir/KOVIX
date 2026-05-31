import React, { useState, useCallback, Suspense, lazy, useEffect } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { FileTree } from "./FileTree";
import { MonacoEditor } from "./MonacoEditor";
import TabBar, { type EditorTab } from "./TabBar";
import useAppStore from "../stores/useAppStore";
import { InlineAgentManager } from "./InlineAgent";
import { isTauri, getWriteTextFile } from "../utils/tauriHelpers";

const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((m) => ({ default: m.TerminalPanel }))
);
const DiffPanel = lazy(() => import("./DiffPanel"));
const MemoryPanel = lazy(() => import("./MemoryPanel"));
const RightAgentPanel = lazy(() => import("./RightAgentPanel"));

/* ─────────────────────── Default code ─────────────────────── */

const DEFAULT_CODE = `import { useState } from "react";

interface Props {
  title: string;
  count?: number;
}

# Construct — autonomous API agent
# memory: SQLite + ChromaDB

from fastapi import FastAPI, Request
from contextlib import asynccontextmanager
from .memory import MemoryStore
from .agent import Agent

memory = MemoryStore(db_path="memories.db")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await memory.init()
    yield

    # agent writes proposed diffs here
    app.state.pending_diff = []

app = FastAPI(lifespan=lifespan)

@app.websocket("/ws/agent")
async def agent_stream(ws):
    await ws.accept()
    ctx = await memory.get_context()
`;

/* ─────────────────────── Tab Helpers ─────────────────────── */

let tabIdCounter = 0;

function createTab(
  fileName: string,
  filePath: string,
  language: string,
  content: string,
  isModified = false
): EditorTab {
  return {
    id: `tab-${++tabIdCounter}-${Date.now().toString(36)}`,
    fileName,
    filePath,
    language,
    content,
    isModified,
    isActive: false,
  };
}

/* ─────────────────────── IDE Layout ─────────────────────── */

export const IDELayout: React.FC = () => {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const panelVisible = useAppStore((s) => s.panelVisible);
  const rightPanelVisible = useAppStore((s) => s.rightPanelVisible);
  const panelTab = useAppStore((s) => s.panelTab);
  const setPanelTab = useAppStore((s) => s.setPanelTab);
  const agentStatus = useAppStore((s) => s.agentStatus);

  // Editor state (local until we add useEditorStore)
  const [tabs, setTabs] = useState<EditorTab[]>(() => [
    createTab("main.py", "src/main.py", "python", DEFAULT_CODE, true),
    createTab("agent.py", "src/agent.py", "python", "# Agent component code\n", true),
    createTab("main.tsx", "src/main.tsx", "typescript", "// main entry point\n", false),
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0]?.id ?? "");

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  const handleActivateTab = useCallback((id: string) => {
    setActiveTabId(id);
    setTabs((prev) => prev.map((t) => ({ ...t, isActive: t.id === id })));
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const remaining = prev.filter((t) => t.id !== id);
      if (remaining.length === 0) return prev;
      if (id === prev.find((t) => t.isActive)?.id) {
        const newIdx = Math.min(idx, remaining.length - 1);
        remaining[newIdx] = { ...remaining[newIdx], isActive: true };
        setActiveTabId(remaining[newIdx].id);
      }
      return remaining;
    });
  }, []);

  const handleOpenTab = useCallback(
    (file: { fileName: string; filePath: string; language?: string; content?: string }) => {
      setTabs((prev) => {
        const existing = prev.find((t) => t.filePath === file.filePath);
        if (existing) {
          setActiveTabId(existing.id);
          return prev.map((t) => ({ ...t, isActive: t.id === existing.id }));
        }
        const newTab = createTab(
          file.fileName,
          file.filePath,
          file.language ?? "typescript",
          file.content ?? "",
          false
        );
        setActiveTabId(newTab.id);
        return [...prev.map((t) => ({ ...t, isActive: false })), { ...newTab, isActive: true }];
      });
    },
    []
  );

  const handleEditorChange = useCallback(
    (value: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, content: value, isModified: true } : t
        )
      );
    },
    [activeTabId]
  );

  // Listen for file content events from FileTree (when reading from disk)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.path && detail?.content) {
        // Update the tab content if a tab for this file is open
        setTabs((prev) =>
          prev.map((t) =>
            t.filePath === detail.path
              ? { ...t, content: detail.content, isModified: false }
              : t
          )
        );
      }
    };
    window.addEventListener("construct:file-content", handler);
    return () => window.removeEventListener("construct:file-content", handler);
  }, []);

  const handleFileSelect = useCallback(
    (path: string) => {
      const fileName = path.split("/").pop() || path;
      const existing = tabs.find((t) => t.filePath === path);
      if (existing) {
        handleActivateTab(existing.id);
      } else {
        handleOpenTab({ fileName, filePath: path });
      }
    },
    [tabs, handleActivateTab, handleOpenTab]
  );

  const handleSave = useCallback(
    async (value: string) => {
      const filePath = activeTab?.filePath;
      if (!filePath) return;

      try {
        const writeFn = getWriteTextFile();
        if (isTauri() && writeFn) {
          await writeFn(filePath, value);
          console.log("[IDE] Saved to disk:", filePath);
        }
      } catch (err) {
        console.error("[IDE] Failed to save:", err);
      }

      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, content: value, isModified: false } : t
        )
      );
    },
    [activeTabId, activeTab]
  );

  /* ─── Bottom panel tabs ─── */
  const bottomTabs = [
    { id: "terminal", label: "Terminal" },
    { id: "chat", label: "Chat" },
    { id: "memory", label: "Memory" },
    { id: "changes", label: "Changes" },
    { id: "skills", label: "Skills" },
    { id: "mcp", label: "MCP" },
  ];

  return (
    <InlineAgentManager>
      <div className="h-screen w-screen flex flex-col bg-[#0A0E1A] text-[#E0E7FF] overflow-hidden font-sans">
        {/* ── Title Bar / Menu ── */}
        <div className="h-[30px] bg-[#141B2D] border-b border-[#1A1F2E] flex items-center px-3 text-[11px] select-none shrink-0">
          <span className="font-bold text-[#00E5FF] mr-5 tracking-wider text-[12px]">
            CONSTRUCT
          </span>
          {["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"].map(
            (item) => (
              <span
                key={item}
                className="text-[#4A5568] hover:text-[#E0E7FF] cursor-pointer px-2.5 transition-colors"
              >
                {item}
              </span>
            )
          )}
          <div className="ml-auto flex items-center gap-3">
            {agentStatus === "running" && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#00E5FF] animate-pulse" />
                <span className="text-[10px] text-[#00E5FF] font-mono">Agent working</span>
              </div>
            )}
            <span className="text-[10px] text-[#4A5568] font-mono">v0.1.0-beta</span>
          </div>
        </div>

        {/* ── Main Content ── */}
        <div className="flex-1 overflow-hidden">
          <Allotment defaultSizes={sidebarVisible ? [220, 1, 320] : [0, 1, 320]}>
            {/* Left Sidebar — File Tree */}
            {sidebarVisible && (
              <Allotment.Pane preferredSize={220} minSize={150} maxSize={400}>
                <FileTree onFileSelect={handleFileSelect} />
              </Allotment.Pane>
            )}

            {/* Center — Editor + Bottom Panel */}
            <Allotment.Pane minSize={300}>
              <Allotment vertical defaultSizes={panelVisible ? [1, 200] : [1, 0]}>
                {/* Editor Area */}
                <Allotment.Pane minSize={200}>
                  <div className="h-full flex flex-col">
                    {/* Tab Bar */}
                    <TabBar
                      tabs={tabs}
                      activeTabId={activeTabId}
                      onActivate={handleActivateTab}
                      onClose={handleCloseTab}
                      onOpen={handleOpenTab}
                    />

                    {/* Breadcrumb */}
                    <div className="flex items-center h-[22px] px-3 shrink-0 bg-[#0A0E1A] border-b border-[#1A1F2E]">
                      <span className="text-[10px] font-mono text-[#4A5568] tracking-wide whitespace-nowrap overflow-hidden text-ellipsis">
                        {activeTab?.filePath ?? "no file open"}
                      </span>
                      {activeTab?.isModified && (
                        <span className="ml-2 text-[9px] font-mono text-[#00E5FF]">
                          {"\u25CF"} modified
                        </span>
                      )}
                    </div>

                    {/* Editor */}
                    <div className="flex-1 min-h-0">
                      {activeTab ? (
                        <MonacoEditor
                          filePath={activeTab.filePath}
                          content={activeTab.content}
                          language={activeTab.language}
                          onChange={handleEditorChange}
                          onSave={handleSave}
                        />
                      ) : (
                        <div className="h-full flex items-center justify-center text-[#4A5568] text-sm">
                          <div className="text-center">
                            <div className="text-5xl mb-4 opacity-15">
                              {"\u{1F916}"}
                            </div>
                            <p className="text-[13px]">
                              Open a file or ask the agent to create one
                            </p>
                            <p className="text-[11px] mt-2 opacity-50">
                              Ctrl+Shift+L for inline agent
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </Allotment.Pane>

                {/* Bottom Panel */}
                {panelVisible && (
                  <Allotment.Pane preferredSize={200} minSize={100} maxSize={600}>
                    <div className="h-full bg-[#0A0E1A] border-t border-[#1A1F2E] flex flex-col">
                      {/* Bottom Tabs */}
                      <div className="h-[28px] bg-[#141B2D] flex items-center text-[11px] shrink-0 overflow-x-auto">
                        {bottomTabs.map((tab) => (
                          <button
                            key={tab.id}
                            className={`px-3 py-1 border-b-2 whitespace-nowrap cursor-pointer bg-transparent transition-colors ${
                              panelTab === tab.id
                                ? "border-b-[#00E5FF] text-[#E0E7FF]"
                                : "border-b-transparent text-[#4A5568] hover:text-[#E0E7FF]"
                            }`}
                            onClick={() => setPanelTab(tab.id)}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      {/* Bottom Content */}
                      <div className="flex-1 overflow-hidden">
                        <Suspense
                          fallback={
                            <div className="p-2 text-[10px] text-[#4A5568] font-mono">
                              loading...
                            </div>
                          }
                        >
                          {panelTab === "terminal" && <TerminalPanel />}
                          {panelTab === "changes" && <DiffPanel />}
                          {panelTab === "memory" && <MemoryPanel />}
                          {panelTab === "chat" && (
                            <div className="p-3 text-[11px] text-[#849495] font-mono">
                              Chat panel — send messages to the agent
                            </div>
                          )}
                          {panelTab === "skills" && (
                            <div className="p-3 text-[11px] text-[#849495] font-mono">
                              Skills marketplace
                            </div>
                          )}
                          {panelTab === "mcp" && (
                            <div className="p-3 text-[11px] text-[#849495] font-mono">
                              MCP connectors
                            </div>
                          )}
                        </Suspense>
                      </div>
                    </div>
                  </Allotment.Pane>
                )}
              </Allotment>
            </Allotment.Pane>

            {/* Right — Agent Sidebar */}
            {rightPanelVisible && (
              <Allotment.Pane preferredSize={320} minSize={250} maxSize={500}>
                <Suspense
                  fallback={
                    <div className="h-full flex items-center justify-center text-[11px] text-[#4A5568]">
                      loading agent...
                    </div>
                  }
                >
                  <RightAgentPanel />
                </Suspense>
              </Allotment.Pane>
            )}
          </Allotment>
        </div>

        {/* ── Status Bar ── */}
        <div className="h-[22px] bg-[rgba(0,229,255,0.06)] border-t border-[rgba(0,229,255,0.12)] flex items-center px-2 text-[10px] text-[#E0E7FF] select-none shrink-0 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#00E5FF]" />
            <span className="text-[#4A5568]">Ready</span>
            <span className="text-[#4A5568]">|</span>
            <span className="text-[#4A5568]">Ollama</span>
          </div>
          <div className="mx-auto flex items-center gap-3">
            <span className="text-[#4A5568]">{activeTab?.filePath ?? "no file"}</span>
            <span className="text-[#4A5568]">Ln 1, Col 1</span>
            <span className="text-[#4A5568]">UTF-8</span>
            <span className="text-[#4A5568]">{activeTab?.language ?? "text"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#4A5568]">0 pending changes</span>
          </div>
        </div>
      </div>
    </InlineAgentManager>
  );
};

export default IDELayout;
