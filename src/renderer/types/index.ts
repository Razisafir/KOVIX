export interface FileNode {
  id: string;
  name: string;
  type: "file" | "directory";
  path: string;
  children?: FileNode[];
  expanded?: boolean;
  language?: string;
}

export interface EditorTab {
  id: string;
  fileName: string;
  filePath: string;
  language: string;
  content: string;
  isModified: boolean;
  isActive: boolean;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface AppSettings {
  editorFontSize: number;
  editorTheme: "dark" | "light";
  sidebarVisible: boolean;
  panelVisible: boolean;
  wordWrap: boolean;
  tabSize: number;
}

export type PanelTab = "autonomous" | "terminal" | "problems" | "chat" | "agent" | "memory" | "skills" | "mcp" | "screen" | "agents";
export type SidebarTab = "files" | "search" | "git" | "extensions";

// Toast notification system
export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

// ============================================================
// Skill Marketplace Types
// ============================================================

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: SkillStep[];
  tools_needed: string[];
  examples: string[];
  confidence: number;
  rating?: number;
  installs?: number;
  installed?: boolean;
}

export interface SkillStep {
  order: number;
  action: string;
  description: string;
  tool?: string;
  parameters: Record<string, unknown>;
}

// ============================================================
// MCP Connector Types
// ============================================================

export interface MCPConnection {
  id: string;
  name: string;
  serverUrl: string;
  status: "connected" | "disconnected" | "error";
  tools: MCPTool[];
  lastUsed?: string;
  autoReconnect?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ============================================================
// Screen Control Types
// ============================================================

export interface ScreenAction {
  id: string;
  actionType: string;
  params: Record<string, unknown>;
  timestamp: number;
  approved: boolean;
}

export interface Screenshot {
  id: string;
  timestamp: number;
  label: string;
}

export interface ScreenSettings {
  sandboxMode: boolean;
  consentRequired: boolean;
  rateLimit: number;
}

// ============================================================
// Multi-Agent Types
// ============================================================

export interface AgentRole {
  id: string;
  name: string;
  role: string;
  status: "active" | "idle" | "error";
  currentTask?: string;
  progress: number;
  color?: string;
}

export interface AgentMessage {
  type: "request" | "response" | "alert" | "info";
  fromAgent: string;
  toAgent?: string;
  content: string;
  timestamp: number;
}

export interface AgentTask {
  id: string;
  title: string;
  assignee: string;
  status: "pending" | "active" | "completed" | "failed";
  priority: "low" | "medium" | "high";
}

export interface AgentConflict {
  id: string;
  agents: string[];
  issue: string;
  severity: "low" | "high";
}

// Re-export memory types
export * from "./memory";

// Re-export agent types
export * from "./agent";

// Re-export autonomous types
export * from "./autonomous";
