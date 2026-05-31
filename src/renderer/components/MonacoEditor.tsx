import React, { useRef, useCallback, useMemo } from "react";
import Editor, { OnMount, DiffOnMount } from "@monaco-editor/react";
import type * as monaco from "monaco-editor";

/* ─────────────────────── Language Detection ─────────────────────── */

const LANGUAGE_MAP: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  rs: "rust",
  go: "go",
  java: "java",
  cpp: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  md: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  dockerfile: "dockerfile",
  xml: "xml",
  svg: "xml",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  r: "r",
  lua: "lua",
  perl: "perl",
  dart: "dart",
  vue: "html",
  svelte: "html",
};

export function getLanguageFromPath(path: string): string {
  const fileName = path.split("/").pop() || "";
  if (fileName.toLowerCase() === "dockerfile") return "dockerfile";
  if (fileName.toLowerCase() === "makefile") return "makefile";
  if (fileName.endsWith(".gitignore") || fileName.endsWith(".env"))
    return "plaintext";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return LANGUAGE_MAP[ext] || "plaintext";
}

/* ─────────────────────── Construct Cyan Theme ─────────────────────── */

const CONSTRUCT_THEME_ID = "construct-ide-dark";

const CONSTRUCT_THEME: monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6A9955", fontStyle: "italic" },
    { token: "keyword", foreground: "00E5FF", fontStyle: "bold" },
    { token: "keyword.control", foreground: "00E5FF" },
    { token: "keyword.operator", foreground: "00E5FF" },
    { token: "identifier", foreground: "DCDCAA" },
    { token: "string", foreground: "CE9178" },
    { token: "string.escape", foreground: "E5C07B" },
    { token: "number", foreground: "B5CEA8" },
    { token: "type", foreground: "4EC9B0" },
    { token: "type.identifier", foreground: "4EC9B0" },
    { token: "function", foreground: "DCDCAA" },
    { token: "variable", foreground: "9CDCFE" },
    { token: "variable.predefined", foreground: "4FC1FF" },
    { token: "operator", foreground: "D4D4D4" },
    { token: "delimiter", foreground: "849495" },
    { token: "tag", foreground: "569CD6" },
    { token: "attribute.name", foreground: "9CDCFE" },
    { token: "attribute.value", foreground: "CE9178" },
    { token: "meta.decorator", foreground: "DCDCAA" },
    { token: "regexp", foreground: "D16969" },
  ],
  colors: {
    "editor.background": "#0A0E1A",
    "editor.foreground": "#E0E7FF",
    "editor.lineHighlightBackground": "#1A1F2E",
    "editor.selectionBackground": "#00E5FF22",
    "editor.inactiveSelectionBackground": "#00E5FF15",
    "editorLineNumber.foreground": "#4A556880",
    "editorLineNumber.activeForeground": "#00E5FF",
    "editorLineNumber.background": "#0A0E1A",
    "editorCursor.foreground": "#00E5FF",
    "editor.findMatchBackground": "#00E5FF44",
    "editor.findMatchHighlightBackground": "#00E5FF22",
    "editorIndentGuide.background": "#1A1F2E",
    "editorIndentGuide.activeBackground": "#00E5FF40",
    "editorBracketMatch.background": "#00E5FF15",
    "editorBracketMatch.border": "#00E5FF50",
    "editorOverviewRuler.border": "#0A0E1A",
    "editorGutter.background": "#0A0E1A",
    "editorGutter.border": "#1A1F2E",
    "editorWidget.background": "#141B2D",
    "editorWidget.border": "#00E5FF20",
    "editorHoverWidget.background": "#141B2D",
    "editorHoverWidget.border": "#00E5FF30",
    "editorSuggestWidget.background": "#141B2D",
    "editorSuggestWidget.border": "#00E5FF30",
    "editorSuggestWidget.selectedBackground": "#00E5FF22",
    "editorSuggestWidget.highlightForeground": "#00E5FF",
    "peekViewEditor.background": "#0A0E1A",
    "peekViewResult.background": "#141B2D",
    "minimap.background": "#0A0E1A",
    "diffEditor.insertedTextBackground": "#00E5FF18",
    "diffEditor.removedTextBackground": "#FF444418",
    "diffEditor.insertedLineBackground": "#00E5FF0D",
    "diffEditor.removedLineBackground": "#FF44440D",
    "scrollbarSlider.background": "#1A1F2E",
    "scrollbarSlider.hoverBackground": "#00E5FF30",
    "scrollbarSlider.activeBackground": "#00E5FF50",
  },
};

/* ─────────────────────── Props ─────────────────────── */

export interface MonacoEditorProps {
  filePath: string;
  content: string;
  language?: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
  diffMode?: boolean;
  originalContent?: string;
  modifiedContent?: string;
}

/* ─────────────────────── Theme Setup ─────────────────────── */

let themeDefined = false;

function ensureTheme(monacoInstance: typeof monaco): void {
  if (!themeDefined) {
    monacoInstance.editor.defineTheme(CONSTRUCT_THEME_ID, CONSTRUCT_THEME);
    themeDefined = true;
  }
  monacoInstance.editor.setTheme(CONSTRUCT_THEME_ID);
}

/* ─────────────────────── Component ─────────────────────── */

export const MonacoEditor: React.FC<MonacoEditorProps> = ({
  filePath,
  content,
  language,
  onChange,
  onSave,
  readOnly = false,
  diffMode = false,
  originalContent,
  modifiedContent,
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const detectedLanguage = useMemo(
    () => language || getLanguageFromPath(filePath),
    [language, filePath]
  );

  const handleMount: OnMount = useCallback(
    (editor, monacoInstance) => {
      ensureTheme(monacoInstance);
      editorRef.current = editor;

      // Save command (Ctrl+S / Cmd+S)
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
        () => {
          const value = editor.getValue();
          onSave?.(value);
        }
      );

      // Inline agent command (Ctrl+Shift+L)
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd |
          monacoInstance.KeyMod.Shift |
          monacoInstance.KeyCode.KeyL,
        () => {
          const selection = editor.getSelection();
          if (selection) {
            window.dispatchEvent(
              new CustomEvent("construct:agent:inline", {
                detail: { selection, filePath },
              })
            );
          }
        }
      );

      // Go to definition (Ctrl+Click fallback — emit event for agent)
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.F12,
        () => {
          const position = editor.getPosition();
          if (position) {
            window.dispatchEvent(
              new CustomEvent("construct:agent:goto-def", {
                detail: {
                  filePath,
                  line: position.lineNumber,
                  column: position.column,
                },
              })
            );
          }
        }
      );

      // Track cursor position for status bar
      editor.onDidChangeCursorPosition((e) => {
        window.dispatchEvent(
          new CustomEvent("construct:cursor:change", {
            detail: {
              line: e.position.lineNumber,
              column: e.position.column,
            },
          })
        );
      });
    },
    [filePath, onSave]
  );

  const handleDiffMount: DiffOnMount = useCallback((editor, monacoInstance) => {
    ensureTheme(monacoInstance);
    // editor here is IStandaloneDiffEditor
    void editor;
  }, []);

  const editorOptions = useMemo(
    () => ({
      readOnly,
      minimap: { enabled: true, scale: 1, renderCharacters: false },
      scrollBeyondLastLine: false,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 20,
      padding: { top: 8, bottom: 8 },
      cursorBlinking: "smooth" as const,
      cursorSmoothCaretAnimation: "on" as const,
      smoothScrolling: true,
      folding: true,
      foldingHighlight: true,
      showFoldingControls: "always" as const,
      bracketPairColorization: { enabled: true },
      autoIndent: "full" as const,
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "on" as const,
      wrappingIndent: "same" as const,
      renderWhitespace: "selection" as const,
      guides: {
        bracketPairs: true,
        indentation: true,
      },
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "smart" as const,
      parameterHints: { enabled: true },
      hover: { enabled: true, delay: 300 },
      definitionLinkOpensInPeek: true,
      peekWidgetDefaultFocus: "tree" as const,
      scrollbar: {
        useShadows: false,
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 0,
      automaticLayout: true,
    }),
    [readOnly]
  );

  const diffOptions = useMemo(
    () => ({
      readOnly: true,
      renderSideBySide: false,
      diffWordWrap: "on" as const,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 20,
      padding: { top: 8, bottom: 8 },
      folding: true,
      foldingHighlight: true,
      showFoldingControls: "always" as const,
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true,
      },
      scrollbar: {
        useShadows: false,
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
    }),
    []
  );

  if (
    diffMode &&
    originalContent !== undefined &&
    modifiedContent !== undefined
  ) {
    return (
      <Editor
        height="100%"
        language={detectedLanguage}
        original={originalContent}
        modified={modifiedContent}
        theme={CONSTRUCT_THEME_ID}
        onMount={handleDiffMount}
        options={diffOptions}
        loading={
          <div className="flex items-center justify-center w-full h-full text-[11px] text-[#4A5568] font-mono">
            loading diff editor...
          </div>
        }
      />
    );
  }

  return (
    <Editor
      height="100%"
      language={detectedLanguage}
      value={content}
      theme={CONSTRUCT_THEME_ID}
      onMount={handleMount}
      onChange={(val) => onChange?.(val ?? "")}
      beforeMount={(monacoInstance) => {
        ensureTheme(monacoInstance);
      }}
      options={editorOptions}
      loading={
        <div className="flex items-center justify-center w-full h-full text-[11px] text-[#4A5568] font-mono">
          loading editor...
        </div>
      }
    />
  );
};

export default MonacoEditor;
