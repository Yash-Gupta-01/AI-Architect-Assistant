import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fetch from "node-fetch";
import { architectSystemPrompt } from "@/lib/architect-system-prompt";

export type ChatInputMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatToolCall = {
  name: "request_floor_plan_image";
  arguments: Record<string, unknown>;
};

export type ChatReply = {
  content: string;
  toolCalls: ChatToolCall[];
  provider: ProviderName;
};

type ProviderName = "openrouter" | "gemini";

const providerPriority: ProviderName[] = ["openrouter", "gemini"];

/** How long a failed provider is deprioritised before being retried (ms). */
const PROVIDER_FAILURE_TTL_MS = 5 * 60 * 1000;
const providerFailedAt = new Map<ProviderName, number>();

function markProviderFailed(provider: ProviderName) {
  providerFailedAt.set(provider, Date.now());
}

function clearProviderFailure(provider: ProviderName) {
  providerFailedAt.delete(provider);
}

function isProviderFailed(provider: ProviderName): boolean {
  const ts = providerFailedAt.get(provider);
  if (!ts) return false;
  if (Date.now() - ts > PROVIDER_FAILURE_TTL_MS) {
    providerFailedAt.delete(provider);
    return false;
  }
  return true;
}

const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "request_floor_plan_image",
      description:
        "Signal that the floor plan spec is complete and feasible so the app can generate the image.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

function getAvailableProviders(): ProviderName[] {
  const available: ProviderName[] = [];

  if (process.env.OPENROUTER_API_KEY) {
    available.push("openrouter");
  }

  if (process.env.GEMINI_API_KEY) {
    available.push("gemini");
  }

  return available;
}

function getProviderOrder(): ProviderName[] {
  const available = getAvailableProviders();
  const explicit = process.env.AI_TEXT_PROVIDER?.trim().toLowerCase();

  let preferred: ProviderName | undefined;
  if (explicit === "openrouter" || explicit === "gemini") {
    preferred = explicit;
  }

  const ordered: ProviderName[] = [];

  if (preferred && available.includes(preferred)) {
    ordered.push(preferred);
  }

  for (const provider of providerPriority) {
    if (available.includes(provider) && !ordered.includes(provider)) {
      ordered.push(provider);
    }
  }

  // Move recently-failed providers to the end so healthy ones are tried first.
  const healthy = ordered.filter((p) => !isProviderFailed(p));
  const degraded = ordered.filter((p) => isProviderFailed(p));
  return [...healthy, ...degraded];
}

function getProvider(): ProviderName {
  const order = getProviderOrder();
  if (order.length > 0) {
    return order[0];
  }

  const explicit = process.env.AI_TEXT_PROVIDER?.trim().toLowerCase();

  if (explicit === "openrouter" || explicit === "gemini") {
    return explicit;
  }

  if (process.env.OPENROUTER_API_KEY) {
    return "openrouter";
  }

  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }

  throw new Error(
    "No text AI API key found. Set OPENROUTER_API_KEY or GEMINI_API_KEY.",
  );
}

function parseToolArguments(raw: string | undefined) {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeContent(
  content: string | null | undefined,
  toolCalls: ChatToolCall[],
) {
  const trimmed = content?.trim() ?? "";
  if (trimmed) {
    return trimmed;
  }

  return toolCalls.length
    ? "Preparing your floor plan now."
    : "I could not produce a response.";
}

function extractToolCalls(
  toolCalls: Array<{ function?: { name?: string; arguments?: string } | null } | unknown> | null | undefined,
): ChatToolCall[] {
  if (!toolCalls?.length) {
    return [];
  }

  return toolCalls
    .map((call) => {
      const fn = (call as { function?: { name?: string; arguments?: string } | null })
        ?.function;
      const name = fn?.name;
      if (name !== "request_floor_plan_image") {
        return null;
      }

      return {
        name,
        arguments: parseToolArguments(fn?.arguments),
      } as ChatToolCall;
    })
    .filter((call): call is ChatToolCall => Boolean(call));
}

/**
 * Check the reply text itself for signals that image generation should happen.
 * Works as a universal fallback when tool calling is not supported or fails.
 */
function extractTextBasedToolTrigger(text: string): ChatToolCall[] {
  // Check for the explicit fallback marker
  if (text.includes("READY_FOR_IMAGE_GENERATION")) {
    return [{ name: "request_floor_plan_image", arguments: {} }];
  }
  return [];
}

async function generateWithGemini(messages: ChatInputMessage[]): Promise<ChatReply> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY for Gemini text provider.");
  }

  const modelName = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.0-flash";
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // Pass tool (function) declarations so Gemini can trigger image generation
  const geminiTools = [
    {
      functionDeclarations: [
        {
          name: "request_floor_plan_image",
          description:
            "Signal that the floor plan spec is complete and feasible so the app can generate the image.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {},
          },
        },
      ],
    },
  ];

  const model = client.getGenerativeModel({
    model: modelName,
    tools: geminiTools,
    systemInstruction: architectSystemPrompt,
  });

  // Build Gemini-style contents array from chat messages
  const contents = messages.map((message) => ({
    role: message.role === "user" ? "user" : ("model" as const),
    parts: [{ text: message.content }],
  }));

  const response = await model.generateContent({ contents });
  const candidate = response.response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  // Extract text content from response parts
  const textParts = parts
    .filter(
      (part: { text?: string }) => typeof part.text === "string",
    )
    .map((part: { text?: string }) => part.text!.trim())
    .filter(Boolean);
  const content = textParts.join("\n\n");

  // Extract function calls from Gemini response parts
  const toolCalls: ChatToolCall[] = [];
  for (const part of parts) {
    const fc = (
      part as {
        functionCall?: { name?: string; args?: Record<string, unknown> };
      }
    ).functionCall;
    if (fc?.name === "request_floor_plan_image") {
      toolCalls.push({
        name: "request_floor_plan_image",
        arguments: fc.args ?? {},
      });
    }
  }

  // Also check text-based fallback trigger
  if (toolCalls.length === 0) {
    toolCalls.push(...extractTextBasedToolTrigger(content));
  }

  return {
    content: normalizeContent(content, toolCalls),
    toolCalls,
    provider: "gemini",
  };
}

export async function generateArchitectChatReply(
  messages: ChatInputMessage[],
): Promise<ChatReply> {
  const providerOrder = getProviderOrder();

  if (providerOrder.length === 0) {
    throw new Error(
      "No text AI API key found. Set OPENROUTER_API_KEY or GEMINI_API_KEY.",
    );
  }

  const failures: string[] = [];

  for (const provider of providerOrder) {
    try {
      let result: ChatReply;
      if (provider === "gemini") {
        result = await generateWithGemini(messages);
      } else {
        result = await generateWithOpenRouter(messages);
      }
      clearProviderFailure(provider);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${provider}: ${message}`);
      markProviderFailed(provider);
      console.warn(`[ai-text-provider] ${provider} failed (will deprioritise for ${PROVIDER_FAILURE_TTL_MS / 60000} min), trying next provider:`, message);
    }
  }

  throw new Error(`All text providers failed. ${failures.join(" | ")}`);
}

async function generateWithOpenRouter(messages: ChatInputMessage[]): Promise<ChatReply> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY for OpenRouter text provider.");
  }

  const model =
    process.env.OPENROUTER_TEXT_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free";

  let res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: architectSystemPrompt },
        ...messages,
      ],
      tools: toolDefinitions,
      tool_choice: "auto",
    }),
  });

  // If the model doesn't support tools (400), fall back to plain chat
  if (res.status === 400) {
    const errText = await res.text();
    console.warn(
      "[ai-text-provider] OpenRouter model does not support tools, falling back to plain chat:",
      errText,
    );
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: architectSystemPrompt },
          ...messages,
        ],
      }),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter request failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: {
        content?: string | null;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
  };

  const message = data.choices[0]?.message;
  let toolCalls = extractToolCalls(message?.tool_calls);

  // Fallback: check text content for trigger if no tool calls detected
  if (toolCalls.length === 0 && message?.content) {
    toolCalls = extractTextBasedToolTrigger(message.content);
  }

  return {
    content: normalizeContent(message?.content, toolCalls),
    toolCalls,
    provider: "openrouter",
  };
}

/**
 * Ask the AI to produce ONLY the FloorPlanSpec JSON from the conversation.
 * Used as a fallback when the model fires request_floor_plan_image without
 * including the spec JSON block in its response text.
 */
export async function generateSpecJson(messages: ChatInputMessage[]): Promise<string> {
  const specPrompt: ChatInputMessage[] = [
    ...messages,
    {
      role: "user",
      content:
        "Output ONLY the FloorPlanSpec as a JSON code block (```json ... ```) — no other text.\n" +
        "CRITICAL: every room MUST have explicit width_m and length_m as positive numbers. Do NOT use area_m2 — derive width_m and length_m from the desired area.\n" +
        "Required top-level fields: plot_width_m, plot_length_m, plot_shape, orientation, total_rooms, circulation, entry_point, style_notes.\n" +
        "Required per-room fields: name, width_m (number > 0), length_m (number > 0), min_area_m2, adjacencies (array), door_side (north/south/east/west), window_sides (array), notes.",
    },
  ];

  const providerOrder = getProviderOrder();
  if (providerOrder.length === 0) {
    throw new Error(
      "No text AI API key found. Set OPENROUTER_API_KEY or GEMINI_API_KEY.",
    );
  }

  const failures: string[] = [];

  for (const provider of providerOrder) {
    try {
      if (provider === "gemini") {
        if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
        const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = client.getGenerativeModel({
          model: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.0-flash",
        });
        const contents = specPrompt.map((m) => ({
          role: m.role === "user" ? "user" : ("model" as const),
          parts: [{ text: m.content }],
        }));
        const result = await model.generateContent({ contents });
        const text = result.response.text();
        clearProviderFailure(provider);
        return text;
      }

      if (!process.env.OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY for OpenRouter text provider.");

      const specModel = process.env.OPENROUTER_TEXT_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free";

      const specRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: specModel,
          temperature: 0,
          messages: [
            { role: "system", content: architectSystemPrompt },
            ...specPrompt,
          ],
        }),
      });

      if (!specRes.ok) {
        const errText = await specRes.text();
        throw new Error(`OpenRouter spec request failed: ${specRes.status} ${errText}`);
      }

      const specData = (await specRes.json()) as {
        choices: Array<{ message: { content?: string | null } }>;
      };

      clearProviderFailure(provider);
      return specData.choices[0]?.message?.content ?? "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${provider}: ${message}`);
      markProviderFailed(provider);
      console.warn(`[ai-text-provider] spec extraction with ${provider} failed (will deprioritise for ${PROVIDER_FAILURE_TTL_MS / 60000} min), trying next provider:`, message);
    }
  }

  throw new Error(`All spec extraction providers failed. ${failures.join(" | ")}`);
}

