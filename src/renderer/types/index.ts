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

export type PanelTab = "autonomous" | "terminal" | "problems" | "chat" | "agent" | "memory";
export type SidebarTab = "files" | "search" | "git" | "extensions";

// Re-export memory types
export * from "./memory";

// Re-export agent types
export * from "./agent";

// Re-export autonomous types
export * from "./autonomous";
