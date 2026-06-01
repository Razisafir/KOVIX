/**
 * Native file dialogs for Construct IDE.
 *
 * Uses @tauri-apps/plugin-dialog for OS-native open/save dialogs.
 * Falls back gracefully when running in browser (no Tauri).
 */

let dialogModule: typeof import("@tauri-apps/plugin-dialog") | null = null;

async function getDialog() {
  if (dialogModule) return dialogModule;
  try {
    // Check if we're running inside Tauri
    if (typeof window !== "undefined" && (window as any).__TAURI__) {
      dialogModule = await import("@tauri-apps/plugin-dialog");
      return dialogModule;
    }
  } catch {
    // Not in Tauri or plugin not available
  }
  return null;
}

/**
 * Open a native folder-picker dialog.
 * Returns the selected folder path, or null if cancelled.
 */
export async function openFolderDialog(): Promise<string | null> {
  const dialog = await getDialog();
  if (!dialog) {
    console.warn("[nativeDialogs] Not in Tauri — folder dialog unavailable");
    return null;
  }
  try {
    const selected = await dialog.open({
      directory: true,
      multiple: false,
      title: "Open Folder",
    });
    // dialog.open returns string | string[] | null
    if (typeof selected === "string") return selected;
    if (Array.isArray(selected) && selected.length > 0) return selected[0];
    return null;
  } catch (e) {
    console.warn("[nativeDialogs] Folder dialog error:", e);
    return null;
  }
}

/**
 * Open a native file-picker dialog.
 * Returns the selected file path, or null if cancelled.
 */
export async function openFileDialog(): Promise<string | null> {
  const dialog = await getDialog();
  if (!dialog) {
    console.warn("[nativeDialogs] Not in Tauri — file dialog unavailable");
    return null;
  }
  try {
    const selected = await dialog.open({
      directory: false,
      multiple: false,
      title: "Open File",
    });
    if (typeof selected === "string") return selected;
    if (Array.isArray(selected) && selected.length > 0) return selected[0];
    return null;
  } catch (e) {
    console.warn("[nativeDialogs] File dialog error:", e);
    return null;
  }
}

/**
 * Open a native save-file dialog.
 * Returns the chosen save path, or null if cancelled.
 */
export async function saveFileDialog(
  defaultPath?: string,
  filters?: { name: string; extensions: string[] }[]
): Promise<string | null> {
  const dialog = await getDialog();
  if (!dialog) {
    console.warn("[nativeDialogs] Not in Tauri — save dialog unavailable");
    return null;
  }
  try {
    const selected = await dialog.save({
      defaultPath,
      filters,
      title: "Save File",
    });
    return selected ?? null;
  } catch (e) {
    console.warn("[nativeDialogs] Save dialog error:", e);
    return null;
  }
}
