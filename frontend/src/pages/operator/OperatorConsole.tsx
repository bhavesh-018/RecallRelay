import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Bot,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  GitBranch,
  KeyRound,
  LogOut,
  Megaphone,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  ApiError,
  type RecallOverview,
  operatorLogin,
  operatorMe,
  setStoredOperatorToken,
} from '../../api/client';
import { BrandLogo } from '../../components/BrandLogo';
import { ThemeToggle } from '../../components/ThemeContext';
import { AgentWorkbenchView } from './AgentWorkbenchView';
import { BatchTraceView } from './BatchTraceView';
import { ExperimentSummaryView } from './ExperimentSummaryView';
import { OperatorOverview } from './OperatorOverview';
import { RecallPublishView } from './RecallPublishView';

type OperatorTab = 'overview' | 'trace' | 'publish' | 'experiment' | 'agent';

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{ id: OperatorTab; label: string; icon: typeof Activity }>;
}> = [
  {
    title: 'Operations',
    items: [
      { id: 'overview', label: 'Overview', icon: Activity },
      { id: 'trace', label: 'Batch Trace', icon: GitBranch },
      { id: 'publish', label: 'Publish Recall', icon: Megaphone },
    ],
  },
  {
    title: 'Experimentation & AI',
    items: [
      { id: 'experiment', label: 'Experiment', icon: FlaskConical },
      { id: 'agent', label: 'Agent Workbench', icon: Bot },
    ],
  },
];

const TAB_BREADCRUMB: Record<OperatorTab, { group: string; title: string }> = {
  overview: { group: 'Operations', title: 'Recall Overview' },
  trace: { group: 'Operations', title: 'Batch Topology' },
  publish: { group: 'Operations', title: 'Publish Recall Notice' },
  experiment: { group: 'Experimentation', title: 'Flagsmith A/B Study' },
  agent: { group: 'Experimentation', title: 'Bounded Agent Workbench' },
};

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

  const crumb = TAB_BREADCRUMB[activeTab];

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Full-Height Enterprise Left Sidebar */}
      <aside className="flex w-full shrink-0 flex-col border-b border-[#1E1E24] bg-[#0B0B0E] lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r">
        {/* Brand Lockup */}
        <div className="flex h-14 items-center justify-between border-b border-[#1E1E24] px-4">
          <Link to="/" className="transition-opacity hover:opacity-95">
            <BrandLogo size="sm" showWordmark />
          </Link>
          <span className="rounded border border-[#222228] bg-[#141418] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#71717A]">
            v1.0
          </span>
        </div>

        {/* Navigation Groups */}
        <nav
          aria-label="Operator sections"
          className="flex flex-1 gap-1.5 overflow-x-auto px-3 py-3 lg:flex-col lg:gap-5 lg:overflow-y-auto lg:py-4"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="flex shrink-0 gap-1 lg:flex-col lg:space-y-1">
              <div className="hidden px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#52525B] lg:block">
                {group.title}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={item.label}
                    onClick={() => setActiveTab(item.id)}
                    className={`group relative flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-[#18181E] text-[#F4F4F5] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]'
                        : 'text-[#A1A1AA] hover:bg-[#131318] hover:text-[#F4F4F5]'
                    }`}
                  >
                    {isActive && (
                      <span className="hidden h-4 w-0.5 rounded-full bg-[#3B82F6] lg:absolute lg:left-0 lg:block" />
                    )}
                    <Icon
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        isActive ? 'text-[#60A5FA]' : 'text-[#71717A] group-hover:text-[#A1A1AA]'
                      }`}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom-Docked Operator Session Panel */}
        <div className="hidden border-t border-[#1E1E24] p-3.5 space-y-3 lg:block">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717A]">
              Operator Session
            </span>
            {operatorAuthed ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                <ShieldCheck className="h-3 w-3" />
                Verified
              </span>
            ) : (
              <span className="rounded-full bg-[#18181D] px-2 py-0.5 text-[10px] text-[#71717A]">
                Read-only
              </span>
            )}
          </div>

          {operatorAuthed ? (
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#222228] bg-[#111114] px-3 py-1.5 text-xs font-medium text-[#A1A1AA] transition-colors hover:border-[#32323C] hover:text-[#F4F4F5]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          ) : (
            <form onSubmit={handleLogin} className="space-y-2">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#52525B]" />
                <input
                  type="password"
                  aria-label="Operator secret"
                  value={secretInput}
                  onChange={(e) => setSecretInput(e.target.value)}
                  placeholder="Operator secret"
                  className="w-full rounded-lg border border-[#222228] bg-[#09090B] py-1.5 pl-8 pr-2.5 text-xs text-[#F4F4F5] placeholder:text-[#52525B] focus:border-[#3B82F6] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-[#3B82F6] px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
              >
                Sign In
              </button>
            </form>
          )}

          {authError && <div className="text-[11px] text-red-400">{authError}</div>}

          <Link
            to="/join"
            className="flex items-center justify-between rounded-lg border border-[#222228] bg-[#111114] px-3 py-2 text-xs font-medium text-[#A1A1AA] transition-colors hover:border-[#32323C] hover:text-[#F4F4F5]"
          >
            <span>Participant /join</span>
            <ExternalLink className="h-3.5 w-3.5 text-[#71717A]" />
          </Link>
        </div>
      </aside>

      {/* Main Application Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky Top Context Bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-[#1E1E24] bg-[#09090B]/85 px-6 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#71717A]">{crumb.group}</span>
            <ChevronRight className="h-3.5 w-3.5 text-[#3F3F46]" />
            <span className="font-medium text-[#F4F4F5]">{crumb.title}</span>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 md:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Flagsmith Connected
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>Fictional Drill Platform</span>
            </span>
            <ThemeToggle />
          </div>
        </header>

        {/* Scrollable Workspace Canvas */}
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-6 py-7">
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
    </div>
  );
}
