"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Bounds {
  offsetX: number;
  offsetY: number;
  renderedW: number;
  renderedH: number;
}

interface DiagramViewerProps {
  imageSrc: string;
  imageAlt: string;
  markers: Array<{ xPct: number; yPct: number }>;
}

export default function DiagramViewer({ imageSrc, imageAlt, markers }: DiagramViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);

  const computeBounds = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.naturalWidth || !img.naturalHeight) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw || !ch) return; // container not yet visible (e.g. inside closed <details>)
    const naturalAspect = img.naturalWidth / img.naturalHeight;
    const containerAspect = cw / ch;
    let renderedW: number, renderedH: number;
    if (naturalAspect > containerAspect) {
      renderedW = cw;
      renderedH = cw / naturalAspect;
    } else {
      renderedH = ch;
      renderedW = ch * naturalAspect;
    }
    setBounds({
      offsetX: (cw - renderedW) / 2,
      offsetY: (ch - renderedH) / 2,
      renderedW,
      renderedH,
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(computeBounds);
    ro.observe(container);
    return () => ro.disconnect();
  }, [computeBounds]);

  return (
    <div
      ref={containerRef}
      className="relative mt-2 h-72 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white"
    >
      <img
        ref={imgRef}
        src={imageSrc}
        alt={imageAlt}
        onLoad={computeBounds}
        className="absolute inset-0 h-full w-full object-contain"
      />
      {bounds && markers.map((marker, markerIndex) => (
        <div
          key={`${marker.xPct}-${marker.yPct}-${markerIndex}`}
          className="pointer-events-none absolute text-base font-bold text-red-600 drop-shadow-sm"
          style={{
            left: `${bounds.offsetX + (marker.xPct / 100) * bounds.renderedW}px`,
            top: `${bounds.offsetY + (marker.yPct / 100) * bounds.renderedH}px`,
            transform: "translate(-50%, -50%)",
          }}
        >
          X
        </div>
      ))}
    </div>
  );
}
