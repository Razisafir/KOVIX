import { registry } from "./registry";
import useAppStore from "../stores/useAppStore";
import type { AgentMode } from "../components/AgentModeSelector";

/**
 * Register all default application commands.
 * Called once on app mount.
 */
export function registerDefaultCommands() {
  // ── Agent Mode Commands ──────────────────────────────────────
  const modeConfigs: { id: AgentMode; title: string; description: string; icon: string; keywords: string[] }[] = [
    {
      id: "code",
      title: "Switch to Code Mode",
      description: "General software development mode",
      icon: "code-2",
      keywords: ["code", "develop", "program", "mode", "switch"],
    },
    {
      id: "architect",
      title: "Switch to Architect Mode",
      description: "System design and architecture mode",
      icon: "layout",
      keywords: ["architect", "design", "system", "api", "schema", "mode"],
    },
    {
      id: "debug",
      title: "Switch to Debug Mode",
      description: "Find and fix bugs mode",
      icon: "bug",
      keywords: ["debug", "fix", "bug", "error", "trace", "mode"],
    },
    {
      id: "review",
      title: "Switch to Review Mode",
      description: "Code review and audit mode",
      icon: "eye",
      keywords: ["review", "audit", "check", "inspect", "mode"],
    },
    {
      id: "security",
      title: "Switch to Security Mode",
      description: "Security audit and hardening mode",
      icon: "shield",
      keywords: ["security", "audit", "vulnerability", "scan", "mode"],
    },
    {
      id: "devops",
      title: "Switch to DevOps Mode",
      description: "CI/CD and infrastructure mode",
      icon: "server",
      keywords: ["devops", "deploy", "docker", "pipeline", "infrastructure", "mode"],
    },
  ];

  modeConfigs.forEach((cfg) => {
    registry.register({
      id: `agent.mode.${cfg.id}`,
      title: cfg.title,
      description: cfg.description,
      icon: cfg.icon,
      category: "agent",
      keywords: cfg.keywords,
      action: () => {
        useAppStore.getState().setAgentMode(cfg.id);
      },
    });
  });

  // ── Agent Control Commands ───────────────────────────────────
  registry.register({
    id: "agent.start",
    title: "Start Agent Session",
    description: "Start a new agent session with current mode",
    icon: "play",
    shortcut: "Ctrl+Enter",
    category: "agent",
    keywords: ["start", "run", "agent", "session", "begin"],
    action: () => {
      // Dispatch a custom event that AgentPanel listens to
      window.dispatchEvent(new CustomEvent("construct:agent-action", { detail: { action: "start" } }));
    },
    enabled: () => {
      const status = useAppStore.getState().agentStatus;
      return status === "idle" || status === "completed" || status === "failed" || status === "waiting";
    },
  });

  registry.register({
    id: "agent.stop",
    title: "Stop Agent Session",
    description: "Stop the current agent session",
    icon: "square",
    shortcut: "Ctrl+Shift+C",
    category: "agent",
    keywords: ["stop", "halt", "abort", "cancel", "end"],
    action: () => {
      window.dispatchEvent(new CustomEvent("construct:agent-action", { detail: { action: "stop" } }));
    },
    enabled: () => {
      const status = useAppStore.getState().agentStatus;
      return status === "running" || status === "paused";
    },
  });

  registry.register({
    id: "agent.pause",
    title: "Pause Agent Session",
    description: "Pause the current agent session",
    icon: "pause",
    category: "agent",
    keywords: ["pause", "suspend", "wait", "hold"],
    action: () => {
      window.dispatchEvent(new CustomEvent("construct:agent-action", { detail: { action: "pause" } }));
    },
    enabled: () => {
      return useAppStore.getState().agentStatus === "running";
    },
  });

  registry.register({
    id: "agent.resume",
    title: "Resume Agent Session",
    description: "Resume the paused agent session",
    icon: "play",
    category: "agent",
    keywords: ["resume", "continue", "unpause", "go"],
    action: () => {
      window.dispatchEvent(new CustomEvent("construct:agent-action", { detail: { action: "resume" } }));
    },
    enabled: () => {
      return useAppStore.getState().agentStatus === "paused";
    },
  });

  // ── Navigation Commands ──────────────────────────────────────
  registry.register({
    id: "nav.agent",
    title: "Open Agent Panel",
    description: "Show the agent panel in the bottom panel",
    icon: "bot",
    shortcut: "Ctrl+1",
    category: "navigation",
    keywords: ["chat", "agent", "talk", "conversation", "panel"],
    action: () => {
      const store = useAppStore.getState();
      if (!store.panelVisible) store.togglePanel();
      window.dispatchEvent(new CustomEvent("construct:panel-tab", { detail: { tab: "agent" } }));
    },
  });

  registry.register({
    id: "nav.memory",
    title: "Open Memory Panel",
    description: "Show the memory browser in the bottom panel",
    icon: "brain",
    shortcut: "Ctrl+2",
    category: "navigation",
    keywords: ["memory", "history", "past", "remember", "panel"],
    action: () => {
      const store = useAppStore.getState();
      if (!store.panelVisible) store.togglePanel();
      window.dispatchEvent(new CustomEvent("construct:panel-tab", { detail: { tab: "memory" } }));
    },
  });

  registry.register({
    id: "nav.terminal",
    title: "Open Terminal",
    description: "Show the terminal in the bottom panel",
    icon: "terminal",
    shortcut: "Ctrl+3",
    category: "navigation",
    keywords: ["terminal", "console", "shell", "command", "cli"],
    action: () => {
      const store = useAppStore.getState();
      if (!store.panelVisible) store.togglePanel();
      window.dispatchEvent(new CustomEvent("construct:panel-tab", { detail: { tab: "terminal" } }));
    },
  });

  registry.register({
    id: "nav.files",
    title: "Open File Explorer",
    description: "Show the file tree in the sidebar",
    icon: "files",
    shortcut: "Ctrl+4",
    category: "navigation",
    keywords: ["files", "explorer", "tree", "directory", "project"],
    action: () => {
      const store = useAppStore.getState();
      if (!store.sidebarVisible) store.toggleSidebar();
      store.setActiveSidebarTab("files");
    },
  });

  registry.register({
    id: "nav.skills",
    title: "Open Skill Marketplace",
    description: "Browse and install skills",
    icon: "wrench",
    shortcut: "Ctrl+5",
    category: "navigation",
    keywords: ["skills", "marketplace", "install", "browse"],
    action: () => {
      const store = useAppStore.getState();
      if (!store.panelVisible) store.togglePanel();
      window.dispatchEvent(new CustomEvent("construct:panel-tab", { detail: { tab: "skills" } }));
    },
  });

  registry.register({
    id: "nav.settings",
    title: "Open Settings",
    description: "Open application settings",
    icon: "settings",
    shortcut: "Ctrl+,",
    category: "navigation",
    keywords: ["settings", "config", "preferences", "options"],
    action: () => {
      window.dispatchEvent(new CustomEvent("construct:open-settings"));
    },
  });

  registry.register({
    id: "nav.sidebar",
    title: "Toggle Sidebar",
    description: "Show or hide the sidebar panel",
    icon: "panel-left",
    shortcut: "Ctrl+B",
    category: "navigation",
    keywords: ["sidebar", "toggle", "panel", "left", "show", "hide"],
    action: () => {
      useAppStore.getState().toggleSidebar();
    },
  });

  registry.register({
    id: "nav.bottom-panel",
    title: "Toggle Bottom Panel",
    description: "Show or hide the bottom panel",
    icon: "panel-bottom",
    shortcut: "Ctrl+Shift+T",
    category: "navigation",
    keywords: ["panel", "bottom", "toggle", "terminal", "show", "hide"],
    action: () => {
      useAppStore.getState().togglePanel();
    },
  });

  // ── Tools Commands ───────────────────────────────────────────
  registry.register({
    id: "tools.clear-memory",
    title: "Clear Memory",
    description: "Clear all conversation memory",
    icon: "trash-2",
    category: "tools",
    keywords: ["clear", "delete", "memory", "history", "wipe"],
    action: () => {
      if (confirm("Clear all memory? This cannot be undone.")) {
        useAppStore.getState().setConversations([]);
        useAppStore.getState().addToast({
          type: "info",
          title: "Memory cleared",
          message: "All conversation memory has been cleared",
        });
      }
    },
  });

  registry.register({
    id: "tools.export-session",
    title: "Export Session",
    description: "Export current session data to clipboard",
    icon: "download",
    category: "tools",
    keywords: ["export", "save", "download", "session", "json", "copy"],
    action: () => {
      const store = useAppStore.getState();
      const data = {
        goal: store.agentGoal,
        sessionId: store.agentSessionId,
        status: store.agentStatus,
        events: store.agentEvents,
        mode: store.agentMode,
      };
      navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
        store.addToast({
          type: "success",
          title: "Session exported",
          message: "Session data copied to clipboard",
        });
      }).catch(() => {
        store.addToast({
          type: "error",
          title: "Export failed",
          message: "Could not copy to clipboard",
        });
      });
    },
    enabled: () => !!useAppStore.getState().agentSessionId,
  });

  registry.register({
    id: "tools.mcp-connect",
    title: "Connect MCP Server",
    description: "Add a new MCP server connection",
    icon: "plug",
    category: "tools",
    keywords: ["mcp", "connect", "server", "tool", "protocol"],
    action: () => {
      window.dispatchEvent(new CustomEvent("construct:panel-tab", { detail: { tab: "mcp" } }));
      const store = useAppStore.getState();
      if (!store.panelVisible) store.togglePanel();
    },
  });

  // ── System Commands ──────────────────────────────────────────
  registry.register({
    id: "system.reload",
    title: "Reload Window",
    description: "Reload the application window",
    icon: "refresh-cw",
    shortcut: "Ctrl+R",
    category: "system",
    keywords: ["reload", "refresh", "restart", "window"],
    action: () => {
      window.location.reload();
    },
  });

  registry.register({
    id: "system.toggle-theme",
    title: "Toggle Theme",
    description: "Switch between light and dark theme",
    icon: "moon",
    category: "system",
    keywords: ["theme", "dark", "light", "toggle", "color", "appearance"],
    action: () => {
      const store = useAppStore.getState();
      const next = store.theme === "dark" ? "light" : "dark";
      store.setTheme(next);
      store.addToast({
        type: "info",
        title: "Theme changed",
        message: `Switched to ${next} theme`,
      });
    },
  });

  registry.register({
    id: "system.fullscreen",
    title: "Toggle Fullscreen",
    description: "Enter or exit fullscreen mode",
    icon: "maximize",
    shortcut: "F11",
    category: "system",
    keywords: ["fullscreen", "maximize", "window", "screen"],
    action: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    },
  });
}
