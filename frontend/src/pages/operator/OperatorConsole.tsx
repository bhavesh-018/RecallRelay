import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  type RecallOverview,
  operatorLogin,
  operatorMe,
  setStoredOperatorToken,
} from '../../api/client';
import { BatchTraceView } from './BatchTraceView';
import { OperatorOverview } from './OperatorOverview';
import { RecallPublishView } from './RecallPublishView';

type OperatorTab = 'overview' | 'trace' | 'publish';

export function OperatorConsole() {
  const [activeTab, setActiveTab] = useState<OperatorTab>('overview');
  const [selectedRecallId, setSelectedRecallId] = useState<string | null>(null);
  const [operatorAuthed, setOperatorAuthed] = useState(false);
  const [secretInput, setSecretInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    operatorMe()
      .then(() => setOperatorAuthed(true))
      .catch(() => setOperatorAuthed(false));
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    try {
      await operatorLogin(secretInput);
      setOperatorAuthed(true);
      setSecretInput('');
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : 'Authentication failed.');
    }
  }

  function handleLogout() {
    setStoredOperatorToken(null);
    setOperatorAuthed(false);
  }

  const handleSelectRecall = useCallback((id: string) => {
    setSelectedRecallId(id);
  }, []);

  function handlePublished(overview: RecallOverview) {
    setSelectedRecallId(overview.id);
    setActiveTab('overview');
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-6 space-y-5">
      {/* Top Operator Auth & Navigation Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#27272A] pb-4">
        <nav className="flex items-center gap-1.5" aria-label="Operator sections">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'trace', label: 'Batch Trace' },
              { id: 'publish', label: 'Publish Recall' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-[#27272A] bg-[#18181B] text-[#EDEDED]'
                  : 'border-transparent text-[#A1A1AA] hover:text-[#EDEDED]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2">
          {operatorAuthed ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-xs text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Operator Authenticated
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md border border-[#27272A] bg-[#09090B] px-2.5 py-1 text-xs text-[#A1A1AA] hover:text-[#EDEDED]"
              >
                Sign Out
              </button>
            </>
          ) : (
            <form onSubmit={handleLogin} className="flex items-center gap-2">
              <input
                type="password"
                aria-label="Operator secret"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                placeholder="Operator secret"
                className="w-44 rounded-md border border-[#27272A] bg-[#18181B] px-2.5 py-1.5 text-xs text-[#EDEDED] focus:border-[#3B82F6] focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-md bg-[#3B82F6] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                Sign In
              </button>
            </form>
          )}
          <Link
            to="/join"
            className="rounded-md border border-[#27272A] bg-[#18181B] px-3 py-1.5 text-xs text-[#A1A1AA] transition-colors hover:text-[#EDEDED]"
          >
            /join Preview
          </Link>
        </div>
      </div>

      {authError && <div className="text-xs text-red-400">{authError}</div>}

      {activeTab === 'overview' && (
        <OperatorOverview
          operatorAuthenticated={operatorAuthed}
          onNavigatePublish={() => setActiveTab('publish')}
          selectedRecallId={selectedRecallId}
          onSelectRecall={handleSelectRecall}
        />
      )}
      {activeTab === 'trace' && <BatchTraceView />}
      {activeTab === 'publish' && (
        <RecallPublishView
          operatorAuthenticated={operatorAuthed}
          onPublished={handlePublished}
        />
      )}
    </main>
  );
}
