import ReactMarkdown from "react-markdown";
import type { ConversationPhase, Message } from "@/lib/types";

type Props = {
  messages: Message[];
  phase: ConversationPhase;
  loadingText?: string;
};

function bubbleClass(role: Message["role"]) {
  if (role === "user") {
    return "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-slate-900 px-4 py-3 text-sm text-white";
  }

  if (role === "assistant_error") {
    return "max-w-[95%] rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900";
  }

  return "max-w-[95%] rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800";
}

export function ConversationThread({ messages, loadingText, phase }: Props) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto pr-1">
      {messages.map((message) => (
        <article key={message.id} className={bubbleClass(message.role)}>
          {message.role === "assistant_chat" && (
            <div className="prose prose-sm max-w-none prose-p:my-1">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}

          {message.role === "assistant_spec" && (
            <details className="group">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600 group-open:mb-2">
                Extracted floor plan specification
              </summary>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                {message.content}
              </pre>
            </details>
          )}

          {message.role === "assistant_image" && message.imageUrl && (
            <img
              src={message.imageUrl}
              alt="Generated floor plan"
              className="w-full rounded-lg border border-slate-200"
            />
          )}

          {(message.role === "assistant_error" || message.role === "user") && (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}
        </article>
      ))}

      {loadingText && (
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-teal-500" />
          {loadingText}
        </div>
      )}

      <p className="text-xs text-slate-500">Current phase: {phase}</p>
    </div>
  );
}
