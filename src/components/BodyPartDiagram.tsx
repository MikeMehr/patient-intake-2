"use client";

import type { BodyPart } from "@/lib/body-parts";
import type { MouseEvent } from "react";

interface BodyPartDiagramProps {
  bodyPart: BodyPart;
  side?: "left" | "right";
  markers?: Array<{ xPct: number; yPct: number }>;
  onMarkerAdd?: (payload: {
    part: BodyPart;
    side?: "left" | "right";
    marker: { xPct: number; yPct: number };
  }) => void;
  onMarkersClear?: () => void;
}

const getDiagramImage = (bodyPart: BodyPart, side?: "left" | "right") => {
  if (bodyPart === "foot" && side === "left") {
    return {
      src: "/Images/Sole.png",
      alt: "Left sole pain diagram",
    };
  }

  switch (bodyPart) {
    case "foot":
      return {
        src: "/Images/foot.png",
        alt: "Foot pain diagram",
      };
    case "wrist":
    case "hand":
      return {
        src: "/Images/Hand Wrist.png",
        alt: "Hand, fingers, and wrist pain diagram",
      };
    case "elbow":
      return {
        src: "/Images/Forearm Elbow.png",
        alt: "Forearm and elbow pain diagram",
      };
    case "knee":
      return {
        src: "/Images/knee.png",
        alt: "Knee pain diagram",
      };
    case "ankle":
      return {
        src: "/Images/lower leg.png",
        alt: "Lower leg and ankle pain diagram",
      };
    case "shoulder":
      return {
        src: "/Images/Shoulder.png",
        alt: "Shoulder pain diagram",
      };
    case "head":
    case "neck":
      return {
        src: "/Images/Head Face Neck.png",
        alt: "Head, face, scalp, neck, and thyroid pain diagram",
      };
    case "hip":
      return {
        src: "/Images/Hip Upper Leg.png",
        alt: "Hip and upper leg pain diagram",
      };
    case "back":
    case "upper_back":
    case "lower_back":
      return {
        src: "/Images/Thoracic Lumbar Spine.png",
        alt: "Thoracic and lumbar spine pain diagram",
      };
    case "chest":
    case "abdomen":
      return {
        src: "/Images/trunk front .png",
        alt: "Chest, breast, abdomen, and anterior neck pain diagram",
      };
    default:
      return {
        src: "/Images/ankle.png",
        alt: "Body part pain diagram",
      };
  }
};

export default function BodyPartDiagram({
  bodyPart,
  side,
  markers = [],
  onMarkerAdd,
  onMarkersClear,
}: BodyPartDiagramProps) {
  const image = getDiagramImage(bodyPart, side);
  const diagramSizeClass = "w-96 h-96";

  const handleDiagramClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onMarkerAdd) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const xPct = Math.max(0, Math.min(100, Number(x.toFixed(1))));
    const yPct = Math.max(0, Math.min(100, Number(y.toFixed(1))));
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
              onClick={onMarkersClear}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear marks
            </button>
          )}
        </div>
      )}
    </div>
  );
}
