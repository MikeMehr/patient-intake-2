"use client";

import type { BodyPart } from "@/lib/body-parts";
import { getBodyDiagramImage } from "@/lib/body-diagram-images";
import type { MouseEvent } from "react";
import { useState } from "react";

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
  const image = getBodyDiagramImage(bodyPart, side, sex);
  const diagramSizeClass = "w-full max-w-96 aspect-square";

  const handleDiagramClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onMarkerAdd) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const xPct = Math.max(0, Math.min(100, Number(x.toFixed(1))));
    const yPct = Math.max(0, Math.min(100, Number(y.toFixed(1))));
    setIsSaved(false);
    onMarkerAdd({
      part: bodyPart,
      side,
      marker: { xPct, yPct },
    });
  };

  return (
    <div className="flex flex-col items-center gap-3 p-4 bg-white rounded-2xl border border-slate-200">
      <div className="text-sm font-semibold text-slate-800">
        {side ? `${side.charAt(0).toUpperCase() + side.slice(1)} ` : ""}
        {bodyPart.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
      </div>
      <div className={`relative flex items-center justify-center ${diagramSizeClass}`}>
        <div
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
          <img src={image.src} alt={image.alt} className="absolute inset-0 h-full w-full object-contain" />
          {markers.map((marker, index) => (
            <div
              key={`${marker.xPct}-${marker.yPct}-${index}`}
              className="pointer-events-none absolute text-base font-bold text-red-600 drop-shadow-sm"
              style={{
                left: `${marker.xPct}%`,
                top: `${marker.yPct}%`,
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
