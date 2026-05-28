import { useEffect } from "react";
import { loader } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";

loader.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs",
  },
});

export function useMonacoSetup() {
  useEffect(() => {
    loader.init().then((monaco: Monaco) => {
      // Custom theme for Construct
      monaco.editor.defineTheme("construct-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6c7086", fontStyle: "italic" },
          { token: "keyword", foreground: "cba6f7" },
          { token: "identifier", foreground: "cdd6f4" },
          { token: "string", foreground: "a6e3a1" },
          { token: "number", foreground: "fab387" },
          { token: "tag", foreground: "89b4fa" },
          { token: "attribute.name", foreground: "f9e2af" },
          { token: "attribute.value", foreground: "a6e3a1" },
          { token: "type", foreground: "f9e2af" },
        ],
        colors: {
          "editor.background": "#1e1e2e",
          "editor.foreground": "#cdd6f4",
          "editor.lineHighlightBackground": "#31324455",
          "editor.selectionBackground": "#585b70",
          "editor.inactiveSelectionBackground": "#45475a",
          "editorCursor.foreground": "#f38ba8",
          "editorLineNumber.foreground": "#6c7086",
          "editorLineNumber.activeForeground": "#cdd6f4",
          "editor.selectionHighlightBackground": "#585b7044",
          "editor.wordHighlightBackground": "#585b7044",
          "editor.wordHighlightStrongBackground": "#585b7066",
          "editorWidget.background": "#181825",
          "editorWidget.border": "#313244",
          "editorSuggestWidget.background": "#181825",
          "editorSuggestWidget.border": "#313244",
          "editorSuggestWidget.selectedBackground": "#585b70",
          "editorSuggestWidget.highlightForeground": "#89b4fa",
          "editorBracketMatch.background": "#585b7066",
          "editorBracketMatch.border": "#89b4fa",
        },
      });
    });
  }, []);
}

export default useMonacoSetup;
