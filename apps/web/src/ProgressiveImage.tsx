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
  const [loaded, setLoaded] = useState(false);
  return (
    <img src={src} alt={alt}
      width={width}
      height={height}
      crossOrigin={crossOrigin}
      loading="lazy"
      decoding="async"
      className={`${className} progressive-image ${loaded ? "image-loaded" : ""}`}
      onLoad={() => setLoaded(true)}
    />
  );
}
