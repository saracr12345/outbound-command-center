import Link from "next/link";
import { logout } from "@/app/dashboard/actions";

export type NavKey =
  | "overview"
  | "visitors"
  | "targets"
  | "outreach"
  | "campaigns"
  | "replies"
  | "activity"
  | "integrations";

type AppShellProps = {
  active: NavKey;
  organizationName: string;
  email: string;
  role: string;
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

type IconName = NavKey;

const navItems: Array<{ key: NavKey; label: string; href: string }> = [
  { key: "overview", label: "Overview", href: "/dashboard" },
  { key: "visitors", label: "Visitors", href: "/visitors" },
  { key: "targets", label: "AI Targets", href: "/targets" },
  { key: "outreach", label: "Outreach", href: "/outreach" },
  { key: "campaigns", label: "Campaigns", href: "/campaigns" },
  { key: "replies", label: "Replies", href: "/replies" },
  { key: "activity", label: "Activity", href: "/activity" },
  { key: "integrations", label: "Integrations", href: "/integrations" },
];

function titleCase(value: string) {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 19,
    height: 19,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "overview") {
    return (
      <svg {...common}><path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" /></svg>
    );
  }
  if (name === "visitors") {
    return (
      <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
    );
  }
  if (name === "targets") {
    return (
      <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>
    );
  }
  if (name === "outreach") {
    return (
      <svg {...common}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
    );
  }
  if (name === "campaigns") {
    return (
      <svg {...common}><path d="M3 11h18M5 6h14M7 16h10M9 21h6" /></svg>
    );
  }
  if (name === "replies") {
    return (
      <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></svg>
    );
  }
  if (name === "activity") {
    return (
      <svg {...common}><path d="M3 12h4l2-7 4 14 2-7h6" /></svg>
    );
  }
  return (
    <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" /></svg>
  );
}

function BrandMark() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-sm font-black tracking-tight text-indigo-600 ring-1 ring-indigo-100">
      T3
    </div>
  );
}

export function AppShell({
  active,
  organizationName,
  email,
  role,
  title,
  eyebrow = "Outbound Command Center",
  description,
  actions,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#F7F9FC] text-[#1F2937]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[270px] border-r border-slate-200/80 bg-white px-4 py-5 lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-2">
          <BrandMark />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{organizationName}</p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Command Center</p>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          {navItems.map((item) => {
            const selected = item.key === active;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                  selected
                    ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span className={selected ? "text-indigo-600" : "text-slate-400"}><Icon name={item.key} /></span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
              {email.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-800">{email}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{titleCase(role)}</p>
            </div>
          </div>
          <form action={logout} className="mt-3">
            <button className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-indigo-200 hover:text-indigo-700">
              Log out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-[270px]">
        <div className="border-b border-slate-200/80 bg-white lg:hidden">
          <div className="flex items-center gap-3 px-4 py-4">
            <BrandMark />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{organizationName}</p>
              <p className="text-xs text-slate-400">Outbound Command Center</p>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${item.key === active ? "bg-indigo-50 text-indigo-700" : "text-slate-500"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <header className="border-b border-slate-200/70 bg-white/95 px-5 py-6 sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-[1500px] flex-col justify-between gap-5 xl:flex-row xl:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.17em] text-indigo-600">{eyebrow}</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
              {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
