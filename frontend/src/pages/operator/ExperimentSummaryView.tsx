import { useEffect, useState } from 'react';
import { Download, FlaskConical, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  ApiError,
  type ExperimentSummaryResponse,
  dispatchExperimentOutbox,
  downloadExperimentCsv,
  getExperimentSummary,
} from '../../api/client';

interface ExperimentSummaryViewProps {
  operatorAuthenticated: boolean;
}

export function ExperimentSummaryView({ operatorAuthenticated }: ExperimentSummaryViewProps) {
  const [summary, setSummary] = useState<ExperimentSummaryResponse | null>(null);
  const [includePractice, setIncludePractice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function refresh(withPractice: boolean) {
    try {
      const data = await getExperimentSummary(withPractice);
      setSummary(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load experiment summary.');
    }
  }

  useEffect(() => {
    void refresh(includePractice);
    const timer = window.setInterval(() => {
      void refresh(includePractice);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [includePractice]);

  async function handleFlushOutbox() {
    setStatusMsg(null);
    setError(null);
    try {
      const res = await dispatchExperimentOutbox();
      setStatusMsg(
        `Outbox flush: ${res.dispatched} dispatched, ${res.failed} failed, ${res.pending_remaining} remaining.`,
      );
      await refresh(includePractice);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Outbox flush failed.');
    }
  }

  async function handleExportCsv() {
    setError(null);
    try {
      const csvText = await downloadExperimentCsv(includePractice);
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'recallrelay_experiment_results.csv';
      link.click();
      URL.revokeObjectURL(url);
      setStatusMsg('Deidentified CSV exported.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'CSV export failed.');
    }
  }

  const liftDelta =
    summary &&
    summary.variants.standard.exposed_n > 0 &&
    summary.variants.guided.exposed_n > 0
      ? Number(
          (summary.variants.guided.conversion_rate_pct - summary.variants.standard.conversion_rate_pct).toFixed(1),
        )
      : null;

  return (
    <div className="rr-panel-enter space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-[#F4F4F5]">
              Flagsmith A/B Experiment
            </h2>
            <span className="rounded-md border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-2 py-0.5 font-mono text-xs text-[#60A5FA]">
              recall_response_flow
            </span>
          </div>
          <p className="mt-1 text-xs text-[#A1A1AA]">
            Primary metric: first backend-verified correct completion within 300s · Consistent pseudonymous identity
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#27272A] bg-[#141417] px-3 py-1.5 text-xs text-[#A1A1AA] hover:border-[#3F3F46]">
          <input
            type="checkbox"
            checked={includePractice}
            onChange={(e) => setIncludePractice(e.target.checked)}
            className="accent-[#3B82F6]"
          />
          Include practice runs
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-[#141417] p-3.5 text-xs text-red-400">
          {error}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-xl border border-emerald-900/60 bg-[#141417] p-3.5 text-xs text-emerald-400">
          {statusMsg}
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(['standard', 'guided'] as const).map((variantKey) => {
              const v = summary.variants[variantKey];
              const isGuided = variantKey === 'guided';
              return (
                <div key={variantKey} className="rr-surface rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FlaskConical
                        className={`h-4 w-4 ${isGuided ? 'text-[#60A5FA]' : 'text-[#A1A1AA]'}`}
                      />
                      <span className="text-xs font-semibold text-[#F4F4F5]">
                        {isGuided ? 'Treatment · guided (3-Step)' : 'Control · standard (Single-Page)'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isGuided && liftDelta !== null && (
                        <span
                          className={`rounded-md border px-2 py-0.5 font-mono text-xs font-medium ${
                            liftDelta >= 0
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          }`}
                        >
                          {liftDelta >= 0 ? '+' : ''}
                          {liftDelta}pp
                        </span>
                      )}
                      <span className="rounded-md border border-[#27272A] bg-[#09090B] px-2 py-0.5 font-mono text-xs text-[#A1A1AA]">
                        n = {v.exposed_n}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-3xl font-semibold tabular-nums text-[#F4F4F5]">
                      {v.conversion_rate_pct.toFixed(1)}%
                    </span>
                    <span className="font-mono text-xs text-[#A1A1AA]">
                      {v.success_n} / {v.exposed_n} qualified (&le;300s)
                    </span>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#09090B]">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isGuided ? 'bg-[#3B82F6]' : 'bg-[#71717A]'
                      }`}
                      style={{ width: `${Math.min(100, v.conversion_rate_pct)}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-[#27272A] pt-3 font-mono text-xs">
                    <div className="rounded-lg border border-[#27272A]/80 bg-[#09090B] px-2.5 py-2">
                      <div className="rr-muted">Median Time</div>
                      <div className="mt-0.5 text-sm font-semibold text-[#F4F4F5]">
                        {v.median_completion_seconds !== null ? `${v.median_completion_seconds}s` : '—'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#27272A]/80 bg-[#09090B] px-2.5 py-2">
                      <div className="rr-muted">Timeouts</div>
                      <div className="mt-0.5 text-sm font-semibold text-[#F4F4F5]">{v.timeout_n}</div>
                    </div>
                    <div className="rounded-lg border border-[#27272A]/80 bg-[#09090B] px-2.5 py-2">
                      <div className="rr-muted">Errors</div>
                      <div className="mt-0.5 text-sm font-semibold text-[#F4F4F5]">
                        {v.total_incorrect_attempts}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rr-surface flex flex-wrap items-center justify-between gap-4 rounded-xl p-4 text-xs">
            <div className="space-y-1.5 font-mono text-[#A1A1AA]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>
                  Valid exposed: <span className="text-[#F4F4F5]">{summary.valid_exposed_n}</span> · Excluded:{' '}
                  <span className="text-[#F4F4F5]">{summary.excluded_n}</span>
                </span>
              </div>
              <div className="pl-6 text-xs">
                Event Outbox:{' '}
                <span className="text-emerald-400">{summary.outbox.dispatched} dispatched</span> ·{' '}
                <span>{summary.outbox.pending} pending</span> ·{' '}
                <span className={summary.outbox.failed > 0 ? 'text-amber-300' : ''}>
                  {summary.outbox.failed} failed
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!operatorAuthenticated}
                onClick={() => void handleFlushOutbox()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-1.5 text-xs font-medium text-[#F4F4F5] transition-colors hover:border-[#3B82F6] disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Flush Outbox
              </button>
              <button
                type="button"
                disabled={!operatorAuthenticated}
                onClick={() => void handleExportCsv()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-3.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
