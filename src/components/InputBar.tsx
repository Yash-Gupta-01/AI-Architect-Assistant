import { useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => Promise<void>;
  disabled?: boolean;
};

export function InputBar({ value, onChange, onSend, disabled }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || isSubmitting || !value.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSend(value);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Describe your plot and room requirements..."
        disabled={disabled || isSubmitting}
        className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-100"
      />
      <button
        type="submit"
        disabled={disabled || isSubmitting || !value.trim()}
        className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        Send
      </button>
    </form>
  );
}
