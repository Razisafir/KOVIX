import { useEffect } from "react";
import { motion } from "framer-motion";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastNotificationProps {
  type: ToastType;
  title: string;
  message?: string;
  onDismiss?: () => void;
  duration?: number;
}

export function ToastNotification({
  type,
  title,
  message,
  onDismiss,
  duration = 4000,
}: ToastNotificationProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onDismiss?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onDismiss]);

  const typeConfig = {
    success: {
      icon: <CheckCircle size={16} />,
      bg: "rgba(166,227,161,0.1)",
      border: "rgba(166,227,161,0.25)",
      iconColor: "#a6e3a1",
    },
    error: {
      icon: <AlertCircle size={16} />,
      bg: "rgba(243,139,168,0.1)",
      border: "rgba(243,139,168,0.25)",
      iconColor: "#f38ba8",
    },
    info: {
      icon: <Info size={16} />,
      bg: "rgba(137,180,250,0.1)",
      border: "rgba(137,180,250,0.25)",
      iconColor: "#89b4fa",
    },
    warning: {
      icon: <AlertTriangle size={16} />,
      bg: "rgba(249,226,175,0.1)",
      border: "rgba(249,226,175,0.25)",
      iconColor: "#f9e2af",
    },
  };

  const config = typeConfig[type];

  return (
    <motion.div
      initial={{ opacity: 0, x: 60, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className="relative flex items-start gap-3 min-w-[280px] max-w-[380px] px-4 py-3 rounded-xl border backdrop-blur-xl"
      style={{
        backgroundColor: config.bg,
        borderColor: config.border,
      }}
    >
      <div className="mt-0.5 shrink-0" style={{ color: config.iconColor }}>
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-construct-text">{title}</div>
        {message && (
          <div className="text-xs text-construct-textMuted mt-0.5">{message}</div>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 mt-0.5 text-construct-textMuted hover:text-construct-text transition-colors"
        >
          <X size={14} />
        </button>
      )}
      {/* Progress bar */}
      {duration > 0 && (
        <motion.div
          className="absolute bottom-0 left-0 h-0.5 rounded-full"
          style={{ backgroundColor: config.iconColor }}
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: duration / 1000, ease: "linear" }}
        />
      )}
    </motion.div>
  );
}
