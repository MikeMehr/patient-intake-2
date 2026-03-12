import type { BodyPart } from "@/lib/body-parts";
import { getBodyDiagramImage } from "@/lib/body-diagram-images";

export type MarkerPoint = { xPct: number; yPct: number };

export type DiagramSelectionInput = {
  part?: string;
  side?: string;
  markers?: MarkerPoint[];
};

export type BodyPartSelectionInput = {
  part?: string;
  side?: string;
};

export type DiagramSelectionForDisplay = {
  part: string;
  side?: "left" | "right";
  markers: MarkerPoint[];
};

function toDisplaySide(side: string | undefined): "left" | "right" | undefined {
  return side === "left" || side === "right" ? side : undefined;
}

function isFiniteMarker(marker: unknown): marker is MarkerPoint {
  if (!marker || typeof marker !== "object") return false;
  const value = marker as MarkerPoint;
  return (
    Number.isFinite(value.xPct) &&
    Number.isFinite(value.yPct) &&
    value.xPct >= 0 &&
    value.xPct <= 100 &&
    value.yPct >= 0 &&
    value.yPct <= 100
  );
}

export function mergeDiagramSelectionsForDisplay(args: {
  markerSelections: DiagramSelectionInput[];
  selectedParts: BodyPartSelectionInput[];
}): DiagramSelectionForDisplay[] {
  const withMarkers: DiagramSelectionForDisplay[] = [];
  const seenKeys = new Set<string>();
  // Track resolved image sources so parts that map to the same diagram
  // (e.g. "head" and "neck" both map to "Head Face Neck.png") are not duplicated.
  const seenImageSrcs = new Set<string>();

  for (const selection of args.markerSelections) {
    const part = (selection.part || "").trim();
    if (!part) continue;
    const side = toDisplaySide(selection.side);
    const markers = Array.isArray(selection.markers)
      ? selection.markers.filter(isFiniteMarker).slice(0, 30)
      : [];
    if (markers.length === 0) continue;
    const key = `${part}::${side ?? "none"}`;
    if (seenKeys.has(key)) continue;
    const imageSrc = getBodyDiagramImage(part as BodyPart, side).src;
    if (seenImageSrcs.has(imageSrc)) continue;
    seenKeys.add(key);
    seenImageSrcs.add(imageSrc);
    withMarkers.push({ part, side, markers });
  }

  for (const partSelection of args.selectedParts) {
    const part = (partSelection.part || "").trim();
    if (!part) continue;
    const side = toDisplaySide(partSelection.side);
    const key = `${part}::${side ?? "none"}`;
    if (seenKeys.has(key)) continue;
    const imageSrc = getBodyDiagramImage(part as BodyPart, side).src;
    if (seenImageSrcs.has(imageSrc)) continue;
    seenKeys.add(key);
    seenImageSrcs.add(imageSrc);
    withMarkers.push({ part, side, markers: [] });
  }

  return withMarkers;
}
