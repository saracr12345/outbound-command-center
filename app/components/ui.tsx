import Link from "next/link";

export function MetricCard({
  label,
  value,
  note,
  href,
  tone = "indigo",
}: {
  label: string;
  value: string | number;
  note?: string;
  href?: string;
  tone?: "indigo" | "blue" | "green" | "amber";
}) {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    blue: "bg-sky-50 text-sky-700 ring-sky-100",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
  };

  const content = (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
        </div>
        <span className={`rounded-xl px-2.5 py-1.5 text-[11px] font-bold ring-1 ${tones[tone]}`}>{note ?? "Live"}</span>
      </div>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "green" | "amber" | "red" | "blue" | "indigo" | "neutral";
}) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    red: "bg-rose-50 text-rose-700 ring-rose-100",
    blue: "bg-sky-50 text-sky-700 ring-sky-100",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    neutral: "bg-slate-50 text-slate-600 ring-slate-200",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${tones[tone]}`}>{children}</span>;
}

export function scoreTone(score: number | null | undefined) {
  if (typeof score !== "number") return "neutral" as const;
  if (score >= 80) return "green" as const;
  if (score >= 60) return "amber" as const;
  return "neutral" as const;
}

export function scoreLabel(score: number | null | undefined) {
  if (typeof score !== "number") return "Not analysed";
  if (score >= 80) return "Strong";
  if (score >= 60) return "Review";
  return "Low priority";
}

export function SectionCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${className}`}>{children}</section>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">✦</div>
      <p className="mt-4 font-semibold text-slate-800">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}
