"use client";

import { useMemo, useState } from "react";

type CollapsibleSectionProps = {
  id: string;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  previewText?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      className={[
        "h-5 w-5 text-slate-500 transition-transform duration-150",
        open ? "rotate-90" : "rotate-0",
      ].join(" ")}
    >
      <path
        d="M7.21 5.23a.75.75 0 0 1 1.06-.02l4.25 4.24a.75.75 0 0 1 0 1.06L8.27 14.77a.75.75 0 1 1-1.04-1.08L10.94 10 7.23 6.29a.75.75 0 0 1-.02-1.06Z"
        fill="currentColor"
      />
    </svg>
  );
}

function normalizePreviewText(value?: string) {
  const text = value?.trim() ?? "";
  if (!text) return "";
  // Keep the header single-line and avoid huge whitespace.
  return text.replace(/\s+/g, " ");
}

export default function CollapsibleSection({
  id,
  title,
  description,
  defaultOpen = false,
  previewText,
  headerRight,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const contentId = `${id}-content`;
  const buttonId = `${id}-button`;
  const preview = useMemo(() => normalizePreviewText(previewText), [previewText]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/60 px-4 py-4">
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-800">{title}</span>
              <ChevronIcon open={open} />
            </div>
            {description ? (
              <p className="text-xs text-slate-500">{description}</p>
            ) : null}
            {!open && preview ? (
              <p className="text-xs text-slate-600 truncate">{preview}</p>
            ) : null}
          </div>
          {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
        </div>
      </button>

      <div
        id={contentId}
        role="region"
        aria-labelledby={buttonId}
        className={open ? "mt-3" : "mt-3 hidden"}
      >
        {children}
      </div>
    </div>
  );
}

