"use client";

import { useEffect, useReducer, useState , useRef } from "react";
import { ConversationThread } from "@/components/ConversationThread";
import { FloorPlanResult } from "@/components/FloorPlanResult";
import { InputBar } from "@/components/InputBar";
import { PhaseIndicator } from "@/components/PhaseIndicator";
import type { ConversationPhase, FloorPlanSpec, Message } from "@/lib/types";

type AppState = {
  messages: Message[];
  phase: ConversationPhase;
  spec?: FloorPlanSpec;
  imageUrl?: string;
  promptUsed?: string;
  isLoading: boolean;
  isGenerating: boolean;
  hasGeneratedOnce: boolean;
  generationFailed: boolean;
};

type Action =
  | { type: "LOAD_STATE"; payload: Partial<AppState> }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_GENERATING"; payload: boolean }
  | { type: "SET_PHASE"; payload: ConversationPhase }
  | { type: "ADD_MESSAGE"; payload: Message }
  | { type: "SET_SPEC"; payload?: FloorPlanSpec }
  | {
      type: "SET_RESULT";
      payload: { imageUrl: string; promptUsed: string; spec: FloorPlanSpec };
    }
  | { type: "RESET_FOR_ADJUST" }
  | { type: "SET_GENERATION_FAILED"; payload: boolean };

const LOCAL_STORAGE_KEY = "architect-assistant-v1";

const initialState: AppState = {
  messages: [
    {
      id: crypto.randomUUID(),
      role: "assistant_chat",
      content:
        "Tell me about your plot. I will guide you through intake, feasibility, and floor-plan generation.",
      createdAt: new Date().toISOString(),
    },
  ],
  phase: "intake",
  isLoading: false,
  isGenerating: false,
  hasGeneratedOnce: false,
  generationFailed: false,
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "LOAD_STATE":
      return {
        ...state,
        ...action.payload,
      };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_GENERATING":
      return { ...state, isGenerating: action.payload };
    case "SET_PHASE":
      return { ...state, phase: action.payload };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.payload] };
    case "SET_SPEC":
      return { ...state, spec: action.payload };
    case "SET_RESULT":
      return {
        ...state,
        imageUrl: action.payload.imageUrl,
        promptUsed: action.payload.promptUsed,
        spec: action.payload.spec,
        hasGeneratedOnce: true,
        phase: "done",
        generationFailed: false,
      };
    case "SET_GENERATION_FAILED":
      return { ...state, generationFailed: action.payload };
    case "RESET_FOR_ADJUST":
      return {
        ...state,
        phase: "intake",
        imageUrl: undefined,
        promptUsed: undefined,
        isGenerating: false,
      };
    default:
      return state;
  }
}

function toApiMessages(messages: Message[]) {
  return messages
    .filter((m) => m.role !== "assistant_image")
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));
}

function loadingLabel(phase: ConversationPhase) {
  if (phase === "feasibility") {
    return "Checking if your plan fits...";
  }

  if (phase === "generating") {
    return "Drawing your floor plan... (30-60s)";
  }

  return "Thinking like an architect...";
}

export default function Home() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [draft, setDraft] = useState("");

  // Refs to avoid stale closures in async callbacks after awaits.
  const latestMessagesRef = useRef<Message[]>(state.messages);
  const generationFailedRef = useRef(false);

  // Keep refs in sync on every render (runs synchronously before any paint).
  latestMessagesRef.current = state.messages;
  generationFailedRef.current = state.generationFailed;

  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as Partial<AppState>;
      dispatch({ type: "LOAD_STATE", payload: parsed });
    } catch {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        messages: state.messages,
        phase: state.phase,
        spec: state.spec,
        imageUrl: state.imageUrl,
        promptUsed: state.promptUsed,
        hasGeneratedOnce: state.hasGeneratedOnce,
      }),
    );
  }, [state]);

  async function generatePlan(spec: FloorPlanSpec, isAutoRetry = false): Promise<string[]> {
    dispatch({ type: "SET_GENERATING", payload: true });
    dispatch({ type: "SET_PHASE", payload: "generating" });

    try {
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });

      const payload = await res.json();
      if (!res.ok) {
        const msg = payload?.error ?? "Failed to generate floor plan image.";
        const issues: string[] = Array.isArray(payload?.issues) ? payload.issues : [];
        console.error("[client] /api/generate-plan failed", {
          status: res.status,
          payload,
        });
        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            id: crypto.randomUUID(),
            role: "assistant_error",
            content: issues.length ? `${msg}\n${issues.join("\n")}` : msg,
            createdAt: new Date().toISOString(),
          },
        });
        dispatch({ type: "SET_GENERATION_FAILED", payload: true });
        dispatch({ type: "SET_PHASE", payload: "feasibility" });
        // Auto-feed the error back to the AI so it can suggest a fix without user input.
        // Guard: skip on auto-retry to prevent recursive loops.
        if (!isAutoRetry && issues.length) {
          await sendFeasibilityFeedback(issues);
        }
        return issues;
      }

      dispatch({
        type: "SET_RESULT",
        payload: {
          imageUrl: payload.imageUrl,
          promptUsed: payload.promptUsed,
          spec,
        },
      });

      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          id: crypto.randomUUID(),
          role: "assistant_image",
          content: "Floor plan generated successfully.",
          createdAt: new Date().toISOString(),
          imageUrl: payload.imageUrl,
        },
      });

      return [];
    } catch (error) {
      console.error("[client] network error while generating floor plan", error);
      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          id: crypto.randomUUID(),
          role: "assistant_error",
          content: "Network error while generating the floor plan image.",
          createdAt: new Date().toISOString(),
        },
      });
      dispatch({ type: "SET_GENERATION_FAILED", payload: true });
      dispatch({ type: "SET_PHASE", payload: "feasibility" });
      return [];
    } finally {
      dispatch({ type: "SET_GENERATING", payload: false });
    }
  }

  /**
   * Automatically send feasibility issues back to the AI chat so it can
   * suggest a corrected spec without requiring the user to type anything.
   * If the AI responds with a corrected spec, triggers one generation attempt.
   */
  async function sendFeasibilityFeedback(issues: string[]) {
    const feedbackContent =
      `The floor plan failed feasibility checks:\n` +
      issues.map((i) => `- ${i}`).join("\n") +
      `\nPlease identify the problems and suggest a corrected floor plan spec.`;

    const feedbackMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: feedbackContent,
      createdAt: new Date().toISOString(),
    };

    dispatch({ type: "ADD_MESSAGE", payload: feedbackMsg });
    dispatch({ type: "SET_LOADING", payload: true });

    try {
      // latestMessagesRef.current is updated on every render; after the dispatches
      // inside generatePlan resolved React will have re-rendered, so the ref
      // contains the error message that was just added.
      const messagesForApi = toApiMessages([...latestMessagesRef.current, feedbackMsg]);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesForApi, phase: "feasibility" }),
      });

      const payload = await res.json();
      if (!res.ok) return;

      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          id: crypto.randomUUID(),
          role: "assistant_chat",
          content: payload.reply,
          createdAt: new Date().toISOString(),
        },
      });

      if (payload.newPhase) {
        dispatch({ type: "SET_PHASE", payload: payload.newPhase });
      }

      if (payload.spec) {
        dispatch({ type: "SET_SPEC", payload: payload.spec });
        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            id: crypto.randomUUID(),
            role: "assistant_spec",
            content: JSON.stringify(payload.spec, null, 2),
            createdAt: new Date().toISOString(),
            spec: payload.spec,
          },
        });

        // Trigger a single auto-retry generation regardless of whether the AI
        // re-called the tool — this is the fix for the "floor plan result doesn't
        // update" issue where the AI provides a corrected spec but doesn't
        // explicitly re-invoke request_floor_plan_image.
        await generatePlan(payload.spec, true /* isAutoRetry */);
      }
    } catch (err) {
      console.error("[client] sendFeasibilityFeedback chat call failed", err);
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }

  async function handleSend(value: string) {
    const trimmed = value.trim();
    if (!trimmed || state.isLoading || state.isGenerating) {
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...state.messages, userMessage];

    dispatch({ type: "ADD_MESSAGE", payload: userMessage });
    dispatch({ type: "SET_LOADING", payload: true });
    setDraft("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: toApiMessages(nextMessages),
          phase: state.phase,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            id: crypto.randomUUID(),
            role: "assistant_error",
            content: payload?.error ?? "Unable to process your request.",
            createdAt: new Date().toISOString(),
          },
        });
        return;
      }

      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          id: crypto.randomUUID(),
          role: "assistant_chat",
          content: payload.reply,
          createdAt: new Date().toISOString(),
        },
      });

      if (payload.newPhase) {
        dispatch({ type: "SET_PHASE", payload: payload.newPhase });
      }

      if (payload.spec) {
        dispatch({ type: "SET_SPEC", payload: payload.spec });
        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            id: crypto.randomUUID(),
            role: "assistant_spec",
            content: JSON.stringify(payload.spec, null, 2),
            createdAt: new Date().toISOString(),
            spec: payload.spec,
          },
        });
      }

      // Trigger generation when AI calls the image tool (normal path) OR when
      // a previous generation failed and the AI now returns a corrected spec
      // without explicitly re-calling the tool (fixes the "doesn't update" bug).
      const shouldGenerate =
        (payload.newPhase === "generating" || generationFailedRef.current) && payload.spec;

      if (shouldGenerate) {
        await generatePlan(payload.spec);
      }
    } catch {
      dispatch({
        type: "ADD_MESSAGE",
        payload: {
          id: crypto.randomUUID(),
          role: "assistant_error",
          content: "Network error while contacting the architect assistant.",
          createdAt: new Date().toISOString(),
        },
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }

  function handleAdjustPlan() {
    if (state.spec) {
      setDraft(
        `Adjust this plan:\n${JSON.stringify(
          state.spec,
          null,
          2,
        )}\n\nPlease ask me only the missing details and then regenerate.`,
      );
    }
    dispatch({ type: "RESET_FOR_ADJUST" });
  }

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_20%_10%,#e6f5f3_0%,#f8fbfd_45%,#f4f0e6_100%)] px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <header className="rounded-2xl border border-slate-200/70 bg-white/85 p-5 shadow-sm backdrop-blur">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            AI Architect Assistant
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Intake, feasibility checks, and floor plan generation for single-storey
            homes.
          </p>
          <div className="mt-4">
            <PhaseIndicator phase={state.phase} />
          </div>
        </header>

        <main className="grid gap-4 lg:grid-cols-5">
          <section className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm lg:col-span-3">
            <ConversationThread
              messages={state.messages}
              loadingText={
                state.isLoading || state.isGenerating
                  ? loadingLabel(state.phase)
                  : undefined
              }
              phase={state.phase}
            />
            <div className="mt-4 border-t border-slate-200 pt-4">
              <InputBar
                value={draft}
                onChange={setDraft}
                onSend={handleSend}
                disabled={state.isLoading || state.isGenerating}
              />
            </div>
          </section>

          <aside className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm lg:col-span-2">
            <FloorPlanResult
              spec={state.spec}
              imageUrl={state.imageUrl}
              promptUsed={state.promptUsed}
              onRegenerate={state.spec ? () => generatePlan(state.spec!) : undefined}
              onAdjust={state.spec ? handleAdjustPlan : undefined}
              isGenerating={state.isGenerating}
            />
          </aside>
        </main>
      </div>
    </div>
  );
}
