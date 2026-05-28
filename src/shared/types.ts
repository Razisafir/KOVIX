// Shared types used by both main (Rust) and renderer (React) processes
// These are mirrored in Rust as serde-compatible structs

/** File system node representing a file or directory */
export interface FileNode {
  id: string;
  name: string;
  type: "file" | "directory";
  path: string;
  children?: FileNode[];
  expanded?: boolean;
  language?: string;
}

/** Editor tab state */
export interface EditorTab {
  id: string;
  fileName: string;
  filePath: string;
  language: string;
  content: string;
  isModified: boolean;
  isActive: boolean;
}

/** Cursor position in the editor */
export interface CursorPosition {
  line: number;
  column: number;
}

/** Application settings */
export interface AppSettings {
  editorFontSize: number;
  editorTheme: "dark" | "light";
  sidebarVisible: boolean;
  panelVisible: boolean;
  wordWrap: boolean;
  tabSize: number;
}

/** Panel tab identifiers */
export type PanelTab = "terminal" | "problems" | "chat";

/** Sidebar tab identifiers */
export type SidebarTab = "files" | "search" | "git" | "extensions";

/** Command result from Rust backend */
export interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
