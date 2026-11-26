import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  type DrillSessionState,
  acknowledgeSessionRendered,
  joinStudy,
  startDrillSession,
  submitDrillSession,
} from '../../api/client';
import { RecallFlow, type RecallFlowValues } from '../../components/RecallFlow';

const STUDY_TOKEN_STORAGE_KEY = 'rr_study_scoped_token';

function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function JoinDrillPage() {
  const [session, setSession] = useState<DrillSessionState | null>(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(300);

  // Live 1s countdown synced to server remaining_seconds while active
  useEffect(() => {
    if (!session || session.outcome === 'success') return;
    setCountdown(Math.ceil(session.remaining_seconds));
    const timer = window.setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session?.session_id, session?.remaining_seconds, session?.outcome]);

  // Acknowledge workflow render once variant is assigned
  useEffect(() => {
    if (!session || !session.variant || session.started_at) return;
    void acknowledgeSessionRendered(session.scoped_token).catch(() => {
      // Non-fatal diagnostic ack
    });
  }, [session]);

  async function handleStartDrill() {
    setStarting(true);
    setError(null);
    try {
      const existing = localStorage.getItem(STUDY_TOKEN_STORAGE_KEY);
      const joined = await joinStudy(existing, false);
      localStorage.setItem(STUDY_TOKEN_STORAGE_KEY, joined.scoped_token);
      const started = await startDrillSession(joined.scoped_token);
      setSession(started);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to start recall drill.');
    } finally {
      setStarting(false);
    }
  }

  async function handleSubmit(values: RecallFlowValues) {
    if (!session) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await submitDrillSession(session.scoped_token, values);
      setSession(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submission failed. Please verify your counts.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!session) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 space-y-4">
        <div className="rounded-md border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-medium text-[#EDEDED]">
          Fictional recall drill
        </div>

        <div className="rr-panel-enter rounded-lg border border-[#27272A] bg-[#18181B] p-5 space-y-4">
          <div className="space-y-1.5">
            <h1 className="text-base font-semibold text-[#EDEDED]">Remote Shop Recall Drill</h1>
            <p className="text-xs leading-relaxed text-[#A1A1AA]">
              No login required. Press Start to receive your mock shop inventory card for Batch B17. You have 5 minutes to count Sold, Remaining, and Set Aside units accurately.
            </p>
          </div>

          <button
            type="button"
            disabled={starting}
            onClick={() => void handleStartDrill()}
            className="w-full rounded-md bg-[#3B82F6] py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {starting ? 'Starting Drill…' : 'Start Isolated Shop Drill'}
          </button>

          {error && (
            <div role="alert" className="rounded border border-red-900/60 bg-red-950/30 p-2.5 text-xs text-red-400">
              {error}
            </div>
          )}

          <Link to="/" className="inline-block text-xs text-[#3B82F6] hover:underline">
            ← Back to Operator Console
          </Link>
        </div>
      </main>
    );
  }

  if (session.outcome === 'success' || session.late_completion_recorded) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 space-y-4">
        <div className="rounded-md border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-medium text-[#EDEDED]">
          {session.banner}
        </div>
        <div className="rr-panel-enter rounded-lg border border-[#27272A] bg-[#18181B] p-5 space-y-3">
          <div className={`font-mono text-xs ${session.outcome === 'success' ? 'text-emerald-400' : 'text-amber-300'}`}>
            {session.outcome === 'success'
              ? '✓ Verified Drill Completion (Within 5 Minutes)'
              : 'Recorded After 5-Minute Cutoff (Primary Metric: Timeout)'}
          </div>
          <h1 className="text-base font-semibold text-[#EDEDED]">Thank You · Drill Complete</h1>
          <p className="font-mono text-xs text-[#A1A1AA]">
            Alias: {session.participant_alias} · Variant: {session.variant} · Time:{' '}
            {session.completed_seconds !== null ? `${session.completed_seconds}s` : '—'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6 space-y-3">
      <div className="flex items-center justify-between rounded-md border border-[#27272A] bg-[#18181B] px-3.5 py-2 font-mono text-xs">
        <span className="text-[#A1A1AA]">Alias {session.participant_alias}</span>
        <span className={countdown <= 30 ? 'text-amber-300' : 'text-[#EDEDED]'}>
          {formatClock(countdown)} remaining
        </span>
      </div>

      <RecallFlow
        banner={session.banner}
        batchCode={session.batch_code}
        productName={session.product_name}
        locationName={session.location_name}
        noticeText={session.notice_text}
        received={session.received}
        forwarded={session.forwarded}
        workflow={session.variant ?? 'standard'}
        submitting={submitting}
        errorMessage={error}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
