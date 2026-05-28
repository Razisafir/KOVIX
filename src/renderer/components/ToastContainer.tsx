import React, { useEffect, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Info,
  AlertTriangle,
  X,
} from "lucide-react";
import useAppStore from "../stores/useAppStore";
import type { ToastType } from "../types";

const C = {
  base: "#0c0c10", s1: "#12121a", s2: "#1a1a24", s3: "#22222e",
  accent: "#6366f1", t1: "#e8e8ec", t2: "#94949c", t3: "#6b6b73", t4: "#4a4a52",
  ok: "#10b981", wrn: "#f59e0b", err: "#ef4444", inf: "#60a5fa"
};
const ff = '"Geist Mono", "JetBrains Mono", monospace';

const toastConfig: Record<
  ToastType,
  { icon: React.ElementType; iconColor: string; borderColor: string }
> = {
  success: {
    icon: CheckCircle2,
    iconColor: C.ok,
    borderColor: "rgba(16,185,129,0.3)",
  },
  error: {
    icon: XCircle,
    iconColor: C.err,
    borderColor: "rgba(239,68,68,0.3)",
  },
  info: {
    icon: Info,
    iconColor: C.inf,
    borderColor: "rgba(96,165,250,0.3)",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: C.wrn,
    borderColor: "rgba(245,158,11,0.3)",
  },
};

const ToastItem: React.FC<{ toastId: string }> = ({ toastId }) => {
  const toast = useAppStore((s) => s.toasts.find((t) => t.id === toastId));
  const removeToast = useAppStore((s) => s.removeToast);

  const handleDismiss = useCallback(() => {
    removeToast(toastId);
  }, [toastId, removeToast]);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.duration ?? 4000;
    const timer = setTimeout(() => {
      handleDismiss();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, handleDismiss]);

  if (!toast) return null;

  const config = toastConfig[toast.type];
  const Icon = config.icon;

  return (
    <div
      style={{
        background: C.s2,
        border: `1px solid ${config.borderColor}`,
        borderRadius: "0px",
        padding: "12px",
        minWidth: "280px",
        maxWidth: "360px",
        pointerEvents: "auto",
        fontFamily: ff,
        transition: "opacity 100ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <Icon
          style={{
            width: "20px",
            height: "20px",
            color: config.iconColor,
            flexShrink: 0,
            marginTop: "2px",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: C.t1,
              lineHeight: 1.3,
              margin: 0,
            }}
          >
            {toast.title}
          </p>
          {toast.message && (
            <p
              style={{
                fontSize: "10px",
                color: C.t2,
                marginTop: "4px",
                lineHeight: 1.5,
              }}
            >
              {toast.message}
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          style={{
            flexShrink: 0,
            padding: "2px",
            borderRadius: "2px",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: C.t3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = C.t1;
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = C.t3;
            (e.currentTarget as HTMLButtonElement).style.background = "none";
          }}
        >
          <X style={{ width: "14px", height: "14px" }} />
        </button>
      </div>
    </div>
  );
};

const ToastContainer: React.FC = () => {
  const toasts = useAppStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toastId={toast.id} />
      ))}
    </div>
  );
};

export default ToastContainer;
