import { useState } from "react";

export function ProgressiveImage({
  src,
  alt,
  width,
  height,
  className = "",
  crossOrigin,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  crossOrigin?: "anonymous" | "use-credentials";
}) {
  const [loadedSource, setLoadedSource] = useState("");
  const [failedSource, setFailedSource] = useState("");
  if (failedSource === src) return null;
  return (
    <img key={src} src={src} alt={alt}
      width={width}
      height={height}
      crossOrigin={crossOrigin}
      loading="lazy"
      decoding="async"
      className={`${className} progressive-image ${loadedSource === src ? "image-loaded" : ""}`}
      onLoad={() => setLoadedSource(src)}
      onError={() => setFailedSource(src)}
    />
  );
}
