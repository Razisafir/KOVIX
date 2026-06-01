import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

// Detect Tauri runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI__;

// Tauri v2 API helpers
async function getInvoke() {
  if (!isTauri) return null;
  try {
    const { invoke } = (window as any).__TAURI__.core || (window as any).__TAURI__;
    return invoke as (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  } catch {
    return null;
  }
}

async function getListen() {
  if (!isTauri) return null;
  try {
    const { listen } = (window as any).__TAURI__.event || (window as any).__TAURI__;
    return listen as <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
  } catch {
    return null;
  }
}

/**
 * Real terminal panel using xterm.js connected to a PTY via Tauri.
 *
 * Data flow:
 *   Frontend (xterm.js) → invoke('terminal_input', {data}) → Rust PTY stdin
 *   Rust PTY stdout → emit('terminal:data', string) → xterm.js write()
 */
export function TerminalPanel() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const initTerminal = useCallback(async () => {
    if (!terminalRef.current) return;
    // Don't re-init
    if (termInstanceRef.current) return;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      theme: {
        background: "#0c0e11",
        foreground: "#e2e2e6",
        cursor: "#00f5ff",
        cursorAccent: "#0c0e11",
        selectionBackground: "rgba(0, 245, 255, 0.15)",
        black: "#0c0e11",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#00f5ff",
        white: "#e2e2e6",
        brightBlack: "#849495",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#00f5ff",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
      scrollback: 5000,
      convertEol: false,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);

    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initial fit
    try {
      fitAddon.fit();
    } catch {
      // Ignore fit errors on first render
    }

    const cols = term.cols;
    const rows = term.rows;

    // Connect to Tauri PTY backend
    if (isTauri) {
      const invoke = await getInvoke();
      const listenFn = await getListen();

      if (invoke && listenFn) {
        // Listen for PTY output from Rust
        const unlisten = await listenFn<string>("terminal:data", (event) => {
          term.write(event.payload);
        });

        // Send keyboard input to PTY
        term.onData((data) => {
          invoke("terminal_input", { data }).catch((err: unknown) => {
            console.error("[Terminal] Failed to send input:", err);
          });
        });

        // Spawn the PTY shell
        try {
          await invoke("spawn_terminal", { cols, rows });
          term.focus();
        } catch (err) {
          term.writeln(`\r\n\x1b[31mFailed to spawn terminal: ${err}\x1b[0m`);
          console.error("[Terminal] spawn_terminal failed:", err);
        }

        // Handle resize
        const onResize = () => {
          try {
            fitAddon.fit();
            const { cols: newCols, rows: newRows } = term;
            invoke("terminal_resize", { cols: newCols, rows: newRows }).catch(
              (err: unknown) => {
                console.warn("[Terminal] resize failed:", err);
              }
            );
          } catch {
            // Ignore resize errors
          }
        };

        term.onResize(onResize);

        // Also handle window resize
        const resizeObserver = new ResizeObserver(() => {
          onResize();
        });
        resizeObserver.observe(terminalRef.current);

        // Cleanup on unmount
        return () => {
          unlisten();
          resizeObserver.disconnect();
          invoke("kill_terminal").catch(() => {});
          term.dispose();
          termInstanceRef.current = null;
          fitAddonRef.current = null;
        };
      }
    }

    // Fallback: web mode (no Tauri) — show a demo terminal
    term.writeln("\x1b[36mConstruct IDE — Web Mode\x1b[0m");
    term.writeln("\x1b[90mTerminal requires Tauri runtime for PTY support.\x1b[0m");
    term.writeln("\x1b[90mRun 'cargo tauri dev' for a real terminal.\x1b[0m\r\n");
    term.write("\x1b[32m$ \x1b[0m");

    let lineBuffer = "";
    term.onData((data) => {
      if (data === "\r") {
        term.write("\r\n");
        if (lineBuffer.trim()) {
          term.writeln(`\x1b[31mcommand not found: ${lineBuffer}\x1b[0m`);
        }
        term.write("\x1b[32m$ \x1b[0m");
        lineBuffer = "";
      } else if (data === "\x7f") {
        // Backspace
        if (lineBuffer.length > 0) {
          lineBuffer = lineBuffer.slice(0, -1);
          term.write("\b \b");
        }
      } else if (data >= " ") {
        lineBuffer += data;
        term.write(data);
      }
    });

    return () => {
      term.dispose();
      termInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    initTerminal().then((fn) => {
      cleanup = fn || undefined;
    });
    return () => {
      cleanup?.();
    };
  }, [initTerminal]);

  return (
    <div
      ref={terminalRef}
      className="w-full h-full"
      style={{ padding: "4px 4px 0 4px", background: "#0c0e11" }}
    />
  );
}

export default TerminalPanel;
