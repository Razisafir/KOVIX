/**
 * Command registry — all available commands in the app.
 * Each command has: id, title, icon, shortcut, category, action.
 */

export interface Command {
  id: string;
  title: string;
  description?: string;
  icon?: string; // Lucide icon name
  shortcut?: string;
  category: "agent" | "navigation" | "tools" | "system";
  keywords: string[]; // For fuzzy search
  action: () => void | Promise<void>;
  enabled?: () => boolean; // Dynamic enable/disable
}

class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private listeners: Set<() => void> = new Set();

  register(command: Command) {
    this.commands.set(command.id, command);
    this.notify();
  }

  unregister(id: string) {
    this.commands.delete(id);
    this.notify();
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  search(query: string): Command[] {
    const q = query.toLowerCase();
    return this.getAll()
      .filter((cmd) => cmd.enabled?.() !== false)
      .filter((cmd) => {
        const text = `${cmd.title} ${cmd.description || ""} ${cmd.keywords.join(" ")}`.toLowerCase();
        return text.includes(q);
      })
      .sort((a, b) => {
        // Exact match first
        const aExact = a.title.toLowerCase().startsWith(q);
        const bExact = b.title.toLowerCase().startsWith(q);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        // Then by category order
        const catOrder: Record<string, number> = { agent: 0, navigation: 1, tools: 2, system: 3 };
        const catDiff = (catOrder[a.category] ?? 99) - (catOrder[b.category] ?? 99);
        if (catDiff !== 0) return catDiff;
        return a.title.localeCompare(b.title);
      });
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}

export const registry = new CommandRegistry();

// Helper to register multiple commands
export function registerCommands(commands: Command[]) {
  commands.forEach((cmd) => registry.register(cmd));
}
