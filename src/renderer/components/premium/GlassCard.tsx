import { ReactNode } from "react";
import { motion } from "framer-motion";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: "accent" | "success" | "error" | "warning" | "none";
}

export function GlassCard({ children, className = "", hover = true, glow = "none" }: GlassCardProps) {
  const glowClasses = {
    accent: "hover:shadow-[0_0_30px_rgba(137,180,250,0.15)]",
    success: "hover:shadow-[0_0_30px_rgba(166,227,161,0.15)]",
    error: "hover:shadow-[0_0_30px_rgba(243,139,168,0.15)]",
    warning: "hover:shadow-[0_0_30px_rgba(249,226,175,0.15)]",
    none: "",
  };

  return (
    <motion.div
      whileHover={hover ? { y: -2 } : undefined}
      className={`
        bg-[rgba(17,17,27,0.7)] backdrop-blur-[24px] saturate-[180%]
        border border-[rgba(255,255,255,0.05)] rounded-[20px]
        shadow-[0_8px_32px_rgba(0,0,0,0.4)]
        transition-shadow duration-300
        ${glowClasses[glow]}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}
