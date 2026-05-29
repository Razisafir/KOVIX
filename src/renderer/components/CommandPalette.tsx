import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  FileCode,
  Settings,
  Zap,
  GitBranch,
  FolderOpen,
  Save,
  SquareTerminal,
  X,
  Command,
  Keyboard,
} from "lucide-react";

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

/* ─────────────────────── types ─────────────────────── */

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
  commands?: PaletteCommand[];
  onCommandSelect?: (cmd: PaletteCommand) => void;
}

/* ─────────────────────── default commands ─────────────────────── */

function getDefaultCommands(): PaletteCommand[] {
  return [
    {
      id: "new-file",
      label: "New File",
      shortcut: "Ctrl+N",
      icon: <FileCode size={13} />,
      category: "File",
      action: () => {},
    },
    {
      id: "open-file",
      label: "Open File",
      shortcut: "Ctrl+O",
      icon: <FolderOpen size={13} />,
      category: "File",
      action: () => {},
    },
    {
      id: "save-file",
      label: "Save",
      shortcut: "Ctrl+S",
      icon: <Save size={13} />,
      category: "File",
      action: () => {},
    },
    {
      id: "toggle-sidebar",
      label: "Toggle Sidebar",
      shortcut: "Ctrl+B",
      icon: <SquareTerminal size={13} />,
      category: "View",
      action: () => {},
    },
    {
      id: "toggle-terminal",
      label: "Toggle Terminal Panel",
      shortcut: "Ctrl+Shift+T",
      icon: <SquareTerminal size={13} />,
      category: "View",
      action: () => {},
    },
    {
      id: "run-code",
      label: "Run Current File",
      shortcut: "F5",
      icon: <Zap size={13} />,
      category: "Action",
      action: () => {},
    },
    {
      id: "open-settings",
      label: "Open Settings",
      shortcut: "Ctrl+,",
      icon: <Settings size={13} />,
      category: "Config",
      action: () => {},
    },
    {
      id: "git-status",
      label: "Git Status",
      icon: <GitBranch size={13} />,
      category: "Git",
      action: () => {},
    },
    {
      id: "keyboard-shortcuts",
      label: "Keyboard Shortcuts",
      icon: <Keyboard size={13} />,
      category: "Config",
      action: () => {},
    },
  ];
}

/* ─────────────────────── component ─────────────────────── */

function CommandPalette({
  isOpen,
  onClose,
  commands,
  onCommandSelect,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const allCommands = useMemo(
    () => commands ?? getDefaultCommands(),
    [commands]
  );

  // Filter and sort commands
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [query, allCommands]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, PaletteCommand[]>();
    filteredCommands.forEach((cmd) => {
      const list = map.get(cmd.category) ?? [];
      list.push(cmd);
      map.set(cmd.category, list);
    });
    return map;
  }, [filteredCommands]);

  const flatList = useMemo(() => {
    const result: (PaletteCommand | { type: "header"; category: string })[] =
      [];
    grouped.forEach((cmds, category) => {
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

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
          handleSelect(item);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [flatList, selectedIndex, onClose]
  );

  const handleSelect = useCallback(
    (cmd: PaletteCommand) => {
      onCommandSelect?.(cmd);
      cmd.action();
      onClose();
    },
    [onCommandSelect, onClose]
  );

  // Scroll selected into view
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        fontFamily: ff,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 600,
          maxWidth: "90vw",
          backgroundColor: C.s1,
          border: `1px solid ${C.border}`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "60vh",
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <Command size={14} style={{ color: C.accent, flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: ff,
              fontSize: 12,
              color: C.t1,
              caretColor: C.accent,
            }}
          />
          <button
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 18,
              height: 18,
              border: "none",
              background: "transparent",
              color: C.t4,
              cursor: "pointer",
            }}
          >
            <X size={12} />
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
                padding: "16px",
                textAlign: "center",
                fontSize: 11,
                color: C.t3,
              }}
            >
              No commands found
            </div>
          )}

          {flatList.map((item, i) => {
            if ("type" in item) {
              // Category header
              return (
                <div
                  key={`hdr-${item.category}`}
                  style={{
                    padding: "4px 12px",
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: C.t4,
                    backgroundColor: C.base,
                    borderBottom: `1px solid ${C.border}`,
                    position: "sticky",
                    top: 0,
                  }}
                >
                  {item.category}
                </div>
              );
            }

            // Command item
            cmdIndex++;
            const isSelected = i === selectedIndex;
            const actualCmdIndex = i;

            return (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[actualCmdIndex] = el;
                }}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIndex(actualCmdIndex)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  height: 30,
                  padding: "0 12px",
                  border: "none",
                  borderBottom: `1px solid ${C.border}`,
                  backgroundColor: isSelected ? C.s2 : "transparent",
                  color: isSelected ? C.t1 : C.t2,
                  cursor: "pointer",
                  fontFamily: ff,
                  fontSize: 11,
                  textAlign: "left",
                  outline: "none",
                  transition: "background-color 30ms",
                }}
              >
                <span
                  style={{
                    color: isSelected ? C.accent : C.t4,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {item.icon}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && (
                  <kbd
                    style={{
                      fontSize: 9,
                      color: C.t4,
                      backgroundColor: C.s1,
                      border: `1px solid ${C.border}`,
                      padding: "1px 4px",
                      fontFamily: ff,
                    }}
                  >
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: "4px 12px",
            borderTop: `1px solid ${C.border}`,
            fontSize: 9,
            color: C.t4,
            flexShrink: 0,
          }}
        >
          <span>▲ ▼ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
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
