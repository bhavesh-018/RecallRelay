import { useEffect, useState } from 'react';
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
      setStatusMsg(`Outbox flush: ${res.dispatched} dispatched, ${res.failed} failed, ${res.pending_remaining} remaining.`);
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

  return (
    <div className="rr-panel-enter space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-[#EDEDED]">
            Experiment Summary · <span className="font-mono">recall_response_flow</span>
          </h2>
          <p className="mt-0.5 text-xs text-[#A1A1AA]">
            Primary metric: first backend-verified correct completion within 300s · Same pseudonymous identity
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-[#27272A] bg-[#18181B] px-3 py-1.5 text-xs text-[#A1A1AA]">
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
        <div className="rounded-lg border border-red-900/60 bg-[#18181B] p-3.5 text-xs text-red-400">
          {error}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-lg border border-emerald-900/60 bg-[#18181B] p-3.5 text-xs text-emerald-400">
          {statusMsg}
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(['standard', 'guided'] as const).map((variantKey) => {
              const v = summary.variants[variantKey];
              return (
                <div
                  key={variantKey}
                  className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-3"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold text-[#EDEDED]">
                      {variantKey === 'standard' ? 'Variant A · standard' : 'Variant B · guided'}
                    </span>
                    <span className="rounded border border-[#27272A] bg-[#09090B] px-2 py-0.5 font-mono text-[#A1A1AA]">
                      n = {v.exposed_n}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-2xl font-semibold tabular-nums text-[#EDEDED]">
                      {v.conversion_rate_pct.toFixed(1)}%
                    </span>
                    <span className="font-mono text-xs text-[#A1A1AA]">
                      {v.success_n} / {v.exposed_n} qualified
                    </span>
                  </div>

                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#09090B]">
                    <div
                      className={`h-full transition-all duration-300 ${
                        variantKey === 'guided' ? 'bg-[#3B82F6]' : 'bg-[#71717A]'
                      }`}
                      style={{ width: `${Math.min(100, v.conversion_rate_pct)}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap justify-between gap-2 border-t border-[#27272A] pt-2.5 font-mono text-xs text-[#A1A1AA]">
                    <span>
                      Median: {v.median_completion_seconds !== null ? `${v.median_completion_seconds}s` : '—'}
                    </span>
                    <span>Timeouts: {v.timeout_n}</span>
                    <span>Errors: {v.total_incorrect_attempts}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#27272A] bg-[#18181B] p-4 text-xs">
            <div className="space-y-1 font-mono text-[#A1A1AA]">
              <div>
                Valid exposed: <span className="text-[#EDEDED]">{summary.valid_exposed_n}</span> · Excluded:{' '}
                <span className="text-[#EDEDED]">{summary.excluded_n}</span>
              </div>
              <div>
                Outbox: <span className="text-emerald-400">{summary.outbox.dispatched} dispatched</span> ·{' '}
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
                className="rounded-md border border-[#27272A] bg-[#09090B] px-3 py-1.5 text-xs text-[#EDEDED] transition-colors hover:border-[#3B82F6] disabled:opacity-40"
              >
                Flush Outbox
              </button>
              <button
                type="button"
                disabled={!operatorAuthenticated}
                onClick={() => void handleExportCsv()}
                className="rounded-md bg-[#3B82F6] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Export CSV
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
