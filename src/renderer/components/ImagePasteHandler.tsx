import { useState, useCallback, useEffect } from "react";
import { Image, X, Upload } from "lucide-react";

const C = {
  base: "#0c0c10", s1: "#12121a", s2: "#1a1a24", s3: "#22222e",
  accent: "#6366f1", t1: "#e8e8ec", t2: "#94949c", t3: "#6b6b73", t4: "#4a4a52",
  ok: "#10b981", wrn: "#f59e0b", err: "#ef4444", inf: "#60a5fa"
};
const ff = '"Geist Mono", "JetBrains Mono", monospace';

export interface PastedImage {
  id: string;
  file: File;
  preview: string;
  uploaded?: boolean;
}

interface ImagePasteHandlerProps {
  onImagesPasted: (images: PastedImage[]) => void;
  images: PastedImage[];
  onRemoveImage: (id: string) => void;
  maxImages?: number;
}

export function ImagePasteHandler({
  onImagesPasted,
  images,
  onRemoveImage,
  maxImages = 5,
}: ImagePasteHandlerProps) {
  const [isDragging, setIsDragging] = useState(false);

  // Handle paste
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const newImages: PastedImage[] = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            const id = `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            newImages.push({
              id,
              file,
              preview: URL.createObjectURL(file),
            });
          }
        }
      }

      if (newImages.length > 0) {
        onImagesPasted([...images, ...newImages].slice(0, maxImages));
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [images, onImagesPasted, maxImages]);

  // Handle drag & drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      const newImages = files.map((file) => ({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        preview: URL.createObjectURL(file),
      }));
      if (newImages.length > 0) {
        onImagesPasted([...images, ...newImages].slice(0, maxImages));
      }
    },
    [images, onImagesPasted, maxImages]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      style={{ position: "relative", fontFamily: ff }}
    >
      {/* Drop zone indicator */}
      {isDragging && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: C.s2,
            border: `1px dashed ${C.accent}`,
            borderRadius: "0px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <Upload
              size={24}
              style={{ color: C.accent, margin: "0 auto 8px auto", display: "block" }}
            />
            <span style={{ fontSize: "12px", color: C.accent }}>
              Drop images here
            </span>
          </div>
        </div>
      )}

      {/* Pasted image previews */}
      {images.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          {images.map((img) => (
            <div key={img.id} style={{ position: "relative" }}>
              <img
                src={img.preview}
                alt="Pasted"
                style={{
                  width: "64px",
                  height: "64px",
                  objectFit: "cover",
                  borderRadius: "0px",
                  border: `1px solid ${C.s3}`,
                  display: "block",
                }}
              />
              <button
                onClick={() => onRemoveImage(img.id)}
                title="Remove image"
                style={{
                  position: "absolute",
                  top: "-4px",
                  right: "-4px",
                  width: "16px",
                  height: "16px",
                  background: C.err,
                  borderRadius: "0px",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  opacity: 0,
                  transition: "opacity 100ms ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = "0";
                }}
              >
                <X size={10} style={{ color: "#fff" }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Paste hint */}
      {images.length === 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "10px",
            color: C.t3,
          }}
        >
          <Image size={10} />
          <span>Ctrl+V to paste image</span>
        </div>
      )}
    </div>
  );
}

export default ImagePasteHandler;
