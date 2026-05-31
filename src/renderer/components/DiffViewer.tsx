import { useState } from "react";
import type { FileDiff, DiffHunk } from "../types/diff";
import { useDiffStore } from "../stores/useDiffStore";
import { isTauri, getWriteTextFile, reconstructContent } from "../utils/tauriHelpers";

/** Write accepted file content to disk */
async function applyToDisk(fileDiff: FileDiff): Promise<boolean> {
  const acceptedHunks = fileDiff.hunks.filter((h) => h.accepted === true);
  if (acceptedHunks.length === 0) return false;

  const finalContent = reconstructContent(fileDiff.oldContent, fileDiff.hunks);

  const writeFn = getWriteTextFile();
  if (isTauri() && writeFn) {
    try {
      await writeFn(fileDiff.filePath, finalContent);
      console.log("[DiffViewer] Written to disk:", fileDiff.filePath);
      return true;
    } catch (err) {
      console.error("[DiffViewer] Failed to write:", fileDiff.filePath, err);
      return false;
    }
  }

  // Web mode: just log
  console.log("[DiffViewer] Would write to disk (web mode):", fileDiff.filePath);
  return true;
}

function HunkActions({
  hunk,
  onAccept,
  onReject,
}: {
  hunk: DiffHunk;
  onAccept: () => void;
  onReject: () => void;
}) {
  if (hunk.accepted === true) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-mono text-diff-add">
        <span className="material-symbols-outlined text-[11px]">check</span>
        Accepted
      </span>
    );
  }
  if (hunk.accepted === false) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-mono text-diff-remove">
        <span className="material-symbols-outlined text-[11px]">close</span>
        Rejected
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onAccept} className="flex items-center gap-[3px] px-2 py-[2px] bg-transparent border font-mono text-[9px] font-semibold tracking-wider cursor-pointer rounded" style={{ borderColor: "rgba(74,222,128,0.2)", color: "var(--c-ok)" }}>
        <span className="material-symbols-outlined text-[10px]">check</span> ACCEPT
      </button>
      <button onClick={onReject} className="flex items-center gap-[3px] px-2 py-[2px] bg-transparent border font-mono text-[9px] font-semibold tracking-wider cursor-pointer rounded" style={{ borderColor: "rgba(248,113,113,0.2)", color: "var(--c-err)" }}>
        <span className="material-symbols-outlined text-[10px]">close</span> REJECT
      </button>
    </div>
  );
}

function DiffLineView({ type, content, lineNum }: { type: "context" | "added" | "removed"; content: string; lineNum: number }) {
  const bgColor = type === "added" ? "var(--c-ok-bg)" : type === "removed" ? "var(--c-err-bg)" : "transparent";
  const textColor = type === "added" ? "var(--c-ok)" : type === "removed" ? "var(--c-err)" : "var(--c-text2)";
  const sign = type === "added" ? "+" : type === "removed" ? "-" : " ";
  return (
    <div className="flex font-mono text-[10px] leading-4 whitespace-pre overflow-hidden" style={{ backgroundColor: bgColor }}>
      <span className="w-8 pl-1.5 shrink-0 text-right select-none" style={{ color: "var(--c-text4)" }}>{lineNum || ""}</span>
      <span className="w-[14px] pl-1 shrink-0 select-none font-semibold" style={{ color: textColor }}>{sign}</span>
      <span className="flex-1 pl-1 overflow-hidden text-ellipsis" style={{ color: textColor }}>{content}</span>
    </div>
  );
}

function HunkView({ hunk, filePath, sessionId }: { hunk: DiffHunk; filePath: string; sessionId: string }) {
  const acceptHunk = useDiffStore((s) => s.acceptHunk);
  const rejectHunk = useDiffStore((s) => s.rejectHunk);
  const [expanded, setExpanded] = useState(true);

  const lines: { type: "context" | "added" | "removed"; content: string; oldLine?: number; newLine?: number }[] = [];
  let oldLineNum = hunk.oldStart;
  let newLineNum = hunk.newStart;
  const maxLines = Math.max(hunk.oldContent.length, hunk.newContent.length);
  for (let idx = 0; idx < maxLines; idx++) {
    const oldLine = hunk.oldContent[idx];
    const newLine = hunk.newContent[idx];
    if (oldLine === newLine && oldLine !== undefined) {
      lines.push({ type: "context", content: oldLine, oldLine: oldLineNum, newLine: newLineNum });
      oldLineNum++; newLineNum++;
    } else {
      if (oldLine !== undefined) { lines.push({ type: "removed", content: oldLine, oldLine: oldLineNum }); oldLineNum++; }
      if (newLine !== undefined) { lines.push({ type: "added", content: newLine, newLine: newLineNum }); newLineNum++; }
    }
  }

  return (
    <div className="border mb-1 bg-c-base rounded-md overflow-hidden" style={{ borderColor: "var(--c-border)" }}>
      <div className="flex items-center justify-between px-2 py-[3px] cursor-pointer select-none" style={{ backgroundColor: "var(--c-s1)", borderBottom: "1px solid var(--c-border)" }} onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[12px]" style={{ color: "var(--c-text4)" }}>{expanded ? "expand_more" : "chevron_right"}</span>
          <span className="font-mono text-[9px]" style={{ color: "var(--c-text3)" }}>{hunk.header}</span>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <HunkActions hunk={hunk} onAccept={() => acceptHunk(sessionId, filePath, hunk.id)} onReject={() => rejectHunk(sessionId, filePath, hunk.id)} />
        </div>
      </div>
      {expanded && (
        <div className="ml-2 max-h-[200px] overflow-auto" style={{ borderLeft: "2px solid var(--c-accent)", scrollbarWidth: "thin", scrollbarColor: "var(--c-s3) transparent" }}>
          {lines.map((line, i) => (<DiffLineView key={i} type={line.type} content={line.content} lineNum={line.oldLine || line.newLine || 0} />))}
        </div>
      )}
    </div>
  );
}

function FileIcon({ status }: { status: FileDiff["status"] }) {
  switch (status) {
    case "added": return <span className="material-symbols-outlined text-[11px] text-diff-add shrink-0">add_circle</span>;
    case "deleted": return <span className="material-symbols-outlined text-[11px] text-diff-remove shrink-0">remove_circle</span>;
    default: return <span className="material-symbols-outlined text-[11px] shrink-0" style={{ color: "var(--c-text3)" }}>description</span>;
  }
}

export function DiffViewer({ sessionId, fileDiff }: { sessionId: string; fileDiff: FileDiff }) {
  const acceptAll = useDiffStore((s) => s.acceptAll);
  const rejectAll = useDiffStore((s) => s.rejectAll);
  const pendingCount = fileDiff.hunks.filter((h) => h.accepted === null).length;
  const allAccepted = fileDiff.hunks.every((h) => h.accepted === true);
  const [diskWriteOk, setDiskWriteOk] = useState(false);

  const handleAcceptAll = async () => {
    acceptAll(sessionId);
    // After accepting all hunks, write to disk
    const result = await applyToDisk({ ...fileDiff, hunks: fileDiff.hunks.map((h) => ({ ...h, accepted: true })) });
    if (result) setDiskWriteOk(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between px-2 py-1 mb-1 rounded-md" style={{ backgroundColor: "var(--c-s1)", border: "1px solid var(--c-border)" }}>
        <div className="flex items-center gap-1.5">
          <FileIcon status={fileDiff.status} />
          <span className="font-mono text-[10px] font-semibold overflow-hidden text-ellipsis whitespace-nowrap text-text-primary" title={fileDiff.filePath}>{fileDiff.filePath}</span>
          <span className="font-mono text-[9px]" style={{ color: "var(--c-text4)" }}>{fileDiff.hunks.length} hunks, {pendingCount} pending</span>
        </div>
        {pendingCount > 0 && (
          <div className="flex gap-1.5">
            <button onClick={() => rejectAll(sessionId)} className="h-[18px] px-1.5 bg-transparent border font-mono text-[8px] font-semibold tracking-wider cursor-pointer rounded" style={{ borderColor: "rgba(248,113,113,0.2)", color: "var(--c-err)" }}>REJECT ALL</button>
            <button onClick={handleAcceptAll} className="h-[18px] px-1.5 bg-transparent border font-mono text-[8px] font-semibold tracking-wider cursor-pointer rounded" style={{ borderColor: "rgba(74,222,128,0.2)", color: "var(--c-ok)" }}>ACCEPT ALL</button>
          </div>
        )}
        {allAccepted && diskWriteOk && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-diff-add">
            <span className="material-symbols-outlined text-[11px]">check_circle</span>
            Saved
          </span>
        )}
      </div>
      {fileDiff.hunks.map((hunk) => (<HunkView key={hunk.id} hunk={hunk} filePath={fileDiff.filePath} sessionId={sessionId} />))}
    </div>
  );
}
