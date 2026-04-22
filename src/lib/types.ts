export type ConversationPhase =
  | "intake"
  | "feasibility"
  | "generating"
  | "done";

export type CardinalSide = "north" | "south" | "east" | "west";

export interface Room {
  name: string;
  width_m: number;
  length_m: number;
  min_area_m2: number;
  adjacencies: string[];
  door_side: CardinalSide;
  window_sides: CardinalSide[];
  notes: string;
}

export interface FloorPlanSpec {
  plot_width_m: number;
  plot_length_m: number;
  plot_shape: "rectangular" | "L-shaped" | "irregular";
  orientation: string;
  total_rooms: number;
  rooms: Room[];
  circulation: string;
  entry_point: string;
  style_notes: string;
}

export type MessageRole =
  | "user"
  | "assistant_chat"
  | "assistant_spec"
  | "assistant_image"
  | "assistant_error";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  spec?: FloorPlanSpec;
  imageUrl?: string;
}

export interface FeasibilityResult {
  feasible: boolean;
  issues: string[];
}
