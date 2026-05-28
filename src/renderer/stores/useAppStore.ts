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

  // Sidebar
  activeSidebarTab: string;
  setActiveSidebarTab: (tab: string) => void;

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
}

const useAppStore = create<AppState>((set) => ({
  // UI
  sidebarVisible: true,
  panelVisible: true,
  toggleSidebar: () =>
    set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  togglePanel: () =>
    set((state) => ({ panelVisible: !state.panelVisible })),

  // Sidebar
  activeSidebarTab: "files",
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),

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
}));

export default useAppStore;
