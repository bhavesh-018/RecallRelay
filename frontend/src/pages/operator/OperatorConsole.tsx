import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Bot,
  ExternalLink,
  FlaskConical,
  GitBranch,
  KeyRound,
  LogOut,
  Megaphone,
  ShieldCheck,
} from 'lucide-react';
import {
  ApiError,
  type RecallOverview,
  operatorLogin,
  operatorMe,
  setStoredOperatorToken,
} from '../../api/client';
import { AgentWorkbenchView } from './AgentWorkbenchView';
import { BatchTraceView } from './BatchTraceView';
import { ExperimentSummaryView } from './ExperimentSummaryView';
import { OperatorOverview } from './OperatorOverview';
import { RecallPublishView } from './RecallPublishView';

type OperatorTab = 'overview' | 'trace' | 'publish' | 'experiment' | 'agent';

const NAV_ITEMS: Array<{
  id: OperatorTab;
  label: string;
  subtitle: string;
  icon: typeof Activity;
}> = [
  { id: 'overview', label: 'Overview', subtitle: 'Live reconciliation', icon: Activity },
  { id: 'trace', label: 'Batch Trace', subtitle: 'Supply topology', icon: GitBranch },
  { id: 'publish', label: 'Publish Recall', subtitle: 'Issue drill notice', icon: Megaphone },
  { id: 'experiment', label: 'Experiment', subtitle: 'Flagsmith A/B', icon: FlaskConical },
  { id: 'agent', label: 'Agent Workbench', subtitle: 'Bounded AI pilot', icon: Bot },
];

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
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 lg:flex-row">
      {/* Left Operations Rail */}
      <aside className="w-full shrink-0 lg:w-60">
        <div className="space-y-4 lg:sticky lg:top-[72px]">
          <nav
            aria-label="Operator sections"
            className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.label}
                  onClick={() => setActiveTab(item.id)}
                  className={`group flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${
                    isActive
                      ? 'border-[#3B82F6]/40 bg-[#141417] text-[#F4F4F5] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]'
                      : 'border-transparent text-[#A1A1AA] hover:border-[#27272A] hover:bg-[#141417]/50 hover:text-[#F4F4F5]'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      isActive ? 'text-[#60A5FA]' : 'text-[#71717A] group-hover:text-[#A1A1AA]'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium leading-none">{item.label}</div>
                    <div className="mt-1 hidden text-[11px] text-[#71717A] lg:block">{item.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Operator Session Card */}
          <div className="rr-surface rounded-lg p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#71717A]">
                Operator Access
              </span>
              {operatorAuthed ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Active
                </span>
              ) : (
                <span className="text-[11px] text-[#71717A]">Read-only</span>
              )}
            </div>

            {operatorAuthed ? (
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#27272A] bg-[#09090B] px-3 py-1.5 text-xs text-[#A1A1AA] transition-colors hover:border-[#3F3F46] hover:text-[#F4F4F5]"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            ) : (
              <form onSubmit={handleLogin} className="space-y-2">
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#71717A]" />
                  <input
                    type="password"
                    aria-label="Operator secret"
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    placeholder="Operator secret"
                    className="w-full rounded-md border border-[#27272A] bg-[#09090B] py-1.5 pl-8 pr-2.5 text-xs text-[#F4F4F5] placeholder:text-[#52525B] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-md bg-[#3B82F6] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                >
                  Sign In
                </button>
              </form>
            )}

            {authError && <div className="text-[11px] text-red-400">{authError}</div>}

            <div className="border-t border-[#27272A] pt-2.5">
              <Link
                to="/join"
                className="flex items-center justify-between text-xs text-[#A1A1AA] transition-colors hover:text-[#F4F4F5]"
              >
                <span>Open /join Drill</span>
                <ExternalLink className="h-3.5 w-3.5 text-[#71717A]" />
              </Link>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Operations Viewport */}
      <main className="min-w-0 flex-1 space-y-5">
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
        {activeTab === 'experiment' && (
          <ExperimentSummaryView operatorAuthenticated={operatorAuthed} />
        )}
        {activeTab === 'agent' && (
          <AgentWorkbenchView operatorAuthenticated={operatorAuthed} />
        )}
      </main>
    </div>
  );
}
