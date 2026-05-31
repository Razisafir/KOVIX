import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import OnboardingModal from "./components/OnboardingModal";
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

const IDELayout = lazy(() => import("./components/IDELayout"));
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

      {/* Logo Mark */}
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
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="20" height="20" stroke={C.accent} strokeWidth="1.5" fill="none" />
          <line x1="2" y1="8" x2="22" y2="8" stroke={C.accent} strokeWidth="1" />
          <line x1="8" y1="8" x2="8" y2="22" stroke={C.accent} strokeWidth="1" />
        </svg>
      </div>

      {/* Title */}
      <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.1em", color: "#e2e2e6", textTransform: "uppercase", fontFamily: '"Inter", "system-ui", sans-serif' }}>
          CONSTRUCT
        </div>
        <div style={{ fontSize: 11, color: "#849495", marginTop: 6, letterSpacing: "0.04em", fontFamily: '"Inter", "system-ui", sans-serif' }}>
          AI coding agent that never forgets
        </div>
      </div>

      {/* Status */}
      <div style={{ fontSize: 10, color: C.accent, letterSpacing: "0.08em", textTransform: "uppercase", minHeight: 16, fontFamily: '"JetBrains Mono", monospace', textShadow: "0 0 10px rgba(0, 229, 255, 0.3)" }}>
        {status}{dots}
      </div>

      {/* Progress Bar */}
      <div style={{ width: 160, height: 2, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 1, overflow: "hidden" }}>
        <div style={{ width: `${progress}%`, height: "100%", background: `linear-gradient(90deg, ${C.accent}, rgba(0, 229, 255, 0.6))`, borderRadius: 1, boxShadow: "0 0 8px rgba(0, 229, 255, 0.4)", transition: "width 300ms ease" }} />
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
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);

  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { isOpen: showCommandPalette, open: openCommandPalette, close: closeCommandPalette } = useCommandPalette();

  useEffect(() => { registerDefaultCommands(); }, []);

  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener("construct:open-settings", handler);
    return () => window.removeEventListener("construct:open-settings", handler);
  }, []);

  const openSettings = useCallback(() => setShowSettings(true), []);
  useSettingsShortcut(openSettings);

  const handleSplashReady = useCallback(() => {
    setShowSplash(false);
    const completed = onboardingComplete || localStorage.getItem("construct_onboarding_complete") === "true";
    if (!completed) setShowOnboarding(true);
  }, [onboardingComplete]);

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true);
    setShowOnboarding(false);
  }, [setOnboardingComplete]);

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
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    },
    commandPalette: () => { openCommandPalette(); },
    runCurrentFile: () => { console.log("[shortcut] run current file"); },
  });

  useKeyboardShortcuts(shortcuts, true);

  const handleCommandSelect = useCallback((cmd: PaletteCommand) => {
    console.log(`[command palette] selected: ${cmd.id} \u2014 ${cmd.label}`);
  }, []);

  if (showSplash) {
    return <SplashScreen onReady={handleSplashReady} />;
  }

  if (showOnboarding) {
    return <OnboardingModal onComplete={handleOnboardingComplete} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh", backgroundColor: "#0A0E1A", fontFamily: '"Inter", "system-ui", sans-serif', overflow: "hidden", position: "relative" }}>
      {/* Main IDE Layout — Monaco + Allotment + xterm */}
      <Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#4A5568", fontSize: 11 }}>loading IDE...</div>}>
        <IDELayout />
      </Suspense>

      {/* Status Bar */}
      <StatusBar />

      {/* Command Palette */}
      <CommandPalette isOpen={showCommandPalette} onClose={closeCommandPalette} onCommandSelect={handleCommandSelect} />

      {/* Settings */}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}
