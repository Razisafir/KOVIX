import { motion } from "framer-motion";

interface StatusBadgeProps {
  status: "active" | "idle" | "error" | "warning" | "connected" | "disconnected";
  text?: string;
  pulse?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  text,
  pulse = true,
  className = "",
}: StatusBadgeProps) {
  const statusConfig = {
    active: {
      color: "#a6e3a1",
      bg: "rgba(166,227,161,0.12)",
      border: "rgba(166,227,161,0.25)",
      label: text || "Active",
    },
    connected: {
      color: "#a6e3a1",
      bg: "rgba(166,227,161,0.12)",
      border: "rgba(166,227,161,0.25)",
      label: text || "Connected",
    },
    idle: {
      color: "#6c7086",
      bg: "rgba(108,112,134,0.12)",
      border: "rgba(108,112,134,0.25)",
      label: text || "Idle",
    },
    disconnected: {
      color: "#6c7086",
      bg: "rgba(108,112,134,0.12)",
      border: "rgba(108,112,134,0.25)",
      label: text || "Disconnected",
    },
    error: {
      color: "#f38ba8",
      bg: "rgba(243,139,168,0.12)",
      border: "rgba(243,139,168,0.25)",
      label: text || "Error",
    },
    warning: {
      color: "#f9e2af",
      bg: "rgba(249,226,175,0.12)",
      border: "rgba(249,226,175,0.25)",
      label: text || "Warning",
    },
  };

  const config = statusConfig[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${className}`}
      style={{
        backgroundColor: config.bg,
        borderColor: config.border,
        color: config.color,
      }}
    >
      <span className="relative flex h-1.5 w-1.5">
        {pulse && (
          <motion.span
            className="absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: config.color }}
            animate={{ scale: [1, 2], opacity: [0.75, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span
          className="relative inline-flex rounded-full h-1.5 w-1.5"
          style={{ backgroundColor: config.color }}
        />
      </span>
      {config.label}
    </span>
  );
}
