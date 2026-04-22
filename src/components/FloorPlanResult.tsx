import type { FloorPlanSpec } from "@/lib/types";

type Props = {
  spec?: FloorPlanSpec;
  imageUrl?: string;
  promptUsed?: string;
  onRegenerate?: () => void;
  onAdjust?: () => void;
  isGenerating?: boolean;
};

function area(width: number, length: number) {
  return width * length;
}

export function FloorPlanResult({
  spec,
  imageUrl,
  promptUsed,
  onRegenerate,
  onAdjust,
  isGenerating,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Floor Plan Result</h2>
        <p className="text-sm text-slate-600">
          Text specification and generated plan appear here.
        </p>
      </div>

      {!spec && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          Complete intake and feasibility to generate your floor plan.
        </div>
      )}

      {spec && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-slate-200">
            <header className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Text specification
            </header>
            <div className="max-h-[420px] overflow-auto p-3">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="py-1">Room</th>
                    <th className="py-1">Dimensions</th>
                    <th className="py-1">Area</th>
                    <th className="py-1">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.rooms.map((room) => (
                    <tr key={room.name} className="border-b border-slate-100 align-top">
                      <td className="py-1 pr-2 font-medium text-slate-800">{room.name}</td>
                      <td className="py-1 pr-2 text-slate-700">
                        {room.width_m}m x {room.length_m}m
                      </td>
                      <td className="py-1 pr-2 text-slate-700">
                        {area(room.width_m, room.length_m).toFixed(2)}m2
                      </td>
                      <td className="py-1 text-slate-700">{room.notes || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200">
            <header className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Generated image
            </header>
            <div className="p-3">
              {imageUrl ? (
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <img
                      src={imageUrl}
                      alt="Generated floor plan"
                      className="h-auto w-full transition duration-300 hover:scale-[1.06]"
                    />
                  </div>
                  <a
                    href={imageUrl}
                    download="floor-plan.png"
                    className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Download PNG
                  </a>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No image generated yet.</p>
              )}
            </div>
          </section>
        </div>
      )}

      {spec && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRegenerate}
              disabled={!onRegenerate || isGenerating}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isGenerating ? "Generating..." : "Regenerate image"}
            </button>
            <button
              type="button"
              onClick={onAdjust}
              disabled={!onAdjust || isGenerating}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              Adjust the plan
            </button>
          </div>

          {promptUsed && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">
                Prompt used
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                {promptUsed}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
