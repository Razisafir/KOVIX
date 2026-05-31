import { useState, useCallback } from "react";
import { useDiffStore } from "../stores/useDiffStore";
import { DiffViewer } from "./DiffViewer";
import type { FileDiff } from "../types/diff";
import { isTauri, getWriteTextFile, reconstructContent } from "../utils/tauriHelpers";

/** Write accepted file content to disk */
async function applyFileToDisk(fileDiff: FileDiff): Promise<boolean> {
  const acceptedHunks = fileDiff.hunks.filter((h) => h.accepted === true);
  const rejectedHunks = fileDiff.hunks.filter((h) => h.accepted === false);

  if (acceptedHunks.length === 0 && rejectedHunks.length === 0) return false;

  const writeFn = getWriteTextFile();
  if (isTauri() && writeFn) {
    try {
      // Reconstruct content: accepted hunks get new content, rejected hunks get old content
      const finalContent = reconstructContent(fileDiff.oldContent, fileDiff.hunks);
      await writeFn(fileDiff.filePath, finalContent);
      console.log("[DiffPanel] Written to disk:", fileDiff.filePath);
      return true;
    } catch (err) {
      console.error("[DiffPanel] Failed to write:", fileDiff.filePath, err);
      return false;
    }
  }

  console.log("[DiffPanel] Would write to disk (web mode):", fileDiff.filePath);
  return true;
}

function DiffPanel() {
  const sessions = useDiffStore((s) => s.sessions);
  const activeSessionId = useDiffStore((s) => s.activeSessionId);
  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;
  const [applyStatus, setApplyStatus] = useState<string | null>(null);

  const handleApplyAllAccepted = useCallback(async () => {
    if (!activeSession) return;
    let appliedCount = 0;
    let errorCount = 0;
    for (const fileDiff of activeSession.fileDiffs) {
      const hasDecisions = fileDiff.hunks.some((h) => h.accepted !== null);
      if (!hasDecisions) continue;
      const ok = await applyFileToDisk(fileDiff);
      if (ok) appliedCount++;
      else errorCount++;
    }
    if (appliedCount > 0 || errorCount > 0) {
      setApplyStatus(
        `${appliedCount} file(s) applied${errorCount > 0 ? `, ${errorCount} error(s)` : ""}`
      );
      setTimeout(() => setApplyStatus(null), 4000);
    }
  }, [activeSession]);

  if (!activeSession || activeSession.fileDiffs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full font-mono gap-2" style={{ color: "var(--c-text3)" }}>
        <span className="material-symbols-outlined text-2xl opacity-50" style={{ color: "var(--c-text4)" }}>commit</span>
        <span className="text-[11px] font-semibold tracking-wider">
          No pending changes
        </span>
        <span className="text-[10px]" style={{ color: "var(--c-text4)" }}>
          Agent changes will appear here for review
        </span>
      </div>
    );
  }

  const pendingCount = activeSession.fileDiffs.reduce(
    (acc, fd) => acc + fd.hunks.filter((h) => h.accepted === null).length,
    0
  );
  const acceptedCount = activeSession.fileDiffs.reduce(
    (acc, fd) => acc + fd.hunks.filter((h) => h.accepted === true).length,
    0
  );
  const rejectedCount = activeSession.fileDiffs.reduce(
    (acc, fd) => acc + fd.hunks.filter((h) => h.accepted === false).length,
    0
  );
  const hasDecisions = acceptedCount > 0 || rejectedCount > 0;
  const allDecided = pendingCount === 0 && hasDecisions;

  return (
    <div className="flex flex-col h-full bg-bg-onyx font-mono">
      <div
        className="flex items-center justify-between px-2 py-1 shrink-0"
        style={{ borderBottom: "1px solid var(--c-border)" }}
      >
        <div>
          <span className="text-[10px] font-semibold tracking-wider text-text-primary">CHANGES</span>
          <span className="text-[9px] ml-2" style={{ color: "var(--c-text4)" }}>session {activeSession.sessionId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="flex items-center gap-[3px] text-[9px] text-accent-gold">
              <span className="material-symbols-outlined text-[10px]">error_outline</span>
              {pendingCount} pending
            </span>
          )}
          {acceptedCount > 0 && (
            <span className="flex items-center gap-[3px] text-[9px] text-diff-add">
              <span className="material-symbols-outlined text-[10px]">check_circle</span>
              {acceptedCount} accepted
            </span>
          )}
          {rejectedCount > 0 && (
            <span className="flex items-center gap-[3px] text-[9px] text-diff-remove">
              <span className="material-symbols-outlined text-[10px]">cancel</span>
              {rejectedCount} rejected
            </span>
          )}
          {allDecided && (
            <button
              onClick={handleApplyAllAccepted}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono font-semibold border cursor-pointer transition-colors"
              style={{ borderColor: "rgba(74,222,128,0.3)", color: "var(--c-ok)", backgroundColor: "rgba(74,222,128,0.1)" }}
            >
              <span className="material-symbols-outlined text-[10px]">save</span>
              APPLY CHANGES
            </button>
          )}
        </div>
        {applyStatus && (
          <span className="text-[9px] font-mono" style={{ color: applyStatus.includes("error") ? "var(--c-err)" : "var(--c-ok)" }}>
            {applyStatus}
          </span>
        )}
      </div>
      <div
        className="flex-1 overflow-auto p-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: "var(--c-s3) transparent" }}
      >
        {activeSession.fileDiffs.map((fileDiff) => (
          <DiffViewer key={fileDiff.filePath} sessionId={activeSession.id} fileDiff={fileDiff} />
        ))}
      </div>
    </div>
  );
}

export default DiffPanel;
