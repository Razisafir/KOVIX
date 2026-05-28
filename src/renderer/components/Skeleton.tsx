import React from "react";

const C = {
  s2: "#1a1a24",
  s3: "#22222e",
};

interface SkeletonLineProps {
  width?: string;
  height?: string;
}

export const SkeletonLine: React.FC<SkeletonLineProps> = ({
  width = "100%",
  height = "12px",
}) => {
  return (
    <div
      style={{
        width,
        height,
        background: C.s2,
        borderRadius: "0px",
      }}
    />
  );
};

interface SkeletonBlockProps {
  width?: string;
  height?: string;
}

export const SkeletonBlock: React.FC<SkeletonBlockProps> = ({
  width = "100%",
  height = "80px",
}) => {
  return (
    <div
      style={{
        width,
        height,
        background: C.s2,
        borderRadius: "0px",
      }}
    />
  );
};

interface SkeletonCircleProps {
  size?: string;
}

export const SkeletonCircle: React.FC<SkeletonCircleProps> = ({
  size = "32px",
}) => {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: C.s2,
        borderRadius: "0px",
      }}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  lineHeight?: string;
  lastLineWidth?: string;
}

export const SkeletonText: React.FC<SkeletonTextProps> = ({
  lines = 3,
  lineHeight = "12px",
  lastLineWidth = "60%",
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine
          key={i}
          height={lineHeight}
          width={i === lines - 1 ? lastLineWidth : "100%"}
        />
      ))}
    </div>
  );
};

export const SkeletonCard: React.FC = () => {
  return (
    <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <SkeletonCircle size="32px" />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
          <SkeletonLine width="60%" height="12px" />
          <SkeletonLine width="40%" height="10px" />
        </div>
      </div>
      <SkeletonText lines={2} lineHeight="12px" lastLineWidth="80%" />
    </div>
  );
};

export default {
  Line: SkeletonLine,
  Block: SkeletonBlock,
  Circle: SkeletonCircle,
  Text: SkeletonText,
  Card: SkeletonCard,
};
