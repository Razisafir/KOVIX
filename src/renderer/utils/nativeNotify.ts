/**
 * Native OS notifications for Construct IDE.
 *
 * Uses tauri-plugin-notification for OS-level toasts.
 * Falls back to Web Notification API → console.log.
 */

/**
 * Show a native OS notification.
 * Attempts Tauri native → Web Notification API → console fallback.
 */
export async function notify(title: string, body: string): Promise<void> {
  // 1. Try Tauri native notification
  try {
    if (typeof window !== "undefined" && (window as any).__TAURI__) {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification({ title, body });
      return;
    }
  } catch {
    // Tauri plugin not available, try Web API
  }

  // 2. Try Web Notification API
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        new Notification(title, { body });
        return;
      }
    }
  } catch {
    // Web Notification API not available
  }

  // 3. Console fallback
  console.log(`[Notification] ${title}: ${body}`);
}

/** Convenience: info-level notification */
export async function info(body: string): Promise<void> {
  return notify("Construct", body);
}

/** Convenience: success notification */
export async function success(body: string): Promise<void> {
  return notify("Construct", body);
}

/** Convenience: error notification */
export async function error(body: string): Promise<void> {
  return notify("Construct Error", body);
}

/** Convenience: agent activity notification */
export async function agent(body: string): Promise<void> {
  return notify("Construct Agent", body);
}
