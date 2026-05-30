import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import { Command } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import OnboardingModal from "./components/OnboardingModal";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import type { PaletteCommand } from "./components/CommandPalette";
import {
  useKeyboardShortcuts,
  createConstructShortcuts,
} from "./hooks/useKeyboardShortcuts";
import { useCommandPalette } from "./hooks/useCommandPalette";
import { registerDefaultCommands } from "./commands/defaultCommands";
import useAppStore from "./stores/useAppStore";

const Editor = lazy(() => import("./components/Editor"));
const Panel = lazy(() => import("./components/Panel"));
const SettingsPanel = lazy(() => import("./components/SettingsPanel"));

const C = {
  base: "#0c0c10",
  s1: "#12121a",
  border: "rgba(255,255,255,0.04)",
  t2: "#94949c",
  accent: "#6366f1",
};

/* ─── Splash Screen Component ─── */
function SplashScreen({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<string>("initializing...");
  const [dots, setDots] = useState("");

  // Animate loading dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  // Backend health check
  useEffect(() => {
    let cancelled = false;
    const checkBackend = async () => {
      setStatus("checking backend");
      try {
        // Try health endpoint up to 10 times with 500ms delay
        for (let i = 0; i < 10; i++) {
          if (cancelled) return;
          try {
            const res = await fetch("http://localhost:25147/health", {
              method: "GET",
              signal: AbortSignal.timeout(2000),
            });
            if (res.ok) {
              setStatus("ready");
              setTimeout(() => {
                if (!cancelled) onReady();
              }, 400);
              return;
            }
          } catch {
            // Backend not ready yet
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        // Timeout: proceed anyway after max retries
        if (!cancelled) {
          setStatus("proceeding offline");
          setTimeout(() => onReady(), 600);
        }
      } catch {
        if (!cancelled) {
          setStatus("proceeding offline");
          setTimeout(() => onReady(), 600);
        }
      }
    };
    // Small delay before starting health check to let window render
    const timer = setTimeout(checkBackend, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [onReady]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        backgroundColor: C.base,
        fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
        gap: "24px",
      }}
    >
      {/* Logo Mark */}
      <div
        style={{
          width: "48px",
          height: "48px",
          backgroundColor: C.s1,
          border: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="2"
            y="2"
            width="20"
            height="20"
            stroke={C.accent}
            strokeWidth="1.5"
            fill="none"
          />
          <line x1="2" y1="8" x2="22" y2="8" stroke={C.accent} strokeWidth="1" />
          <line x1="8" y1="8" x2="8" y2="22" stroke={C.accent} strokeWidth="1" />
        </svg>
      </div>

      {/* Title */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: "14px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "#e8e8ec",
            textTransform: "uppercase" as const,
          }}
        >
          CONSTRUCT
        </div>
        <div
          style={{
            fontSize: "10px",
            color: "#6b6b73",
            marginTop: "4px",
            letterSpacing: "0.04em",
          }}
        >
          AI coding agent that never forgets
        </div>
      </div>

      {/* Status */}
      <div
        style={{
          fontSize: "10px",
          color: C.t2,
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          minHeight: "16px",
        }}
      >
        {status}
        {dots}
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: "120px",
          height: "2px",
          backgroundColor: "rgba(255,255,255,0.04)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: status === "ready" ? "100%" : "40%",
            height: "100%",
            backgroundColor: C.accent,
            opacity: 0.6,
            transition: "width 300ms ease",
          }}
        />
      </div>
    </div>
  );
}

/* ─── Settings hook ─── */
function useSettingsShortcut(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key === ",") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}

/* ─── App Root ─── */
function AppRoot() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const panelVisible = useAppStore((s) => s.panelVisible);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);

  // ── App flow state ──
  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── Settings panel state ──
  const [showSettings, setShowSettings] = useState(false);

  // ── Command Palette (using new hook) ──
  const { isOpen: showCommandPalette, open: openCommandPalette, close: closeCommandPalette } = useCommandPalette();

  // ── Register default commands on mount ──
  useEffect(() => {
    registerDefaultCommands();
  }, []);

  // ── Listen for settings open event from command palette ──
  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener("construct:open-settings", handler);
    return () => window.removeEventListener("construct:open-settings", handler);
  }, []);

  const openSettings = useCallback(() => setShowSettings(true), []);

  // ── Settings keyboard shortcut (Ctrl+, / Cmd+,) ──
  useSettingsShortcut(openSettings);

  // ── Splash dismissal handler ──
  const handleSplashReady = useCallback(() => {
    setShowSplash(false);
    // Check if onboarding is needed
    const completed =
      onboardingComplete ||
      localStorage.getItem("construct_onboarding_complete") === "true";
    if (!completed) {
      setShowOnboarding(true);
    }
  }, [onboardingComplete]);

  // ── Onboarding completion ──
  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true);
    setShowOnboarding(false);
  }, [setOnboardingComplete]);

  // ── Keyboard shortcuts ──
  const shortcuts = createConstructShortcuts({
    // File
    newFile: () => {
      console.log("[shortcut] new file");
    },
    openFile: () => {
      console.log("[shortcut] open file");
    },
    save: () => {
      console.log("[shortcut] save");
    },
    saveAll: () => {
      console.log("[shortcut] save all");
    },
    closeTab: () => {
      console.log("[shortcut] close tab");
    },

    // Edit
    undo: () => {
      console.log("[shortcut] undo");
    },
    redo: () => {
      console.log("[shortcut] redo");
    },
    find: () => {
      console.log("[shortcut] find");
    },
    replace: () => {
      console.log("[shortcut] replace");
    },
    goToLine: () => {
      console.log("[shortcut] go to line");
    },

    // View
    toggleSidebar: () => {
      toggleSidebar();
    },
    toggleAgentPanel: () => {
      const store = useAppStore.getState();
      if (!store.panelVisible) store.togglePanel();
      window.dispatchEvent(new CustomEvent("construct:panel-tab", { detail: { tab: "agent" } }));
    },
    toggleMemoryPanel: () => {
      const store = useAppStore.getState();
      if (!store.panelVisible) store.togglePanel();
      window.dispatchEvent(new CustomEvent("construct:panel-tab", { detail: { tab: "memory" } }));
    },
    toggleTerminal: () => {
      togglePanel();
    },
    fullscreen: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    },

    // Agent / Action
    commandPalette: () => {
      openCommandPalette();
    },
    runCurrentFile: () => {
      console.log("[shortcut] run current file");
    },
  });

  useKeyboardShortcuts(shortcuts, true);

  // ── Command palette handler (backward compat logging) ──
  const handleCommandSelect = useCallback(
    (cmd: PaletteCommand) => {
      console.log(`[command palette] selected: ${cmd.id} — ${cmd.label}`);
    },
    []
  );

  // ── Splash Screen ──
  if (showSplash) {
    return <SplashScreen onReady={handleSplashReady} />;
  }

  // ── Onboarding Wizard ──
  if (showOnboarding) {
    return <OnboardingModal onComplete={handleOnboardingComplete} />;
  }

  // ── Main App ──
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100vw",
        height: "100vh",
        backgroundColor: C.base,
        fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
        overflow: "hidden",
      }}
    >
      {/* Title Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 28,
          padding: "0 12px",
          backgroundColor: C.s1,
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: C.t2,
            textTransform: "uppercase" as const,
          }}
        >
          Construct
        </span>

        {/* Command Palette Trigger */}
        <button
          onClick={openCommandPalette}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: 16,
            height: 20,
            padding: "0 8px",
            backgroundColor: C.s1,
            border: `1px solid ${C.border}`,
            borderRadius: 3,
            cursor: "pointer",
            fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
            fontSize: 10,
            color: "#6b6b73",
            outline: "none",
            transition: "background-color 0.1s, color 0.1s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "#1a1a24";
            (e.currentTarget as HTMLElement).style.color = "#94949c";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = C.s1;
            (e.currentTarget as HTMLElement).style.color = "#6b6b73";
          }}
        >
          <Command size={11} />
          <span>Command Palette</span>
          <kbd
            style={{
              fontSize: 8,
              padding: "1px 4px",
              backgroundColor: "#0c0c10",
              borderRadius: 2,
              border: "1px solid rgba(255,255,255,0.04)",
              fontFamily: '"Geist Mono", "JetBrains Mono", monospace',
              color: "#4a4a52",
            }}
          >
            Ctrl+Shift+P
          </kbd>
        </button>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "#6b6b73" }}>v0.1.0-beta</span>
      </div>

      {/* Main Layout */}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Sidebar */}
        {sidebarVisible && (
          <aside
            style={{
              width: 280,
              flexShrink: 0,
              display: "flex",
              borderRight: `1px solid ${C.border}`,
              overflow: "hidden",
            }}
          >
            <Sidebar />
          </aside>
        )}

        {/* Center - Editor + Panel */}
        <main
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
          }}
        >
          <div style={{ flex: 1, minHeight: 0 }}>
            <Suspense
              fallback={
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    padding: 16,
                    fontSize: 11,
                    color: "#6b6b73",
                  }}
                >
                  loading...
                </div>
              }
            >
              <Editor />
            </Suspense>
          </div>

          {/* Bottom Panel */}
          {panelVisible && (
            <div
              style={{
                height: 240,
                flexShrink: 0,
                borderTop: `1px solid ${C.border}`,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Suspense
                fallback={
                  <div
                    style={{
                      padding: 8,
                      fontSize: 10,
                      color: "#6b6b73",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    loading panel...
                  </div>
                }
              >
                <Panel />
              </Suspense>
            </div>
          )}
        </main>
      </div>

      <StatusBar />

      {/* ── Command Palette ── */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={closeCommandPalette}
        onCommandSelect={handleCommandSelect}
      />

      {/* ── Settings Panel ── */}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel />
        </Suspense>
      )}
    </div>
  );
}

/* ─── Exported App with Error Boundary ─── */
export default function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}
