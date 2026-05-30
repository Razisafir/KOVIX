import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Command as CommandIcon,
  Search,
  Play,
  Square,
  Pause,
  Code2,
  Layout,
  Bug,
  Eye,
  Shield,
  Server,
  MessageSquare,
  Brain,
  FolderTree,
  Settings,
  Trash2,
  Download,
  RefreshCw,
  Moon,
  ArrowRight,
  Keyboard,
  Bot,
  Terminal,
  Files,
  Wrench,
  Plug,
  PanelLeft,
  PanelBottom,
  Maximize,
} from "lucide-react";
import { registry, type Command } from "../commands/registry";

/* ─────────────────────── color system ─────────────────────── */

const C = {
  base: "#0c0c10",
  s1: "#12121a",
  s2: "#1a1a24",
  s3: "#22222e",
  accent: "#6366f1",
  t1: "#e8e8ec",
  t2: "#94949c",
  t3: "#6b6b73",
  t4: "#4a4a52",
  ok: "#10b981",
  wrn: "#f59e0b",
  border: "rgba(255,255,255,0.04)",
};

const ff = '"Geist Mono", "JetBrains Mono", monospace';

/* ─────────────────────── icon mapping ─────────────────────── */

const iconMap: Record<string, React.ReactNode> = {
  command: <CommandIcon size={13} />,
  play: <Play size={13} />,
  square: <Square size={13} />,
  pause: <Pause size={13} />,
  "code-2": <Code2 size={13} />,
  layout: <Layout size={13} />,
  bug: <Bug size={13} />,
  eye: <Eye size={13} />,
  shield: <Shield size={13} />,
  server: <Server size={13} />,
  "message-square": <MessageSquare size={13} />,
  brain: <Brain size={13} />,
  "folder-tree": <FolderTree size={13} />,
  settings: <Settings size={13} />,
  "trash-2": <Trash2 size={13} />,
  download: <Download size={13} />,
  "refresh-cw": <RefreshCw size={13} />,
  moon: <Moon size={13} />,
  bot: <Bot size={13} />,
  terminal: <Terminal size={13} />,
  files: <Files size={13} />,
  wrench: <Wrench size={13} />,
  plug: <Plug size={13} />,
  "panel-left": <PanelLeft size={13} />,
  "panel-bottom": <PanelBottom size={13} />,
  maximize: <Maximize size={13} />,
};

/* ─────────────────────── category styling ─────────────────────── */

const categoryColors: Record<string, string> = {
  agent: "#6366f1",      // Indigo
  navigation: "#10b981",  // Emerald
  tools: "#f59e0b",       // Amber
  system: "#6b6b73",      // Gray
};

const categoryLabels: Record<string, string> = {
  agent: "Agent",
  navigation: "Navigation",
  tools: "Tools",
  system: "System",
};

/* ─────────────────────── exported type for backward compat ─────────────────────── */

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  category: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  /** @deprecated Use the registry instead — commands are now centrally managed */
  commands?: PaletteCommand[];
  /** @deprecated Use registry.subscribe or handleSelect prop instead */
  onCommandSelect?: (cmd: PaletteCommand) => void;
}

/* ─────────────────────── component ─────────────────────── */

function CommandPalette({ isOpen, onClose, onCommandSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allCommands, setAllCommands] = useState<Command[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Subscribe to registry changes
  useEffect(() => {
    if (isOpen) {
      setAllCommands(registry.getAll());
      const unsubscribe = registry.subscribe(() => {
        setAllCommands(registry.getAll());
      });
      return unsubscribe;
    }
  }, [isOpen]);

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands;
    return registry.search(query);
  }, [query, allCommands]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    filteredCommands.forEach((cmd) => {
      const list = map.get(cmd.category) ?? [];
      list.push(cmd);
      map.set(cmd.category, list);
    });
    return map;
  }, [filteredCommands]);

  // Build flat list with category headers
  const flatList = useMemo(() => {
    const result: (Command | { type: "header"; category: string })[] = [];
    const catOrder = ["agent", "navigation", "tools", "system"];
    const sorted = Array.from(grouped.entries()).sort(
      (a, b) => catOrder.indexOf(a[0]) - catOrder.indexOf(b[0])
    );
    sorted.forEach(([category, cmds]) => {
      result.push({ type: "header", category });
      result.push(...cmds);
    });
    return result;
  }, [grouped]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Handle command execution
  const handleSelect = useCallback(
    (cmd: Command) => {
      onCommandSelect?.({
        id: cmd.id,
        label: cmd.title,
        shortcut: cmd.shortcut,
        icon: iconMap[cmd.icon || "command"] ?? <CommandIcon size={13} />,
        category: cmd.category,
        action: cmd.action,
      });
      cmd.action();
      onClose();
    },
    [onCommandSelect, onClose]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          let next = prev + 1;
          while (next < flatList.length && "type" in flatList[next]) next++;
          return next >= flatList.length ? prev : next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          let next = prev - 1;
          while (next >= 0 && "type" in flatList[next]) next--;
          return next < 0 ? prev : next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flatList[selectedIndex];
        if (item && "action" in item) {
          if (item.enabled?.() !== false) {
            handleSelect(item);
          }
        }
      }
    },
    [flatList, selectedIndex, onClose, handleSelect]
  );

  // Scroll selected into view
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  // Count only command items (not headers)
  let cmdIndex = -1;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        backgroundColor: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
        fontFamily: ff,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 640,
          maxWidth: "90vw",
          backgroundColor: C.s1,
          border: `1px solid ${C.border}`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "60vh",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {/* Search bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <Search size={14} style={{ color: C.accent, flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: ff,
              fontSize: 13,
              color: C.t1,
              caretColor: C.accent,
            }}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              border: "none",
              background: C.s2,
              color: C.t4,
              cursor: "pointer",
              borderRadius: 3,
              fontFamily: ff,
              fontSize: 9,
            }}
          >
            ESC
          </button>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflow: "auto",
            scrollbarWidth: "thin",
            scrollbarColor: `${C.s3} transparent`,
          }}
        >
          {flatList.length === 0 && (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                fontSize: 11,
                color: C.t3,
              }}
            >
              <CommandIcon size={24} style={{ color: C.t4, margin: "0 auto 8px", display: "block" }} />
              <div>No commands found</div>
              <div style={{ fontSize: 10, color: C.t4, marginTop: 4 }}>
                Try a different search term
              </div>
            </div>
          )}

          {flatList.map((item, i) => {
            if ("type" in item) {
              // Category header
              return (
                <div
                  key={`hdr-${item.category}`}
                  style={{
                    padding: "4px 14px",
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: categoryColors[item.category] ?? C.t4,
                    backgroundColor: C.base,
                    borderBottom: `1px solid ${C.border}`,
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  {categoryLabels[item.category] ?? item.category}
                </div>
              );
            }

            // Command item
            cmdIndex++;
            const isSelected = i === selectedIndex;
            const isDisabled = item.enabled?.() === false;
            const actualCmdIndex = i;
            const catColor = categoryColors[item.category] ?? C.t4;

            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[actualCmdIndex] = el;
                }}
                onClick={() => {
                  if (!isDisabled) handleSelect(item);
                }}
                onMouseEnter={() => setSelectedIndex(actualCmdIndex)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  height: 36,
                  padding: "0 14px",
                  border: "none",
                  borderBottom: `1px solid ${C.border}`,
                  backgroundColor: isSelected ? C.s2 : "transparent",
                  color: isDisabled ? C.t4 : isSelected ? C.t1 : C.t2,
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  fontFamily: ff,
                  fontSize: 11,
                  textAlign: "left",
                  outline: "none",
                  transition: "background-color 30ms",
                  opacity: isDisabled ? 0.4 : 1,
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    backgroundColor: isSelected ? `${catColor}15` : C.s2,
                    color: isSelected ? catColor : C.t4,
                  }}
                >
                  {iconMap[item.icon || "command"] ?? <CommandIcon size={13} />}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: isSelected ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title}
                    </span>
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: catColor,
                        opacity: 0.7,
                      }}
                    >
                      {categoryLabels[item.category]}
                    </span>
                  </div>
                  {item.description && (
                    <div
                      style={{
                        fontSize: 10,
                        color: C.t3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.description}
                    </div>
                  )}
                </div>

                {/* Shortcut */}
                {item.shortcut && (
                  <kbd
                    style={{
                      fontSize: 9,
                      color: C.t4,
                      backgroundColor: C.base,
                      border: `1px solid ${C.border}`,
                      padding: "1px 5px",
                      fontFamily: ff,
                      borderRadius: 2,
                      flexShrink: 0,
                    }}
                  >
                    {item.shortcut}
                  </kbd>
                )}

                {/* Selected indicator */}
                {isSelected && !isDisabled && (
                  <ArrowRight size={12} style={{ color: C.accent, flexShrink: 0 }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "5px 14px",
            borderTop: `1px solid ${C.border}`,
            fontSize: 9,
            color: C.t4,
            flexShrink: 0,
            backgroundColor: C.base,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Keyboard size={10} />
            {filteredCommands.length} commands
          </span>
          <span>↑↓ navigate</span>
          <span>↵ execute</span>
          <span>ESC close</span>
        </div>
      </div>

      {/* Scrollbar styles */}
      <style>{`
        div::-webkit-scrollbar { width: 4px; }
        div::-webkit-scrollbar-track { background: transparent; }
        div::-webkit-scrollbar-thumb { background: ${C.s3}; border-radius: 2px; }
      `}</style>
    </div>
  );
}

export default CommandPalette;
