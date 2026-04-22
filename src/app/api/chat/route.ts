import {
  generateArchitectChatReply,
  generateSpecJson,
  type ChatInputMessage,
} from "@/lib/ai-text-provider";
import type { ConversationPhase, FloorPlanSpec } from "@/lib/types";

export const runtime = "nodejs";

type ChatRequest = {
  messages: ChatInputMessage[];
  phase: ConversationPhase;
};

function normalizeSpec(value: unknown): FloorPlanSpec | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as FloorPlanSpec;
  if (
    typeof candidate.plot_width_m !== "number" ||
    typeof candidate.plot_length_m !== "number" ||
    !Array.isArray(candidate.rooms) ||
    candidate.rooms.length === 0
  ) {
    return undefined;
  }

  // Reject specs where rooms lack explicit width_m/length_m dimensions.
  // These are incomplete "summary" specs the AI sometimes returns (using area_m2
  // instead); rejecting them forces the route to call generateSpecJson for a
  // properly structured spec.
  const allRoomsHaveDimensions = candidate.rooms.every(
    (r) =>
      typeof (r as { width_m?: unknown }).width_m === "number" &&
      (r as { width_m: number }).width_m > 0 &&
      typeof (r as { length_m?: unknown }).length_m === "number" &&
      (r as { length_m: number }).length_m > 0,
  );
  if (!allRoomsHaveDimensions) {
    return undefined;
  }

  // Auto-populate total_rooms if the AI omitted it.
  if (typeof candidate.total_rooms !== "number") {
    candidate.total_rooms = candidate.rooms.length;
  }

  return candidate;
}

function extractFirstJsonBlock(text: string): FloorPlanSpec | undefined {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      return normalizeSpec(JSON.parse(fencedMatch[1]));
    } catch {
      // Continue with fallback parser.
    }
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    try {
      return normalizeSpec(JSON.parse(objectMatch[0]));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Strip the READY_FOR_IMAGE_GENERATION fallback marker from the reply text
 * so users never see it in the chat.
 */
function cleanReplyText(text: string): string {
  return text
    .replace(/READY_FOR_IMAGE_GENERATION/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    if (!Array.isArray(body.messages) || !body.phase) {
      return Response.json(
        { error: "Invalid request. Expected messages and phase." },
        { status: 400 },
      );
    }

    const { content: rawReply, toolCalls, provider } =
      await generateArchitectChatReply(body.messages);

    const reply = cleanReplyText(rawReply);

    // First try to extract spec from the current reply
    let spec = extractFirstJsonBlock(rawReply);

    const hasImageToolCall = toolCalls.some(
      (call) => call.name === "request_floor_plan_image",
    );

    // If we have a tool call but no spec in the current reply, do a dedicated fresh
    // spec-extraction call. We intentionally do NOT fall back to history here because
    // history may contain an older, already-failed spec that would cause repeated failures.
    if (hasImageToolCall && !spec) {
      console.log("[chat] Tool call detected but no spec in reply. Requesting fresh spec extraction...");
      try {
        const specJson = await generateSpecJson(body.messages);
        spec = extractFirstJsonBlock(specJson);
        console.log("[chat] Spec extraction result:", specJson.substring(0, 200));
      } catch (specError) {
        console.error("[chat] Failed to extract spec:", specError);
      }
    }

    console.log(
      "[chat] provider=%s toolCalls=%d hasSpec=%s hasImageToolCall=%s phase=%s",
      provider,
      toolCalls.length,
      !!spec,
      hasImageToolCall,
      body.phase,
    );

    let newPhase: ConversationPhase = body.phase;
    if (spec && body.phase === "intake") {
      newPhase = "feasibility";
    }
    if (hasImageToolCall && spec) {
      newPhase = "generating";
    }

    return Response.json({
      reply,
      newPhase,
      spec,
    });
  } catch (error) {
    console.error("[chat] error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected error while processing the architect chat request.";

    return Response.json(
      { error: message },
      { status: 500 },
    );
  }
}
