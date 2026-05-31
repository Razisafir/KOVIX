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
const RightAgentPanel = lazy(() => import("./components/RightAgentPanel"));
const SettingsPanel = lazy(() => import("./components/SettingsPanel"));

const C = {
  base: "#0c0e11",
  s1: "#141619",
  s2: "#1e2023",
  border: "rgba(0, 229, 255, 0.12)",
  borderActive: "rgba(0, 229, 255, 0.25)",
  t2: "#849495",
  accent: "#00e5ff",
  accentGlow: "rgba(0, 229, 255, 0.15)",
  gold: "#e9c349",
};

/* ─── Splash Screen Component ─── */
function SplashScreen({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<string>("initializing...");
  const [dots, setDots] = useState("");
  const [progress, setProgress] = useState(20);

  // Animate loading dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  // Slowly increase progress
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((p) => Math.min(p + 5, 80));
    }, 800);
    return () => clearInterval(timer);
  }, []);

  // Backend health check
  useEffect(() => {
    let cancelled = false;
    const checkBackend = async () => {
      setStatus("checking backend");
      try {
        const ports = [8000, 25147, 8080];

        if (typeof window !== "undefined" && (window as any).__TAURI__) {
          try {
            const { invoke } = (window as any).__TAURI__.core || (window as any).__TAURI__;
            if (invoke) {
              const { listen } = (window as any).__TAURI__.event || (window as any).__TAURI__;
              if (listen) {
                const unlisten = await listen("backend:ready", (event: any) => {
                  const port = event.payload;
                  if (typeof port === "number") {
                    ports.unshift(port);
                  }
                });
                setTimeout(() => unlisten(), 5000);
              }
            }
          } catch {
            // Tauri API not available
          }
        }

        for (let i = 0; i < 10; i++) {
          if (cancelled) return;
          for (const port of ports) {
            try {
              const res = await fetch(`http://127.0.0.1:${port}/health`, {
                method: "GET",
                signal: AbortSignal.timeout(2000),
              });
              if (res.ok) {
                setProgress(100);
                setStatus("ready");
                setTimeout(() => {
                  if (!cancelled) onReady();
                }, 400);
                return;
              }
            } catch {
              // Backend not ready yet
            }
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!cancelled) {
          setStatus("proceeding offline");
          setProgress(100);
          setTimeout(() => onReady(), 600);
        }
      } catch {
        if (!cancelled) {
          setStatus("proceeding offline");
          setProgress(100);
          setTimeout(() => onReady(), 600);
        }
      }
    };
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
        fontFamily: '"Inter", "system-ui", sans-serif',
        gap: "24px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient glow */}
      <div style={{
        position: "absolute",
        top: "30%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 600,
        height: 600,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(0, 229, 255, 0.06) 0%, transparent 70%)",
        filter: "blur(80px)",
        pointerEvents: "none",
      }} />

      {/* Logo Mark — Glowing */}
      <div
        className="luminous-border"
        style={{
          width: "56px",
          height: "56px",
          backgroundColor: "rgba(15, 23, 42, 0.8)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(0, 229, 255, 0.2)",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 20px rgba(0, 229, 255, 0.15)",
        }}
      >
        <svg
          width="28"
          height="28"
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
      <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
        <div
          style={{
            fontSize: "16px",
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "#e2e2e6",
            textTransform: "uppercase" as const,
            fontFamily: '"Inter", "system-ui", sans-serif',
          }}
        >
          CONSTRUCT
        </div>
        <div
          style={{
            fontSize: "11px",
            color: "#849495",
            marginTop: "6px",
            letterSpacing: "0.04em",
            fontFamily: '"Inter", "system-ui", sans-serif',
          }}
        >
          AI coding agent that never forgets
        </div>
      </div>

      {/* Status */}
      <div
        style={{
          fontSize: "10px",
          color: C.accent,
          letterSpacing: "0.08em",
          textTransform: "uppercase" as const,
          minHeight: "16px",
          fontFamily: '"JetBrains Mono", monospace',
          textShadow: "0 0 10px rgba(0, 229, 255, 0.3)",
        }}
      >
        {status}
        {dots}
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: "160px",
          height: "2px",
          backgroundColor: "rgba(255,255,255,0.04)",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${C.accent}, rgba(0, 229, 255, 0.6))`,
            borderRadius: 1,
            boxShadow: "0 0 8px rgba(0, 229, 255, 0.4)",
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
  const rightPanelVisible = useAppStore((s) => s.rightPanelVisible);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);

  // ── App flow state ──
  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── Settings panel state ──
  const [showSettings, setShowSettings] = useState(false);

  // ── Command Palette ──
  const { isOpen: showCommandPalette, open: openCommandPalette, close: closeCommandPalette } = useCommandPalette();

  // ── Register default commands on mount ──
  useEffect(() => {
    registerDefaultCommands();
  }, []);

  // ── Listen for settings open event ──
  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener("construct:open-settings", handler);
    return () => window.removeEventListener("construct:open-settings", handler);
  }, []);

  const openSettings = useCallback(() => setShowSettings(true), []);
  useSettingsShortcut(openSettings);

  // ── Splash dismissal ──
  const handleSplashReady = useCallback(() => {
    setShowSplash(false);
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
    newFile: () => { console.log("[shortcut] new file"); },
    openFile: () => { console.log("[shortcut] open file"); },
    save: () => { console.log("[shortcut] save"); },
    saveAll: () => { console.log("[shortcut] save all"); },
    closeTab: () => { console.log("[shortcut] close tab"); },
    undo: () => { console.log("[shortcut] undo"); },
    redo: () => { console.log("[shortcut] redo"); },
    find: () => { console.log("[shortcut] find"); },
    replace: () => { console.log("[shortcut] replace"); },
    goToLine: () => { console.log("[shortcut] go to line"); },
    toggleSidebar: () => { toggleSidebar(); },
    toggleAgentPanel: () => { toggleRightPanel(); },
    toggleMemoryPanel: () => {
      const store = useAppStore.getState();
      if (!store.rightPanelVisible) store.toggleRightPanel();
      store.setRightPanelTab("memory");
    },
    toggleTerminal: () => { togglePanel(); },
    fullscreen: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    },
    commandPalette: () => { openCommandPalette(); },
    runCurrentFile: () => { console.log("[shortcut] run current file"); },
  });

  useKeyboardShortcuts(shortcuts, true);

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
        fontFamily: '"Inter", "system-ui", sans-serif',
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Ambient glow effects */}
      <div className="ambient-glow" style={{ top: "20%", right: "10%" }} />
      <div className="ambient-glow-gold" style={{ bottom: "20%", left: "30%" }} />

      {/* Title Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 36,
          padding: "0 12px",
          backgroundColor: "rgba(20, 22, 25, 0.8)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
          userSelect: "none",
          position: "relative",
          zIndex: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: C.accent,
            textTransform: "uppercase" as const,
            fontFamily: '"Inter", "system-ui", sans-serif',
            textShadow: "0 0 10px rgba(0, 229, 255, 0.3)",
          }}
        >
          CONSTRUCT
        </span>

        {/* Command Palette Trigger */}
        <button
          onClick={openCommandPalette}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: 16,
            height: 24,
            padding: "0 10px",
            backgroundColor: "rgba(15, 23, 42, 0.4)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: '"Inter", "system-ui", sans-serif',
            fontSize: 11,
            color: "#849495",
            outline: "none",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = C.borderActive;
            (e.currentTarget as HTMLElement).style.color = "#b9caca";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = C.border;
            (e.currentTarget as HTMLElement).style.color = "#849495";
          }}
        >
          <Command size={12} />
          <span>Command Palette</span>
          <kbd
            style={{
              fontSize: 9,
              padding: "1px 4px",
              backgroundColor: "rgba(12, 14, 17, 0.6)",
              borderRadius: 3,
              border: `1px solid ${C.border}`,
              fontFamily: '"JetBrains Mono", monospace',
              color: "#3a494a",
            }}
          >
            Ctrl+Shift+P
          </kbd>
        </button>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "#849495", fontFamily: '"JetBrains Mono", monospace' }}>v0.1.0-beta</span>
      </div>

      {/* Main Layout — 3 columns */}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Left Sidebar */}
        {sidebarVisible && (
          <aside
            style={{
              width: 260,
              flexShrink: 0,
              display: "flex",
              borderRight: `1px solid ${C.border}`,
              overflow: "hidden",
            }}
          >
            <Sidebar />
          </aside>
        )}

        {/* Center — Editor + Terminal */}
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
                    color: "#849495",
                  }}
                >
                  loading...
                </div>
              }
            >
              <Editor />
            </Suspense>
          </div>

          {/* Bottom Panel — Terminal only */}
          {panelVisible && (
            <div
              style={{
                height: 200,
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
                      color: "#849495",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    loading terminal...
                  </div>
                }
              >
                <Panel />
              </Suspense>
            </div>
          )}
        </main>

        {/* Right Agent Panel */}
        {rightPanelVisible && (
          <Suspense
            fallback={
              <div
                style={{
                  width: 380,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#849495",
                  fontSize: 11,
                }}
              >
                loading agent...
              </div>
            }
          >
            <RightAgentPanel />
          </Suspense>
        )}
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
