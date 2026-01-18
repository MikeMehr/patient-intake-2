"use client";

import type { BodyPart } from "@/lib/body-parts";

interface BodyPartDiagramProps {
  bodyPart: BodyPart;
  side?: "left" | "right";
  selectedArea?: number;
  onAreaSelect?: (area: number) => void;
}

interface Area {
  x: number;
  y: number;
  label: string;
}

// Define numbered areas for each body part
const bodyPartAreas: Record<BodyPart, Area[]> = {
  wrist: [
    { x: 50, y: 15, label: "1" }, // Dorsal (back of wrist)
    { x: 50, y: 35, label: "2" }, // Palmar (palm side of wrist)
    { x: 25, y: 25, label: "3" }, // Radial (thumb side)
    { x: 75, y: 25, label: "4" }, // Ulnar (pinky side)
    { x: 50, y: 25, label: "5" }, // Center of wrist
  ],
  hand: [
    { x: 25, y: 25, label: "1" }, // Thumb
    { x: 50, y: 15, label: "2" }, // Index finger
    { x: 70, y: 20, label: "3" }, // Middle finger
    { x: 80, y: 35, label: "4" }, // Ring finger
    { x: 85, y: 50, label: "5" }, // Pinky
    { x: 50, y: 65, label: "6" }, // Palm
  ],
  elbow: [
    { x: 50, y: 15, label: "1" }, // Outer (lateral)
    { x: 50, y: 85, label: "2" }, // Inner (medial)
    { x: 25, y: 50, label: "3" }, // Front
    { x: 75, y: 50, label: "4" }, // Back
    { x: 50, y: 50, label: "5" }, // Center
  ],
  shoulder: [
    { x: 50, y: 12, label: "1" }, // Top
    { x: 25, y: 50, label: "2" }, // Front
    { x: 75, y: 50, label: "3" }, // Back
    { x: 50, y: 88, label: "4" }, // Bottom
    { x: 50, y: 50, label: "5" }, // Center
  ],
  neck: [
    { x: 50, y: 15, label: "1" }, // Front
    { x: 70, y: 50, label: "2" }, // Right side
    { x: 30, y: 50, label: "3" }, // Left side
    { x: 50, y: 85, label: "4" }, // Back
  ],
  back: [
    { x: 50, y: 12, label: "1" }, // Upper
    { x: 50, y: 50, label: "2" }, // Middle
    { x: 50, y: 88, label: "3" }, // Lower
    { x: 25, y: 50, label: "4" }, // Left side
    { x: 75, y: 50, label: "5" }, // Right side
  ],
  lower_back: [
    { x: 50, y: 25, label: "1" }, // Upper lumbar
    { x: 50, y: 75, label: "2" }, // Lower lumbar
    { x: 25, y: 50, label: "3" }, // Left side
    { x: 75, y: 50, label: "4" }, // Right side
    { x: 50, y: 50, label: "5" }, // Center
  ],
  upper_back: [
    { x: 50, y: 15, label: "1" }, // Upper thoracic
    { x: 50, y: 65, label: "2" }, // Mid thoracic
    { x: 25, y: 40, label: "3" }, // Left side
    { x: 75, y: 40, label: "4" }, // Right side
  ],
  knee: [
    { x: 50, y: 15, label: "1" }, // Front (patella)
    { x: 50, y: 85, label: "2" }, // Back
    { x: 25, y: 50, label: "3" }, // Inner (medial)
    { x: 75, y: 50, label: "4" }, // Outer (lateral)
    { x: 50, y: 50, label: "5" }, // Center
  ],
  ankle: [
    { x: 50, y: 15, label: "1" }, // Front
    { x: 50, y: 85, label: "2" }, // Back (Achilles)
    { x: 25, y: 50, label: "3" }, // Inner (medial)
    { x: 75, y: 50, label: "4" }, // Outer (lateral)
  ],
  foot: [
    { x: 30, y: 30, label: "1" }, // Heel
    { x: 50, y: 20, label: "2" }, // Arch
    { x: 70, y: 15, label: "3" }, // Ball
    { x: 80, y: 10, label: "4" }, // Toes
    { x: 50, y: 50, label: "5" }, // Top
  ],
  hip: [
    { x: 50, y: 20, label: "1" }, // Front (groin)
    { x: 50, y: 80, label: "2" }, // Back (buttock)
    { x: 30, y: 50, label: "3" }, // Side (lateral)
    { x: 50, y: 50, label: "4" }, // Center
  ],
  head: [
    { x: 50, y: 20, label: "1" }, // Forehead
    { x: 30, y: 50, label: "2" }, // Right temple
    { x: 70, y: 50, label: "3" }, // Left temple
    { x: 50, y: 80, label: "4" }, // Back of head
  ],
  chest: [
    { x: 50, y: 30, label: "1" }, // Upper chest
    { x: 50, y: 70, label: "2" }, // Lower chest
    { x: 30, y: 50, label: "3" }, // Left side
    { x: 70, y: 50, label: "4" }, // Right side
    { x: 50, y: 50, label: "5" }, // Center (sternum)
  ],
  abdomen: [
    { x: 50, y: 20, label: "1" }, // Upper abdomen
    { x: 50, y: 50, label: "2" }, // Middle abdomen
    { x: 50, y: 80, label: "3" }, // Lower abdomen
    { x: 30, y: 50, label: "4" }, // Left side
    { x: 70, y: 50, label: "5" }, // Right side
  ],
};

export default function BodyPartDiagram({
  bodyPart,
  side,
  selectedArea,
  onAreaSelect,
}: BodyPartDiagramProps) {
  const areas = bodyPartAreas[bodyPart] || [];

  const handleAreaClick = (areaNumber: number) => {
    if (onAreaSelect) {
      onAreaSelect(areaNumber);
    }
  };

  // Simple SVG representation - in a real app, you'd use more detailed anatomical diagrams
  const renderBodyPart = () => {
    const width = 200;
    const height = 200;
    const viewBox = "0 0 100 100";

    switch (bodyPart) {
      case "wrist":
        if (side === "right") {
          return (
            <div className="relative w-full h-full">
              <img
                src="/RightWristBack.svg"
                alt="Right wrist diagram (back)"
                className="absolute inset-0 h-full w-full object-contain"
              />
            </div>
          );
        }
        return (
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Forearm (top) - clearly labeled */}
            <ellipse cx="50" cy="12" rx="16" ry="12" fill="#d1d5db" stroke="#374151" strokeWidth="2" />
            <text x="50" y="7" textAnchor="middle" className="text-[10px] font-medium fill-slate-700 pointer-events-none">Forearm</text>

            {/* Wrist joint area - the main focus, larger */}
            <rect x="32" y="22" width="36" height="16" rx="8" fill="#e5e7eb" stroke="#374151" strokeWidth="2.5" />
            <text x="50" y="32" textAnchor="middle" className="text-[10px] font-medium fill-slate-700 pointer-events-none">Wrist</text>

            {/* Hand/Palm (bottom) - clearly labeled */}
            <ellipse cx="50" cy="55" rx="26" ry="20" fill="#d1d5db" stroke="#374151" strokeWidth="2" />
            <text x="50" y="78" textAnchor="middle" className="text-[10px] font-medium fill-slate-700 pointer-events-none">Hand</text>

            {/* Fingers outline - make it clear these are fingers */}
            <rect x="38" y="42" width="5" height="24" rx="2.5" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
            <rect x="46" y="40" width="5" height="26" rx="2.5" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
            <rect x="54" y="40" width="5" height="26" rx="2.5" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
            <rect x="62" y="42" width="5" height="24" rx="2.5" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
            <text x="50" y="70" textAnchor="middle" className="text-[9px] fill-slate-600 pointer-events-none">Fingers</text>

            {/* Thumb outline - clearly visible */}
            <ellipse cx="18" cy="58" rx="8" ry="12" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
            <text x="18" y="63" textAnchor="middle" className="text-[9px] fill-slate-600 pointer-events-none">Thumb</text>

            {/* Numbered areas - spread out to avoid overlap */}
            {areas.map((area, idx) => (
              <g key={idx}>
                <circle
                  cx={area.x}
                  cy={area.y}
                  r="3"
                  fill={selectedArea === idx + 1 ? "#10b981" : "#fbbf24"}
                  stroke="#374151"
                  strokeWidth="0.75"
                  className="cursor-pointer hover:opacity-80"
                  onClick={() => handleAreaClick(idx + 1)}
                />
                <text
                  x={area.x}
                  y={area.y + 2.2}
                  textAnchor="middle"
                  className="text-[4px] font-bold fill-slate-900 pointer-events-none"
                >
                  {area.label}
                </text>
              </g>
            ))}
          </svg>
        );
      case "hand":
        return (
          <svg viewBox={viewBox} className="w-full h-full">
            <path
              d="M 30 60 Q 50 50 70 60 Q 50 70 30 60"
              fill="#e5e7eb"
              stroke="#374151"
              strokeWidth="2"
            />
            <rect x="25" y="15" width="10" height="20" rx="5" fill="#e5e7eb" stroke="#374151" strokeWidth="2" />
            <rect x="40" y="10" width="8" height="25" rx="4" fill="#e5e7eb" stroke="#374151" strokeWidth="2" />
            <rect x="55" y="12" width="8" height="23" rx="4" fill="#e5e7eb" stroke="#374151" strokeWidth="2" />
            <rect x="68" y="15" width="7" height="20" rx="3" fill="#e5e7eb" stroke="#374151" strokeWidth="2" />
            <rect x="78" y="20" width="6" height="15" rx="3" fill="#e5e7eb" stroke="#374151" strokeWidth="2" />
            {areas.map((area, idx) => (
              <g key={idx}>
                <circle
                  cx={area.x}
                  cy={area.y}
                  r="2.4"
                  fill={selectedArea === idx + 1 ? "#10b981" : "#fbbf24"}
                  stroke="#374151"
                  strokeWidth="0.75"
                  className="cursor-pointer hover:opacity-80"
                  onClick={() => handleAreaClick(idx + 1)}
                />
                <text
                  x={area.x}
                  y={area.y + 1.8}
                  textAnchor="middle"
                  className="text-[4px] font-bold fill-slate-900 pointer-events-none"
                >
                  {area.label}
                </text>
              </g>
            ))}
          </svg>
        );
      default:
        // Generic shape for other body parts
        return (
          <svg viewBox={viewBox} className="w-full h-full">
            <ellipse cx="50" cy="50" rx="25" ry="35" fill="#e5e7eb" stroke="#374151" strokeWidth="2" />
            {areas.map((area, idx) => (
              <g key={idx}>
                <circle
                  cx={area.x}
                  cy={area.y}
                  r="3"
                  fill={selectedArea === idx + 1 ? "#10b981" : "#fbbf24"}
                  stroke="#374151"
                  strokeWidth="0.75"
                  className="cursor-pointer hover:opacity-80"
                  onClick={() => handleAreaClick(idx + 1)}
                />
                <text
                  x={area.x}
                  y={area.y + 2.2}
                  textAnchor="middle"
                  className="text-[4px] font-bold fill-slate-900 pointer-events-none"
                >
                  {area.label}
                </text>
              </g>
            ))}
          </svg>
        );
    }
  };

  // Determine if this body part has left/right sides
  const hasLeftRight = ["neck", "back", "lower_back", "upper_back", "chest", "abdomen", "shoulder", "elbow", "wrist", "hand", "knee", "ankle", "foot", "hip"].includes(bodyPart);
  
  return (
    <div className="flex flex-col items-center gap-3 p-4 bg-white rounded-2xl border border-slate-200">
      <div className="text-sm font-semibold text-slate-800">
        {side ? `${side.charAt(0).toUpperCase() + side.slice(1)} ` : ""}
        {bodyPart.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
      </div>
      <div className="flex items-center justify-center w-64 h-64 relative">
        {renderBodyPart()}
        {/* Add Left/Right labels on the diagram if applicable */}
        {hasLeftRight && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-between px-1">
            <div className="text-sm font-bold text-slate-700 bg-white/90 px-2 py-1 rounded-md border border-slate-300 shadow-sm" style={{ marginLeft: '-24px' }}>
              Your Left
            </div>
            <div className="text-sm font-bold text-slate-700 bg-white/90 px-2 py-1 rounded-md border border-slate-300 shadow-sm" style={{ marginRight: '-24px' }}>
              Your Right
            </div>
          </div>
        )}
      </div>
      <div className="text-xs text-slate-600 text-center">
        Click on a numbered area to indicate where you feel pain
      </div>
      {selectedArea && (
        <div className="text-sm font-medium text-emerald-600">
          Selected: Area {selectedArea}
        </div>
      )}
    </div>
  );
}

