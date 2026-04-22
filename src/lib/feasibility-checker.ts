import type { FeasibilityResult, FloorPlanSpec, Room } from "@/lib/types";

function roomArea(room: Room) {
  const w = room.width_m;
  const l = room.length_m;
  if (typeof w !== "number" || typeof l !== "number" || isNaN(w) || isNaN(l)) {
    return NaN;
  }
  return w * l;
}

function roomMinAreaIssue(room: Room): string | null {
  const name = room.name.toLowerCase();
  const area = roomArea(room);

  if (name.includes("bed") && area < 9) {
    return `${room.name} is ${area.toFixed(2)}m2 and must be at least 9m2.`;
  }

  if (name.includes("kitchen") && area < 6) {
    return `${room.name} is ${area.toFixed(2)}m2 and must be at least 6m2.`;
  }

  if ((name.includes("bath") || name.includes("toilet")) && area < 3.5) {
    return `${room.name} is ${area.toFixed(2)}m2 and must be at least 3.5m2.`;
  }

  return null;
}

export function checkFeasibility(spec: FloorPlanSpec): FeasibilityResult {
  const issues: string[] = [];

  if (spec.plot_shape !== "rectangular") {
    issues.push(
      `v1 supports rectangular plots only. Received plot shape: ${spec.plot_shape}.`,
    );
  }

  if (spec.plot_width_m <= 0 || spec.plot_length_m <= 0) {
    issues.push("Plot dimensions must be positive numbers in meters.");
  }

  if (!Array.isArray(spec.rooms) || spec.rooms.length === 0) {
    issues.push("At least one room must be provided.");
  }

  // Auto-populate total_rooms if the AI omitted it; treat a mismatch as an
  // informational correction rather than a blocking failure.
  if (typeof spec.total_rooms !== "number" || isNaN(spec.total_rooms)) {
    spec.total_rooms = spec.rooms.length;
  } else if (spec.total_rooms !== spec.rooms.length) {
    issues.push(
      `total_rooms is ${spec.total_rooms}, but ${spec.rooms.length} rooms were provided.`,
    );
  }

  const plotArea = spec.plot_width_m * spec.plot_length_m;
  const totalRoomArea = spec.rooms.reduce((acc, room) => {
    const a = roomArea(room);
    return acc + (isNaN(a) ? 0 : a);
  }, 0);
  const maxUsableArea = plotArea * 0.85;

  if (totalRoomArea > maxUsableArea) {
    issues.push(
      `Rooms require ${totalRoomArea.toFixed(2)}m2 but maximum usable area is ${maxUsableArea.toFixed(
        2,
      )}m2 (85% of ${plotArea.toFixed(2)}m2 plot).`,
    );
  }

  for (const room of spec.rooms) {
    const area = roomArea(room);
    if (isNaN(area) || room.width_m <= 0 || room.length_m <= 0) {
      issues.push(
        `${room.name} has invalid or missing dimensions (width_m: ${room.width_m}, length_m: ${room.length_m}).`,
      );
      continue;
    }

    const issue = roomMinAreaIssue(room);
    if (issue) {
      issues.push(issue);
    }
  }

  return {
    feasible: issues.length === 0,
    issues,
  };
}
