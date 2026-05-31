/**
 * Tauri API helpers — safe wrappers that work in both Tauri and web mode.
 *
 * All Tauri API calls are loaded lazily at runtime. In web mode (no Tauri),
 * the functions return null/false and the app falls back gracefully.
 */

// ── Types ──

export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
export type ListenFn = (event: string, handler: (event: unknown) => void) => Promise<() => void>;
export type ReadTextFileFn = (path: string) => Promise<string>;
export type WriteTextFileFn = (path: string, content: string) => Promise<void>;
export type ReadDirFn = (path: string) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;

// ── Lazy-loaded Tauri API references ──

let _invoke: InvokeFn | null | undefined;
let _listen: ListenFn | null | undefined;
let _readTextFile: ReadTextFileFn | null | undefined;
let _writeTextFile: WriteTextFileFn | null | undefined;
let _readDir: ReadDirFn | null | undefined;

/** Attempt to load Tauri APIs (safe to call multiple times) */
function loadTauriAPIs(): void {
  if (_invoke !== undefined) return; // already tried

  try {
    // Dynamic import via eval to prevent bundler from trying to resolve
    // the @tauri-apps packages at build time (they may not be installed).
    // eslint-disable-next-line no-eval
    const tauriCore = eval("require")("@tauri-apps/api/core");
    _invoke = tauriCore.invoke as InvokeFn;
    // eslint-disable-next-line no-eval
    const tauriEvent = eval("require")("@tauri-apps/api/event");
    _listen = tauriEvent.listen as ListenFn;
    // eslint-disable-next-line no-eval
    const tauriFs = eval("require")("@tauri-apps/plugin-fs");
    _readTextFile = tauriFs.readTextFile as ReadTextFileFn;
    _writeTextFile = tauriFs.writeTextFile as WriteTextFileFn;
    _readDir = tauriFs.readDir as ReadDirFn;
  } catch {
    // Not running inside Tauri — APIs unavailable
    _invoke = null;
    _listen = null;
    _readTextFile = null;
    _writeTextFile = null;
    _readDir = null;
  }
}

/** Check if we're running inside Tauri (not just a web browser) */
export function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;
}

/** Get the Tauri invoke function, or null if unavailable */
export function getInvoke(): InvokeFn | null {
  loadTauriAPIs();
  return _invoke ?? null;
}

/** Get the Tauri listen function, or null if unavailable */
export function getListen(): ListenFn | null {
  loadTauriAPIs();
  return _listen ?? null;
}

/** Get the Tauri readTextFile function, or null if unavailable */
export function getReadTextFile(): ReadTextFileFn | null {
  loadTauriAPIs();
  return _readTextFile ?? null;
}

/** Get the Tauri writeTextFile function, or null if unavailable */
export function getWriteTextFile(): WriteTextFileFn | null {
  loadTauriAPIs();
  return _writeTextFile ?? null;
}

/** Get the Tauri readDir function, or null if unavailable */
export function getReadDir(): ReadDirFn | null {
  loadTauriAPIs();
  return _readDir ?? null;
}

/**
 * Reconstruct final file content from accepted hunks.
 *
 * Takes the old file content and a list of hunks (some accepted, some not),
 * applies only the accepted hunks to produce the new content.
 */
export function reconstructContent(
  oldContent: string,
  hunks: Array<{ accepted: boolean | null; oldStart: number; oldLines: number; newContent: string[] }>
): string {
  const acceptedHunks = hunks.filter((h) => h.accepted === true);
  if (acceptedHunks.length === 0) return oldContent;

  let finalContent = oldContent;
  // Apply hunks in reverse order to preserve line positions
  const sortedAccepted = [...acceptedHunks].sort((a, b) => b.oldStart - a.oldStart);

  for (const hunk of sortedAccepted) {
    if (!finalContent && hunk.oldStart <= 1) {
      finalContent = hunk.newContent.join("\n");
    } else {
      const oldLines = finalContent.split("\n");
      const before = oldLines.slice(0, hunk.oldStart - 1);
      const after = oldLines.slice(hunk.oldStart - 1 + hunk.oldLines);
      finalContent = [...before, ...hunk.newContent, ...after].join("\n");
    }
  }

  return finalContent;
}
