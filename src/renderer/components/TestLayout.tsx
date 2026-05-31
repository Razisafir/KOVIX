import React, { useState } from "react";
import Editor from "@monaco-editor/react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";

export const TestLayout: React.FC = () => {
  const [code, setCode] = useState(`from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/agents")
async def list_agents():
    return {"agents": ["code", "architect", "debug"]}
`);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Title Bar */}
      <div
        style={{
          height: 30,
          background: "#141B2D",
          borderBottom: "1px solid #1A1F2E",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          fontSize: 11,
          color: "#E0E7FF",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, color: "#00E5FF", marginRight: 16, letterSpacing: "0.1em" }}>
          CONSTRUCT
        </span>
        <span style={{ color: "#4A5568", padding: "0 8px", cursor: "pointer" }}>File</span>
        <span style={{ color: "#4A5568", padding: "0 8px", cursor: "pointer" }}>Edit</span>
        <span style={{ color: "#4A5568", padding: "0 8px", cursor: "pointer" }}>View</span>
        <span style={{ color: "#4A5568", padding: "0 8px", cursor: "pointer" }}>Run</span>
        <span style={{ color: "#4A5568", padding: "0 8px", cursor: "pointer" }}>Terminal</span>
        <div style={{ marginLeft: "auto", fontSize: 10, color: "#4A5568" }}>v0.1.0-beta</div>
      </div>

      {/* Main Content with Allotment */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <Allotment defaultSizes={[200, 1, 280]}>
          {/* Left Sidebar */}
          <Allotment.Pane preferredSize={200} minSize={120} maxSize={400}>
            <div
              style={{
                height: "100%",
                background: "#0A0E1A",
                color: "#E0E7FF",
                padding: "10px",
                overflow: "auto",
              }}
            >
              <div
                style={{
                  color: "#00E5FF",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  marginBottom: 10,
                  textTransform: "uppercase",
                }}
              >
                Explorer
              </div>
              <div style={{ fontSize: 11, marginTop: 4 }}>main.py</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>agent.py</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>executor.py</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>llm.py</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>package.json</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>README.md</div>
            </div>
          </Allotment.Pane>

          {/* Center — Editor */}
          <Allotment.Pane minSize={300}>
            <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              {/* Tab Bar */}
              <div
                style={{
                  height: 35,
                  background: "#141B2D",
                  borderBottom: "1px solid #1A1F2E",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                  fontSize: 11,
                  color: "#E0E7FF",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    background: "#0A0E1A",
                    borderTop: "2px solid #00E5FF",
                    padding: "4px 12px",
                  }}
                >
                  main.py
                </span>
              </div>
              {/* Monaco Editor */}
              <div style={{ flex: 1, minHeight: 0 }}>
                <Editor
                  height="100%"
                  defaultLanguage="python"
                  value={code}
                  onChange={(val) => setCode(val ?? "")}
                  theme="vs-dark"
                  options={{
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    minimap: { enabled: true, renderCharacters: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>
          </Allotment.Pane>

          {/* Right — Agent Panel */}
          <Allotment.Pane preferredSize={280} minSize={200} maxSize={500}>
            <div
              style={{
                height: "100%",
                background: "#0A0E1A",
                borderLeft: "1px solid #1A1F2E",
                padding: "12px",
                color: "#4A5568",
                fontSize: 11,
              }}
            >
              <div
                style={{
                  color: "#00E5FF",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  marginBottom: 12,
                  textTransform: "uppercase",
                }}
              >
                Agent
              </div>
              <p>Agent panel placeholder</p>
              <p>Connect to Ollama to start coding.</p>
              <div
                style={{
                  marginTop: 16,
                  padding: 8,
                  background: "#141B2D",
                  borderRadius: 4,
                  border: "1px solid #1A1F2E",
                }}
              >
                <div style={{ color: "#00E5FF", marginBottom: 4 }}>Status: Idle</div>
                <div
                  style={{
                    width: "100%",
                    height: 4,
                    background: "#1A1F2E",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ height: "100%", width: "0%", background: "#00E5FF" }} />
                </div>
              </div>
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* Bottom Panel */}
      <div
        style={{
          height: 150,
          background: "#0A0E1A",
          borderTop: "1px solid #1A1F2E",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            height: 28,
            background: "#141B2D",
            display: "flex",
            alignItems: "center",
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          <button
            style={{
              padding: "4px 12px",
              color: "#E0E7FF",
              background: "transparent",
              border: "none",
              borderBottom: "2px solid #00E5FF",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Terminal
          </button>
          <button
            style={{
              padding: "4px 12px",
              color: "#4A5568",
              background: "transparent",
              border: "none",
              borderBottom: "2px solid transparent",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Chat
          </button>
          <button
            style={{
              padding: "4px 12px",
              color: "#4A5568",
              background: "transparent",
              border: "none",
              borderBottom: "2px solid transparent",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Changes
          </button>
        </div>
        <div style={{ flex: 1, padding: 8, fontSize: 11, color: "#4A5568", fontFamily: "'JetBrains Mono', monospace" }}>
          <div>$ construct --version</div>
          <div style={{ color: "#E0E7FF" }}>0.1.0-beta</div>
          <div>$ npm run dev</div>
          <div style={{ color: "#E0E7FF" }}>Ready on http://localhost:5173</div>
        </div>
      </div>

      {/* Status Bar */}
      <div
        style={{
          height: 22,
          background: "rgba(0, 229, 255, 0.06)",
          borderTop: "1px solid rgba(0, 229, 255, 0.12)",
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          fontSize: 10,
          color: "#E0E7FF",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#00E5FF", display: "inline-block" }} />
          <span style={{ color: "#4A5568" }}>Ready</span>
          <span style={{ color: "#4A5568" }}>|</span>
          <span style={{ color: "#4A5568" }}>Ollama</span>
        </div>
        <div style={{ margin: "0 auto", display: "flex", gap: 12 }}>
          <span style={{ color: "#4A5568" }}>main.py</span>
          <span style={{ color: "#4A5568" }}>Ln 1, Col 1</span>
          <span style={{ color: "#4A5568" }}>UTF-8</span>
          <span style={{ color: "#4A5568" }}>Python</span>
        </div>
        <span style={{ color: "#4A5568" }}>0 pending changes</span>
      </div>
    </div>
  );
};
