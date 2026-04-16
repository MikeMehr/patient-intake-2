"use client";

import type { BodyPart } from "@/lib/body-parts";
import { getBodyDiagramImage } from "@/lib/body-diagram-images";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface BodyPartDiagramProps {
  bodyPart: BodyPart;
  side?: "left" | "right";
  sex?: "female" | "male";
  markers?: Array<{ xPct: number; yPct: number }>;
  onMarkerAdd?: (payload: {
    part: BodyPart;
    side?: "left" | "right";
    marker: { xPct: number; yPct: number };
  }) => void;
  onMarkersClear?: () => void;
  onMarkersDone?: () => void;
}

/**
 * Rendered bounds of the image content inside an object-contain container.
 * object-contain centres the image and leaves transparent padding on two sides
 * whenever the image and container aspect ratios differ (letterbox / pillarbox).
 * All marker coordinates are stored relative to this inner content area, not
 * the outer container, so they stay accurate across screen sizes and devices.
 */
interface ImageContentBounds {
  offsetX: number;   // px from container left edge to image content left edge
  offsetY: number;   // px from container top edge to image content top edge
  renderedW: number; // px width of the painted image content
  renderedH: number; // px height of the painted image content
}

export default function BodyPartDiagram({
  bodyPart,
  side,
  sex,
  markers = [],
  onMarkerAdd,
  onMarkersClear,
  onMarkersDone,
}: BodyPartDiagramProps) {
  const [isSaved, setIsSaved] = useState(false);
  const [imgBounds, setImgBounds] = useState<ImageContentBounds | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const image = getBodyDiagramImage(bodyPart, side, sex);

  const diagramSizeClass =
    bodyPart === "hip"
      ? "w-full max-w-96 h-80 sm:h-[28rem]"
      : "w-full max-w-96 h-56 sm:h-72";

  /**
   * Compute where the image's painted content sits inside the container.
   * Must be called after the image loads and whenever the container resizes
   * (e.g. orientation change on iPad).
   */
  const computeImageBounds = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.naturalWidth || !img.naturalHeight) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const naturalAspect = img.naturalWidth / img.naturalHeight;
    const containerAspect = cw / ch;

    let renderedW: number, renderedH: number;
    if (naturalAspect > containerAspect) {
      // Image wider than container — constrained by width (letterboxed top/bottom)
      renderedW = cw;
      renderedH = cw / naturalAspect;
    } else {
      // Image taller than container — constrained by height (pillarboxed left/right)
      renderedH = ch;
      renderedW = ch * naturalAspect;
    }

    setImgBounds({
      offsetX: (cw - renderedW) / 2,
      offsetY: (ch - renderedH) / 2,
      renderedW,
      renderedH,
    });
  }, []);

  // Recompute whenever the container is resized (handles iPad orientation changes).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(computeImageBounds);
    ro.observe(container);
    return () => ro.disconnect();
  }, [computeImageBounds]);

  const handleDiagramClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onMarkerAdd || !imgBounds) return;

    const rect = event.currentTarget.getBoundingClientRect();

    // On iOS Safari, pinch-zoom causes event.clientX/Y to be in visual-viewport
    // space while getBoundingClientRect() is in layout-viewport space.
    // window.visualViewport bridges the two frames; when not zoomed (scale=1)
    // this is a mathematical no-op.
    const vv = window.visualViewport;
    const scale = vv?.scale ?? 1;
    const vvOffsetLeft = vv?.offsetLeft ?? 0;
    const vvOffsetTop = vv?.offsetTop ?? 0;
    const layoutX = vvOffsetLeft + event.clientX / scale;
    const layoutY = vvOffsetTop + event.clientY / scale;

    // Translate click into image-content space (strips letterbox/pillarbox offset).
    const relX = layoutX - rect.left - imgBounds.offsetX;
    const relY = layoutY - rect.top - imgBounds.offsetY;

    const xPct = Math.max(0, Math.min(100, Number(((relX / imgBounds.renderedW) * 100).toFixed(1))));
    const yPct = Math.max(0, Math.min(100, Number(((relY / imgBounds.renderedH) * 100).toFixed(1))));

    setIsSaved(false);
    onMarkerAdd({ part: bodyPart, side, marker: { xPct, yPct } });
  };

  return (
    <div className="flex flex-col items-center gap-3 p-4 bg-white rounded-2xl border border-slate-200">
      <div className="text-sm font-semibold text-slate-800">
        {side ? `${side.charAt(0).toUpperCase() + side.slice(1)} ` : ""}
        {bodyPart.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
      </div>
      <div className={`relative flex items-center justify-center ${diagramSizeClass}`}>
        <div
          ref={containerRef}
          role="button"
          tabIndex={0}
          aria-label={`${image.alt}. Click to place pain markers.`}
          onClick={handleDiagramClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
            }
          }}
          className="relative h-full w-full overflow-hidden rounded-xl border border-slate-300 bg-white cursor-crosshair"
        >
          <img
            ref={imgRef}
            src={image.src}
            alt={image.alt}
            onLoad={computeImageBounds}
            className="absolute inset-0 h-full w-full object-contain"
          />
          {/* Render each marker in image-content space so it stays on the
              correct body part regardless of device or screen orientation. */}
          {imgBounds && markers.map((marker, index) => (
            <div
              key={`${marker.xPct}-${marker.yPct}-${index}`}
              className="pointer-events-none absolute text-base font-bold text-red-600 drop-shadow-sm select-none"
              style={{
                left: `${imgBounds.offsetX + (marker.xPct / 100) * imgBounds.renderedW}px`,
                top: `${imgBounds.offsetY + (marker.yPct / 100) * imgBounds.renderedH}px`,
                transform: "translate(-50%, -50%)",
              }}
            >
              X
            </div>
          ))}
        </div>
      </div>
      <div className="text-xs text-slate-600 text-center">
        Click or tap on the image to place X marks where you feel pain.
      </div>
      {markers.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-emerald-600">
            Marked: {markers.length} point{markers.length === 1 ? "" : "s"}
          </div>
          {onMarkersClear && (
            <button
              type="button"
              onClick={() => { setIsSaved(false); onMarkersClear(); }}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear marks
            </button>
          )}
          {onMarkersDone && (
            <button
              type="button"
              onClick={() => { setIsSaved(true); onMarkersDone(); }}
              className={`rounded-md px-2 py-1 text-xs font-medium text-white transition-colors ${isSaved ? "bg-slate-500 hover:bg-slate-400" : "bg-emerald-600 hover:bg-emerald-500"}`}
            >
              {isSaved ? "Saved" : "Done"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
