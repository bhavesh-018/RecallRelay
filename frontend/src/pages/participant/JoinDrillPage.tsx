import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, Play, ShieldAlert } from 'lucide-react';
import {
  ApiError,
  type DrillSessionState,
  acknowledgeSessionRendered,
  joinStudy,
  startDrillSession,
  submitDrillSession,
} from '../../api/client';
import { RecallFlow, type RecallFlowValues } from '../../components/RecallFlow';
import { BrandLogo } from '../../components/BrandLogo';

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

  useEffect(() => {
    if (!session || session.outcome === 'success') return;
    setCountdown(Math.ceil(session.remaining_seconds));
    const timer = window.setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session?.session_id, session?.remaining_seconds, session?.outcome]);

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
      <main className="mx-auto max-w-md px-4 py-10 space-y-4">
        <div className="inline-flex w-full items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>Fictional recall drill</span>
        </div>

        <div className="rr-panel-enter rr-surface rounded-xl p-6 space-y-5">
          <BrandLogo size="md" showWordmark subtitle="Remote Participant Drill" />
          <div className="space-y-2 border-t border-[#27272A] pt-4">
            <h1 className="text-lg font-semibold tracking-tight text-[#F4F4F5]">
              Remote Shop Recall Drill
            </h1>
            <p className="text-xs leading-relaxed text-[#A1A1AA]">
              No login required. Press Start to receive your isolated mock shop inventory card for Batch B17. You have <span className="font-mono text-[#F4F4F5]">5:00</span> to reconcile Sold, Remaining, and Set Aside units accurately.
            </p>
          </div>

          <button
            type="button"
            disabled={starting}
            onClick={() => void handleStartDrill()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#3B82F6] py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {starting ? 'Starting Drill…' : 'Start Isolated Shop Drill'}
          </button>

          {error && (
            <div role="alert" className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          <div className="border-t border-[#27272A] pt-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs text-[#A1A1AA] transition-colors hover:text-[#F4F4F5]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Operator Console
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (session.outcome === 'success' || session.late_completion_recorded) {
    const qualified = session.outcome === 'success';
    return (
      <main className="mx-auto max-w-md px-4 py-10 space-y-4">
        <div className="inline-flex w-full items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{session.banner}</span>
        </div>
        <div className="rr-panel-enter rr-surface rounded-xl p-6 space-y-4">
          <div
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs ${
              qualified
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {qualified
              ? 'Verified Drill Completion (<= 5 min)'
              : 'Recorded After 5-Minute Cutoff (Timeout)'}
          </div>
          <h1 className="text-lg font-semibold text-[#F4F4F5]">Thank You · Drill Complete</h1>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-[#27272A] bg-[#09090B] p-3 font-mono text-xs">
            <div>
              <div className="text-[10px] text-[#71717A]">Alias</div>
              <div className="mt-0.5 text-[#F4F4F5]">{session.participant_alias}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#71717A]">Variant</div>
              <div className="mt-0.5 text-[#60A5FA]">{session.variant}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#71717A]">Duration</div>
              <div className="mt-0.5 text-[#F4F4F5]">
                {session.completed_seconds !== null ? `${session.completed_seconds}s` : '—'}
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6 space-y-3">
      <div className="rr-surface flex items-center justify-between rounded-lg px-3.5 py-2.5 font-mono text-xs">
        <span className="text-[#A1A1AA]">
          Alias <span className="text-[#F4F4F5]">{session.participant_alias}</span>
        </span>
        <span
          className={`inline-flex items-center gap-1.5 font-semibold ${
            countdown <= 30 ? 'text-amber-300' : 'text-[#F4F4F5]'
          }`}
        >
          <Clock className="h-3.5 w-3.5 text-[#60A5FA]" />
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
