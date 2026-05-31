import { create } from "zustand";
import type {
  ConversationMessage,
  ContextItem,
  MemoryTab,
} from "../types/memory";
import type { AgentOutputEvent } from "../types/agent";
import type {
  AutonomousStatus,
  LogEntry,
  QueuedGoal,
} from "../types/autonomous";
import type {
  Toast,
  Skill,
  MCPConnection,
  ScreenAction,
  ScreenSettings,
  AgentRole,
  AgentMessage,
  AgentTask,
  AgentConflict,
} from "../types";

interface CursorPosition {
  line: number;
  column: number;
}

interface AppState {
  // UI Visibility
  sidebarVisible: boolean;
  panelVisible: boolean;
  toggleSidebar: () => void;
  togglePanel: () => void;

  // Panel tab (shared state for command palette + keyboard shortcuts)
  panelTab: string;
  setPanelTab: (tab: string) => void;

  // Right Agent Panel
  rightPanelVisible: boolean;
  toggleRightPanel: () => void;
  rightPanelTab: string;
  setRightPanelTab: (tab: string) => void;

  // Sidebar
  activeSidebarTab: string;
  setActiveSidebarTab: (tab: string) => void;

  // Agent Mode (shared state for Command Palette + AgentPanel)
  agentMode: "code" | "architect" | "debug" | "review" | "security" | "devops";
  setAgentMode: (mode: "code" | "architect" | "debug" | "review" | "security" | "devops") => void;

  // Editor
  editorTheme: "dark" | "light";
  editorFontSize: number;
  editorContent: string;
  cursorPosition: CursorPosition;
  setEditorTheme: (theme: "dark" | "light") => void;
  setEditorFontSize: (size: number) => void;
  setEditorContent: (content: string) => void;
  setCursorPosition: (pos: CursorPosition) => void;

  // Memory Panel
  memoryPanelTab: MemoryTab;
  setMemoryPanelTab: (tab: MemoryTab) => void;
  conversations: ConversationMessage[];
  setConversations: (msgs: ConversationMessage[]) => void;
  addConversation: (msg: ConversationMessage) => void;
  memorySearchQuery: string;
  setMemorySearchQuery: (q: string) => void;
  memorySearchResults: ContextItem[];
  setMemorySearchResults: (results: ContextItem[]) => void;

  // Agent
  agentGoal: string;
  setAgentGoal: (goal: string) => void;
  agentSessionId: string | null;
  setAgentSessionId: (id: string | null) => void;
  agentStatus: "idle" | "running" | "paused" | "completed" | "failed" | "waiting";
  setAgentStatus: (status: "idle" | "running" | "paused" | "completed" | "failed" | "waiting") => void;
  agentEvents: AgentOutputEvent[];
  setAgentEvents: (events: AgentOutputEvent[]) => void;
  addAgentEvent: (event: AgentOutputEvent) => void;

  // Autonomous
  autonomousEnabled: boolean;
  setAutonomousEnabled: (v: boolean) => void;
  autonomousStatus: AutonomousStatus;
  setAutonomousStatus: (s: AutonomousStatus) => void;
  autonomousProgress: number;
  setAutonomousProgress: (p: number) => void;
  autonomousGoals: QueuedGoal[];
  setAutonomousGoals: (g: QueuedGoal[]) => void;
  autonomousLogs: LogEntry[];
  setAutonomousLogs: (l: LogEntry[]) => void;
  addAutonomousLog: (l: LogEntry) => void;

  // Skill Marketplace
  skills: Skill[];
  setSkills: (skills: Skill[]) => void;
  addSkill: (skill: Skill) => void;
  removeSkill: (id: string) => void;
  skillSearchQuery: string;
  setSkillSearchQuery: (q: string) => void;
  activeSkillCategory: string;
  setActiveSkillCategory: (cat: string) => void;

  // MCP Connectors
  mcpConnections: MCPConnection[];
  setMcpConnections: (conns: MCPConnection[]) => void;
  addMcpConnection: (conn: MCPConnection) => void;
  removeMcpConnection: (id: string) => void;
  updateMcpConnection: (id: string, updates: Partial<MCPConnection>) => void;

  // Screen Control
  screenActions: ScreenAction[];
  setScreenActions: (actions: ScreenAction[]) => void;
  addScreenAction: (action: ScreenAction) => void;
  removeScreenAction: (id: string) => void;
  screenSettings: ScreenSettings;
  setScreenSettings: (settings: Partial<ScreenSettings>) => void;
  isRecording: boolean;
  setIsRecording: (v: boolean) => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;

  // Multi-Agent
  agentTeam: AgentRole[];
  setAgentTeam: (agents: AgentRole[]) => void;
  updateAgent: (id: string, updates: Partial<AgentRole>) => void;
  agentMessages: AgentMessage[];
  setAgentMessages: (msgs: AgentMessage[]) => void;
  addAgentMessage: (msg: AgentMessage) => void;
  agentTasks: AgentTask[];
  setAgentTasks: (tasks: AgentTask[]) => void;
  updateAgentTask: (id: string, updates: Partial<AgentTask>) => void;
  agentConflicts: AgentConflict[];
  setAgentConflicts: (conflicts: AgentConflict[]) => void;

  // Onboarding
  onboardingComplete: boolean;
  setOnboardingComplete: (v: boolean) => void;

  // Toast notifications
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;

  // Theme
  theme: "dark" | "light" | "system";
  setTheme: (t: "dark" | "light" | "system") => void;
}

let toastIdCounter = 0;

const useAppStore = create<AppState>((set) => ({
  // UI
  sidebarVisible: true,
  panelVisible: true,
  toggleSidebar: () =>
    set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  togglePanel: () =>
    set((state) => ({ panelVisible: !state.panelVisible })),

  // Panel tab
  panelTab: "terminal" as const,
  setPanelTab: (tab) => set({ panelTab: tab }),

  // Right Agent Panel
  rightPanelVisible: true,
  toggleRightPanel: () =>
    set((state) => ({ rightPanelVisible: !state.rightPanelVisible })),
  rightPanelTab: "agent",
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  // Sidebar
  activeSidebarTab: "files",
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),

  // Agent Mode
  agentMode: "code" as const,
  setAgentMode: (mode) => set({ agentMode: mode }),

  // Editor
  editorTheme: "dark",
  editorFontSize: 14,
  editorContent: "",
  cursorPosition: { line: 1, column: 1 },
  setEditorTheme: (theme) => set({ editorTheme: theme }),
  setEditorFontSize: (size) => set({ editorFontSize: size }),
  setEditorContent: (content) => set({ editorContent: content }),
  setCursorPosition: (pos) => set({ cursorPosition: pos }),

  // Memory Panel
  memoryPanelTab: "conversations",
  setMemoryPanelTab: (tab) => set({ memoryPanelTab: tab }),
  conversations: [],
  setConversations: (msgs) => set({ conversations: msgs }),
  addConversation: (msg) =>
    set((state) => ({ conversations: [...state.conversations, msg] })),
  memorySearchQuery: "",
  setMemorySearchQuery: (q) => set({ memorySearchQuery: q }),
  memorySearchResults: [],
  setMemorySearchResults: (results) => set({ memorySearchResults: results }),

  // Agent
  agentGoal: "",
  setAgentGoal: (goal) => set({ agentGoal: goal }),
  agentSessionId: null,
  setAgentSessionId: (id) => set({ agentSessionId: id }),
  agentStatus: "idle",
  setAgentStatus: (status) => set({ agentStatus: status }),
  agentEvents: [],
  setAgentEvents: (events) => set({ agentEvents: events }),
  addAgentEvent: (event) =>
    set((state) => ({ agentEvents: [...state.agentEvents, event] })),

  // Autonomous
  autonomousEnabled: false,
  setAutonomousEnabled: (v) => set({ autonomousEnabled: v }),
  autonomousStatus: "disabled",
  setAutonomousStatus: (s) => set({ autonomousStatus: s }),
  autonomousProgress: 0,
  setAutonomousProgress: (p) => set({ autonomousProgress: p }),
  autonomousGoals: [],
  setAutonomousGoals: (g) => set({ autonomousGoals: g }),
  autonomousLogs: [],
  setAutonomousLogs: (l) => set({ autonomousLogs: l }),
  addAutonomousLog: (l) =>
    set((state) => ({
      autonomousLogs: [...state.autonomousLogs, l],
    })),

  // Skill Marketplace
  skills: [],
  setSkills: (skills) => set({ skills }),
  addSkill: (skill) =>
    set((state) => ({ skills: [...state.skills, skill] })),
  removeSkill: (id) =>
    set((state) => ({ skills: state.skills.filter((s) => s.id !== id) })),
  skillSearchQuery: "",
  setSkillSearchQuery: (q) => set({ skillSearchQuery: q }),
  activeSkillCategory: "All",
  setActiveSkillCategory: (cat) => set({ activeSkillCategory: cat }),

  // MCP Connectors
  mcpConnections: [],
  setMcpConnections: (conns) => set({ mcpConnections: conns }),
  addMcpConnection: (conn) =>
    set((state) => ({ mcpConnections: [...state.mcpConnections, conn] })),
  removeMcpConnection: (id) =>
    set((state) => ({
      mcpConnections: state.mcpConnections.filter((c) => c.id !== id),
    })),
  updateMcpConnection: (id, updates) =>
    set((state) => ({
      mcpConnections: state.mcpConnections.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    })),

  // Screen Control
  screenActions: [],
  setScreenActions: (actions) => set({ screenActions: actions }),
  addScreenAction: (action) =>
    set((state) => ({ screenActions: [...state.screenActions, action] })),
  removeScreenAction: (id) =>
    set((state) => ({
      screenActions: state.screenActions.filter((a) => a.id !== id),
    })),
  screenSettings: {
    sandboxMode: true,
    consentRequired: true,
    rateLimit: 10,
  },
  setScreenSettings: (settings) =>
    set((state) => ({
      screenSettings: { ...state.screenSettings, ...settings },
    })),
  isRecording: false,
  setIsRecording: (v) => set({ isRecording: v }),
  isPlaying: false,
  setIsPlaying: (v) => set({ isPlaying: v }),

  // Multi-Agent
  agentTeam: [],
  setAgentTeam: (agents) => set({ agentTeam: agents }),
  updateAgent: (id, updates) =>
    set((state) => ({
      agentTeam: state.agentTeam.map((a) =>
        a.id === id ? { ...a, ...updates } : a
      ),
    })),
  agentMessages: [],
  setAgentMessages: (msgs) => set({ agentMessages: msgs }),
  addAgentMessage: (msg) =>
    set((state) => ({ agentMessages: [...state.agentMessages, msg] })),
  agentTasks: [],
  setAgentTasks: (tasks) => set({ agentTasks: tasks }),
  updateAgentTask: (id, updates) =>
    set((state) => ({
      agentTasks: state.agentTasks.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    })),
  agentConflicts: [],
  setAgentConflicts: (conflicts) => set({ agentConflicts: conflicts }),

  // Onboarding
  onboardingComplete: false,
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),

  // Toast notifications
  toasts: [],
  addToast: (toast) =>
    set((state) => {
      const id = `toast-${++toastIdCounter}-${Date.now()}`;
      const newToast: Toast = { ...toast, id };
      // Keep max 5 toasts, remove oldest if exceeding
      const toasts = [...state.toasts, newToast].slice(-5);
      return { toasts };
    }),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  // Theme
  theme: "dark",
  setTheme: (t) => set({ theme: t }),
}));

export default useAppStore;
