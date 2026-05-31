import React, { useRef, useEffect, useState } from "react";

export const TerminalPanel: React.FC = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [xtermLoaded, setXtermLoaded] = useState(false);

  // Dynamically import xterm to handle SSR / missing dependency gracefully
  useEffect(() => {
    let term: any = null;
    let fitAddon: any = null;
    let unlistenFn: (() => void) | null = null;

    const initTerminal = async () => {
      if (!terminalRef.current) return;

      try {
        // Dynamic imports so the app doesn't crash if xterm isn't available
        const { Terminal } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");
        const { WebLinksAddon } = await import("@xterm/addon-web-links");

        // Import xterm CSS (dynamic — may not resolve as a module)
        try { await import("@xterm/xterm/css/xterm.css"); } catch { /* CSS imported via style tag */ }

        term = new Terminal({
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12,
          lineHeight: 1.2,
          cursorBlink: true,
          cursorStyle: "block",
          theme: {
            background: "#0A0E1A",
            foreground: "#E0E7FF",
            cursor: "#00E5FF",
            selectionBackground: "#00E5FF44",
            selectionForeground: "#0A0E1A",
            black: "#0A0E1A",
            red: "#FF4444",
            green: "#00E5FF",
            yellow: "#FFD700",
            blue: "#4A90D9",
            magenta: "#FF00FF",
            cyan: "#00E5FF",
            white: "#E0E7FF",
            brightBlack: "#4A5568",
            brightRed: "#FF6B6B",
            brightGreen: "#00FFFF",
            brightYellow: "#FFE66D",
            brightBlue: "#6BB5FF",
            brightMagenta: "#FF6BFF",
            brightCyan: "#6BFFFF",
            brightWhite: "#FFFFFF",
          },
          scrollback: 10000,
          convertEol: true,
          allowProposedApi: true,
        });

        fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        term.open(terminalRef.current);
        fitAddon.fit();

        setXtermLoaded(true);

        // Try to connect to Tauri PTY backend
        const isTauri =
          typeof window !== "undefined" &&
          ((window as any).__TAURI__ !== undefined);

        if (isTauri) {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const { listen } = await import("@tauri-apps/api/event");

            // Spawn PTY via Rust backend
            await invoke("spawn_terminal", {
              cols: term.cols,
              rows: term.rows,
            });

            // Listen for output from Rust
            const unlisten = await listen<string>("terminal:data", (event) => {
              term.write(event.payload);
            });
            unlistenFn = unlisten;

            // Send input to Rust
            term.onData((data: string) => {
              invoke("terminal_input", { data });
            });

            // Handle resize
            term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
              invoke("terminal_resize", { cols, rows });
            });
          } catch (err) {
            term.writeln(
              `\x1b[31mPTY connection failed: ${err}\x1b[0m`
            );
            term.writeln(
              "\x1b[33mRunning in local echo mode. Commands won't execute.\x1b[0m"
            );
            // Local echo fallback
            term.onData((data: string) => {
              if (data === "\r") {
                term.writeln("");
              } else if (data === "\u007F") {
                term.write("\b \b");
              } else {
                term.write(data);
              }
            });
          }
        } else {
          // Not running in Tauri — local echo mode for dev
          term.writeln(
            "\x1b[33mRunning outside Tauri. Terminal is in local-echo mode.\x1b[0m"
          );
          term.onData((data: string) => {
            if (data === "\r") {
              term.writeln("");
            } else if (data === "\u007F") {
              term.write("\b \b");
            } else {
              term.write(data);
            }
          });
        }

        setIsReady(true);
      } catch (err) {
        // xterm failed to load — show fallback terminal
        console.warn("xterm.js failed to load:", err);
        setIsReady(true);
      }
    };

    initTerminal();

    // Handle resize
    const handleResize = () => {
      if (fitAddon) {
        try {
          fitAddon.fit();
        } catch {
          // ignore resize errors
        }
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      unlistenFn?.();
      term?.dispose();
    };
  }, []);

  // Welcome message for fallback mode (when xterm didn't load)
  if (!xtermLoaded && isReady) {
    return (
      <div className="h-full w-full bg-[#0A0E1A] p-2 font-mono text-[11px] text-[#849495] leading-[18px]">
        <div className="text-[#00E5FF]">$ construct --version</div>
        <div>0.1.0-alpha</div>
        <div className="mt-1 text-[#00E5FF]">$ npm run dev</div>
        <div className="text-[#4EC9B0]">vite v6.0 ready in 342ms</div>
        <div className="text-[#00E5FF]">local: http://localhost:5173/</div>
        <div className="mt-1 text-[#00E5FF]">$ cargo tauri dev</div>
        <div>Running ConstructApp...</div>
        <div className="mt-2 text-[#FFD700]">
          xterm.js not loaded. Install @xterm/xterm for real terminal.
        </div>
        <div className="text-[#00E5FF]">_</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full p-[2px] bg-[#0A0E1A]">
      <div
        ref={terminalRef}
        className="h-full w-full"
        style={{ minHeight: 100 }}
      />
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[#4A5568] font-mono">
          initializing terminal...
        </div>
      )}
    </div>
  );
};

export default TerminalPanel;
