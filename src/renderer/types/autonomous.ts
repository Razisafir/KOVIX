export type AutonomousStatus =
  | "disabled"
  | "idle"
  | "running"
  | "paused"
  | "throttled"
  | "error";

export interface AutonomousState {
  status: AutonomousStatus;
  enabled: boolean;
  current_goal: string | null;
  progress_percent: number;
  queue_size: number;
  checkpoints_saved: number;
  tasks_completed: number;
  started_at: number | null;
  last_checkpoint_at: number | null;
  resource_cpu: number;
  resource_memory: number;
}

export interface LogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
  source: string;
}

export interface SafetySetting {
  id: string;
  label: string;
  enabled: boolean;
  description: string;
}

export type GoalPriority = "critical" | "high" | "normal" | "low";

export interface QueuedGoal {
  id: string;
  description: string;
  priority: GoalPriority;
  status: string;
  progress_percent: number;
  deadline?: number;
}
