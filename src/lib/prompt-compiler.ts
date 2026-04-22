import type { FloorPlanSpec } from "@/lib/types";

export function compileFloorPlanPrompt(spec: FloorPlanSpec): string {
  const rooms = spec.rooms
    .map((r) => `${r.name}(${r.width_m}x${r.length_m}m)`)
    .join(",");

  const parts: string[] = [
   "Floor plan blueprint. Top-down orthographic. Black lines on white. Scale 1:100.",
  "Walls 200mm with hatch marks. Dimensions in meters. Labels in sans-serif.",
  "Doors=arc sweep. Windows=parallel lines on wall. North arrow top-right. Title block bottom-right.",
  `Plot:${spec.plot_width_m}x${spec.plot_length_m}m. Entry:${spec.entry_point}.`,
  `Rooms:${rooms}.`,
  spec.style_notes ? `Style:${spec.style_notes}.` : "",
  "No 3D,furniture,shadows,color fills,people.",
  ];

  const prompt = parts.filter(Boolean).join(" ");

  // Hard cap at 800 characters to stay within image model limits.
  return prompt.length <= 800 ? prompt : prompt.slice(0, 797) + "...";
}
