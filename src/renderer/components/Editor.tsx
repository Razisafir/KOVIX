import { Editor as MonacoEditor, loader } from "@monaco-editor/react";
import useAppStore from "@/stores/useAppStore";

loader.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs",
  },
});

const defaultCode = `import { useState } from "react";

interface Props {
  title: string;
  count?: number;
}

export default function Example({ title, count = 0 }: Props) {
  const [value, setValue] = useState(count);

  return (
    <div className="p-4">
      <h1>{title}</h1>
      <p>Count: {value}</p>
      <button onClick={() => setValue((v) => v + 1)}>
        Increment
      </button>
    </div>
  );
}
`;

function Editor() {
  const theme = useAppStore((s) => s.editorTheme);
  const fontSize = useAppStore((s) => s.editorFontSize);
  const setEditorContent = useAppStore((s) => s.setEditorContent);

  return (
    <div className="w-full h-full">
      {/* Tab Bar */}
      <div className="flex items-center h-9 bg-construct-panel border-b border-construct-border overflow-x-auto">
        <div className="flex items-center h-full px-3 min-w-fit bg-construct-bg border-r border-construct-border">
          <span className="text-xs text-construct-text mr-2">App.tsx</span>
          <span className="text-construct-textMuted hover:text-construct-text cursor-pointer text-xs">
            ×
          </span>
        </div>
        <div className="flex items-center h-full px-3 min-w-fit border-r border-construct-border text-construct-textMuted hover:bg-construct-hover cursor-pointer transition-colors">
          <span className="text-xs">main.tsx</span>
        </div>
      </div>

      {/* Editor */}
      <div className="w-full" style={{ height: "calc(100% - 36px)" }}>
        <MonacoEditor
          height="100%"
          language="typescript"
          theme={theme === "dark" ? "vs-dark" : "light"}
          value={defaultCode}
          onChange={(value) => setEditorContent(value ?? "")}
          options={{
            fontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            lineNumbers: "on",
            renderLineHighlight: "all",
            tabSize: 2,
            insertSpaces: true,
            wordWrap: "on",
            folding: true,
            bracketPairColorization: { enabled: true },
            guides: {
              bracketPairs: true,
            },
            scrollbar: {
              useShadows: false,
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
            padding: { top: 16 },
            cursorStyle: "line",
            cursorBlinking: "smooth",
            smoothScrolling: true,
          }}
          loading={
            <div className="flex items-center justify-center w-full h-full text-construct-textMuted text-xs">
              Loading editor...
            </div>
          }
        />
      </div>
    </div>
  );
}

export default Editor;
