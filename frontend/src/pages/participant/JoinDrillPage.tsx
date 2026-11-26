import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type JoinStudyResponse, joinStudy } from '../../api/client';

const STUDY_TOKEN_STORAGE_KEY = 'rr_study_scoped_token';

export function JoinDrillPage() {
  const [session, setSession] = useState<JoinStudyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setLoading(true);
    setError(null);
    try {
      const existing = localStorage.getItem(STUDY_TOKEN_STORAGE_KEY);
      const data = await joinStudy(existing, false);
      localStorage.setItem(STUDY_TOKEN_STORAGE_KEY, data.scoped_token);
      setSession(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to initialize drill session.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8 space-y-4">
      <div className="rounded-md border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-medium text-[#EDEDED]">
        Fictional recall drill
      </div>

      <div className="rr-panel-enter rounded-lg border border-[#27272A] bg-[#18181B] p-5 space-y-4">
        <div className="space-y-1">
          <h1 className="text-base font-semibold text-[#EDEDED]">Remote Shop Recall Drill</h1>
          <p className="text-xs leading-relaxed text-[#A1A1AA]">
            No login required. Each browser receives one pseudonymous drill session to count and confirm Batch B17 inventory.
          </p>
        </div>

        {session ? (
          <div className="rounded-md border border-[#27272A] bg-[#09090B] p-3.5 space-y-2 text-xs">
            <div className="font-mono text-emerald-400">
              {session.resumed ? '✓ Resumed existing session' : '✓ Session initialized'}
            </div>
            <div className="font-mono text-[#A1A1AA]">
              Alias: <span className="text-[#EDEDED]">{session.participant_alias}</span> · Identity:{' '}
              <span className="text-[#EDEDED]">{session.identity}</span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleJoin()}
            className="w-full rounded-md bg-[#3B82F6] py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Preparing Session…' : 'Start Isolated Shop Drill'}
          </button>
        )}

        {error && <div className="text-xs text-red-400">{error}</div>}

        <Link to="/" className="inline-block text-xs text-[#3B82F6] hover:underline">
          ← Back to Operator Console
        </Link>
      </div>
    </main>
  );
}
