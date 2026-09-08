"use client";

import { useEffect, useMemo, useState } from "react";

type Campaign = {
  id: number;
  name: string;
  status: string | null;
  progressStats?: {
    totalUsers?: number;
    totalUsersInProgress?: number;
    totalUsersPending?: number;
    totalUsersFinished?: number;
    totalUsersFailed?: number;
  } | null;
};

type Props = {
  draftId: string;
  approved: boolean;
  linkedinReady: boolean;
};

const blockedStatuses = new Set([
  "DRAFT",
  "PAUSED",
  "FINISHED",
  "FAILED",
  "CANCELED",
  "CANCELLED",
]);

function normaliseStatus(status: string | null) {
  return String(status ?? "Unknown").replaceAll("_", " ");
}

export function HeyReachLauncher({ draftId, approved, linkedinReady }: Props) {
  const [open, setOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => String(campaign.id) === campaignId) ?? null,
    [campaignId, campaigns],
  );

  const selectedBlocked = selectedCampaign
    ? blockedStatuses.has(String(selectedCampaign.status ?? "").toUpperCase())
    : false;

  useEffect(() => {
    if (!open || campaigns.length || loadingCampaigns) return;

    let cancelled = false;
    setLoadingCampaigns(true);
    setError("");

    fetch("/api/integrations/heyreach/campaigns", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Could not load HeyReach campaigns.");
        return body;
      })
      .then((body) => {
        if (!cancelled) setCampaigns(Array.isArray(body.campaigns) ? body.campaigns : []);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load HeyReach campaigns.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCampaigns(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, campaigns.length, loadingCampaigns]);

  async function launch() {
    if (!campaignId || !confirmed || selectedBlocked) return;

    setLaunching(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/integrations/heyreach/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          campaignId: Number(campaignId),
          confirmPersonalization: true,
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "HeyReach launch failed.");

      setSuccess(`Launched to ${body?.campaign?.name ?? "HeyReach"}.`);
      setConfirmed(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "HeyReach launch failed.");
    } finally {
      setLaunching(false);
    }
  }

  const disabledReason = !approved
    ? "Approve the outreach first."
    : !linkedinReady
      ? "A person-level LinkedIn URL is required."
      : null;

  return (
    <>
      <button
        type="button"
        disabled={Boolean(disabledReason)}
        title={disabledReason ?? "Launch approved LinkedIn outreach through HeyReach"}
        onClick={() => setOpen(true)}
        className={
          disabledReason
            ? "cursor-not-allowed rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-400"
            : "rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        }
      >
        Launch on HeyReach
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/20 p-4 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">LinkedIn launch</p>
                <h3 className="mt-2 text-xl font-bold text-slate-900">Send approved outreach to HeyReach</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">This adds the person to an existing HeyReach campaign. It does not create a new campaign.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
            </div>

            <div className="mt-5">
              <label className="mb-2 block text-xs font-bold text-slate-600">HeyReach campaign</label>
              <select
                value={campaignId}
                onChange={(event) => {
                  setCampaignId(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                disabled={loadingCampaigns}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50"
              >
                <option value="">{loadingCampaigns ? "Loading campaigns…" : "Select a campaign"}</option>
                {campaigns.map((campaign) => {
                  const status = String(campaign.status ?? "").toUpperCase();
                  const blocked = blockedStatuses.has(status);
                  return (
                    <option key={campaign.id} value={campaign.id} disabled={blocked}>
                      {campaign.name} · {normaliseStatus(campaign.status)}{blocked ? " · not launchable here" : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            {selectedCampaign ? (
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/55 p-4 text-sm text-indigo-900">
                <p className="font-semibold">{selectedCampaign.name}</p>
                <p className="mt-1 text-xs text-indigo-700">Status: {normaliseStatus(selectedCampaign.status)}</p>
              </div>
            ) : null}

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-100 bg-amber-50/60 p-4">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm leading-6 text-amber-900">
                I confirm this HeyReach campaign sequence uses the custom variables <strong>linkedin_connection_note</strong> and <strong>linkedin_followup</strong>. This ensures the approved dashboard copy is what HeyReach sends.
              </span>
            </label>

            {selectedBlocked ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">This campaign is paused, finished, draft or failed. The dashboard blocks it to avoid accidentally reactivating a campaign.</div>
            ) : null}
            {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {success ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

            <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-5">
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-indigo-200">Cancel</button>
              <button
                type="button"
                onClick={launch}
                disabled={!campaignId || !confirmed || launching || selectedBlocked}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-200"
              >
                {launching ? "Launching…" : "Launch LinkedIn outreach"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
