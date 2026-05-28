import { create } from "zustand";

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
}));

export default useAppStore;
