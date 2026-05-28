import {
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { FileCode, X } from "lucide-react";

const C = {
  base: "#0c0c10", s1: "#12121a", s2: "#1a1a24", s3: "#22222e",
  accent: "#6366f1", t1: "#e8e8ec", t2: "#94949c", t3: "#6b6b73", t4: "#4a4a52",
  ok: "#10b981", wrn: "#f59e0b", err: "#ef4444", inf: "#60a5fa"
};
const ff = '"Geist Mono", "JetBrains Mono", monospace';

export interface FileChip {
  path: string;
  name: string;
}

interface FileReferenceInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFileAttach: (files: FileChip[]) => void;
  projectFiles: string[];
  attachedFiles: FileChip[];
}

export function FileReferenceInput({
  value,
  onChange,
  onSubmit,
  onFileAttach,
  projectFiles,
  attachedFiles,
}: FileReferenceInputProps) {
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPos, setCursorPos] = useState(0);

  // Detect @ trigger
  const checkTrigger = useCallback(() => {
    const beforeCursor = value.slice(0, cursorPos);
    const match = beforeCursor.match(/@([\w./-]*)$/);
    if (match) {
      setFilter(match[1].toLowerCase());
      setShowAutocomplete(true);
    } else {
      setShowAutocomplete(false);
    }
  }, [value, cursorPos]);

  useEffect(() => {
    checkTrigger();
  }, [checkTrigger]);

  const filtered = projectFiles
    .filter((f) => f.toLowerCase().includes(filter))
    .slice(0, 8);

  const attachFile = (path: string) => {
    const name = path.split("/").pop() || path;
    const newFiles = [...attachedFiles, { path, name }];
    onFileAttach(newFiles);
    // Remove @filter from input
    const before = value.slice(0, cursorPos).replace(/@[\w./-]*$/, "");
    const after = value.slice(cursorPos);
    onChange(before + after);
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  const removeFile = (path: string) => {
    onFileAttach(attachedFiles.filter((f) => f.path !== path));
  };

  return (
    <div style={{ position: "relative", fontFamily: ff }}>
      {/* Attached file chips */}
      {attachedFiles.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
          {attachedFiles.map((file) => (
            <span
              key={file.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 8px",
                background: C.s2,
                color: C.t2,
                borderRadius: 2,
                fontSize: 10,
                letterSpacing: "0.04em",
                fontFamily: ff,
                border: `1px solid ${C.s3}`,
              }}
            >
              <FileCode size={10} color={C.accent} />
              {file.name}
              <button
                onClick={() => removeFile(file.path)}
                title="Remove file"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  color: C.t3,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = C.err;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = C.t3;
                }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input with @ autocomplete */}
      <div style={{ position: "relative" }}>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setCursorPos(e.target.selectionStart);
          }}
          onSelect={(e) => setCursorPos(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Type @ to reference a file..."
          style={{
            width: "100%",
            height: 80,
            padding: "8px 10px",
            background: C.s1,
            border: `1px solid ${C.s3}`,
            borderRadius: 2,
            fontSize: 11,
            color: C.t1,
            fontFamily: ff,
            outline: "none",
            resize: "none" as const,
            boxSizing: "border-box",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = C.accent;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = C.s3;
          }}
        />

        {/* Autocomplete dropdown */}
        {showAutocomplete && filtered.length > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              marginBottom: 4,
              width: 256,
              maxHeight: 160,
              overflowY: "auto",
              background: C.s1,
              border: `1px solid ${C.s3}`,
              borderRadius: 2,
              zIndex: 50,
              fontFamily: ff,
            }}
          >
            {filtered.map((file) => (
              <button
                key={file}
                onClick={() => attachFile(file)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "6px 10px",
                  fontSize: 11,
                  color: C.t2,
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${C.s2}`,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: ff,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = C.s2;
                  e.currentTarget.style.color = C.t1;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = C.t2;
                }}
              >
                <FileCode
                  size={12}
                  color={C.accent}
                  style={{ flexShrink: 0 }}
                />
                <span style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {file}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default FileReferenceInput;
