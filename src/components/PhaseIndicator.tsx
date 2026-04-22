import type { ConversationPhase } from "@/lib/types";

const steps = [
  "Tell us about your plot",
  "Feasibility check",
  "Your floor plan",
] as const;

function activeIndex(phase: ConversationPhase) {
  if (phase === "intake") {
    return 0;
  }
  if (phase === "feasibility") {
    return 1;
  }
  return 2;
}

export function PhaseIndicator({ phase }: { phase: ConversationPhase }) {
  const current = activeIndex(phase);

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {steps.map((label, index) => {
        const isActive = index === current;
        const isDone = index < current;

        return (
          <div
            key={label}
            className={`rounded-lg border px-3 py-2 text-sm ${
              isActive
                ? "border-teal-500 bg-teal-50 text-teal-900"
                : isDone
                  ? "border-slate-300 bg-slate-50 text-slate-700"
                  : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <span className="font-medium">{index + 1}. </span>
            {label}
          </div>
        );
      })}
    </div>
  );
}
