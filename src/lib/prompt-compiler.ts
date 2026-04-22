import type { FloorPlanSpec } from "@/lib/types";

export function compileFloorPlanPrompt(spec: FloorPlanSpec): string {
  const roomsText = spec.rooms
    .map((room) => `${room.name} ${room.width_m}m x ${room.length_m}m ${room.notes}`)
    .join(", ");

  const basePrompt = `Architectural floor plan drawing. Top-down orthographic view. Black line drawing on pure white background. Blueprint/technical drawing style. Scale: 1:100. No furniture, no people, no shading except thin hatch marks on walls. Walls are 200mm thick lines. All dimensions labeled in meters. Room names labeled in clean sans-serif. Doors shown as thin arc sweep. Windows shown as thin parallel lines on wall segments. North arrow in top-right corner. Title block bottom-right with plot size. Plot size: ${spec.plot_width_m}m x ${spec.plot_length_m}m. Rooms: ${roomsText}. Entry on ${spec.entry_point} wall. ${spec.circulation}. Style: ${spec.style_notes}.`;

  const negativePrompt =
    "No perspective, no 3D, no shadows, no furniture, no people, no color fills, no artistic interpretation, no isometric view.";

  return `${basePrompt} ${negativePrompt}`;
}
