import { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Lock,
  Play,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  ApiError,
  type AgentProposalItem,
  type AgentRunItem,
  applyAgentProposal,
  approveAgentProposal,
  listAgentProposals,
  rejectAgentProposal,
  triggerAgentRun,
} from '../../api/client';

interface AgentWorkbenchViewProps {
  operatorAuthenticated: boolean;
}

const DEMO_PRESETS = [
  {
    label: 'Roll out guided (100%)',
    text: 'For this Pilot test, prepare a change_workflow proposal with desired_variant set to guided to reduce accounting mismatches, while clearly stating sample-size uncertainty.',
  },
  {
    label: 'Rollback to standard',
    text: 'For this Pilot test, prepare a change_workflow proposal with desired_variant set to standard to restore the baseline workflow.',
  },
  {
    label: 'Honesty / sample check',
    text: 'Audit current drill evidence and recommend whether we have enough statistical power to change the Pilot workflow, or if we should collect_more_evidence first.',
  },
];

function statusBadge(status: string): string {
  switch (status) {
    case 'verified':
    case 'applied':
    case 'approved':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';
    case 'pending_review':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'stale_conflict':
    case 'failed':
      return 'border-red-500/30 bg-red-500/10 text-red-400';
    default:
      return 'border-[#27272A] bg-[#09090B] text-[#A1A1AA]';
  }
}

export function AgentWorkbenchView({ operatorAuthenticated }: AgentWorkbenchViewProps) {
  const [drillId, setDrillId] = useState('B17');
  const [instruction, setInstruction] = useState(DEMO_PRESETS[0].text);
  const [proposals, setProposals] = useState<AgentProposalItem[]>([]);
  const [runs, setRuns] = useState<AgentRunItem[]>([]);
  const [running, setRunning] = useState(false);
  const [expandedJsonId, setExpandedJsonId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    if (!operatorAuthenticated) return;
    try {
      const data = await listAgentProposals();
      setProposals(data.proposals);
      setRuns(data.runs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load Agent Workbench.');
    }
  }

  useEffect(() => {
    void refresh();
  }, [operatorAuthenticated]);

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!operatorAuthenticated) {
      setError('Sign in as Operator to run the bounded product agent.');
      return;
    }
    setRunning(true);
    try {
      const res = await triggerAgentRun(drillId, instruction);
      if (res.error) {
        setError(`Run ${res.run_id} (${res.state}): ${res.error}`);
      } else {
        setNotice(
          `Run ${res.run_id} completed in ${res.attempts} attempt(s) with ${res.tool_calls.length} tool calls.`,
        );
      }
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Agent run failed.');
    } finally {
      setRunning(false);
    }
  }

  async function handleDecision(prop: AgentProposalItem, action: 'approve' | 'reject') {
    setError(null);
    setNotice(null);
    try {
      if (action === 'approve') {
        const updated = await approveAgentProposal(prop.id, prop.revision);
        setNotice(`Approved proposal ${updated.id} (rev #${updated.revision}). Ready for Flagsmith apply.`);
      } else {
        const updated = await rejectAgentProposal(prop.id, prop.revision);
        setNotice(`Rejected proposal ${updated.id}. No Flagsmith write occurred.`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Proposal decision failed.');
      await refresh();
    }
  }

  async function handleApply(prop: AgentProposalItem) {
    setError(null);
    setNotice(null);
    try {
      const res = await applyAgentProposal(prop.id, prop.revision);
      setNotice(
        `Proposal ${res.proposal_id} ${res.status}${res.reconciled_after_timeout ? ' (reconciled via readback after timeout)' : ''}.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Apply & verify failed.');
      await refresh();
    }
  }

  const latest = proposals[0] ?? null;

  return (
    <div className="rr-panel-enter space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-[#F4F4F5]">Bounded Agent Workbench</h2>
            <span className="inline-flex items-center gap-1 rounded-md border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-2 py-0.5 font-mono text-[11px] text-[#60A5FA]">
              <Lock className="h-3 w-3" />
              Pilot / recall_response_flow
            </span>
          </div>
          <p className="mt-1 text-xs text-[#A1A1AA]">
            Bounded loop (&le;8 tools, &le;2 repairs, 60s budget) · Deterministic evidence validator · Human approval + SHA-256 hash lock
          </p>
        </div>
      </div>

      {!operatorAuthenticated && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
          Sign in as Operator in the left panel to run the bounded product agent and approve Pilot flag changes.
        </div>
      )}

      {/* Agent Run Prompt Bar + Quick Demo Presets */}
      <form onSubmit={handleRun} className="rr-surface rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <div>
            <label htmlFor="agent-drill-id" className="mb-1 block text-[11px] font-medium text-[#A1A1AA]">
              Drill / Batch ID
            </label>
            <input
              id="agent-drill-id"
              value={drillId}
              onChange={(e) => setDrillId(e.target.value)}
              className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 font-mono text-xs text-[#F4F4F5] focus:border-[#3B82F6] focus:outline-none"
            />
          </div>
          <div className="sm:col-span-4">
            <label htmlFor="agent-instruction" className="mb-1 block text-[11px] font-medium text-[#A1A1AA]">
              Operator Instruction
            </label>
            <div className="flex gap-2">
              <input
                id="agent-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                className="w-full rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs text-[#F4F4F5] focus:border-[#3B82F6] focus:outline-none"
              />
              <button
                type="submit"
                disabled={running || !operatorAuthenticated}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#3B82F6] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" />
                {running ? 'Running…' : 'Run Agent'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-[#71717A]">
            <Sparkles className="h-3 w-3" />
            Presets:
          </span>
          {DEMO_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setInstruction(preset.text)}
              className="rounded-md border border-[#27272A] bg-[#09090B] px-2.5 py-1 text-[11px] text-[#A1A1AA] transition-colors hover:border-[#3B82F6]/50 hover:text-[#F4F4F5]"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div role="alert" className="rounded-xl border border-red-900/60 bg-[#141417] p-3.5 text-xs text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-900/60 bg-[#141417] p-3.5 text-xs text-emerald-400">
          {notice}
        </div>
      )}

      {/* 5-Stage Bounded Pipeline Stepper */}
      {latest && (
        <div className="grid grid-cols-5 gap-2 text-center font-mono text-[11px]">
          {['1. Read', '2. Propose', '3. Validate', '4. Approve', '5. Verify'].map((label, idx) => {
            const done =
              idx < 3 ||
              (idx === 3 && ['approved', 'applied', 'verified'].includes(latest.status)) ||
              (idx === 4 && latest.status === 'verified');
            const active = idx === 3 && latest.status === 'pending_review';
            return (
              <div
                key={label}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 transition-colors ${
                  done
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : active
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-[#27272A] bg-[#141417] text-[#71717A]'
                }`}
              >
                {done && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                <span>{label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Proposals List */}
      <div className="space-y-3">
        {proposals.map((prop) => {
          const isChange = prop.diff.recommendation_type === 'change_workflow';
          const proposedWeights = prop.diff.proposed_weights as Record<string, number> | undefined;
          const currentWeights = prop.diff.current_weights as Record<string, number> | undefined;
          const isJsonOpen = expandedJsonId === prop.id;

          return (
            <div key={prop.id} className="rr-surface rounded-xl p-5 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Bot className="h-4 w-4 text-[#60A5FA]" />
                  <span className="font-mono font-semibold text-[#F4F4F5]">{prop.id}</span>
                  <span className="rounded border border-[#27272A] bg-[#09090B] px-1.5 py-0.5 font-mono text-[11px] text-[#A1A1AA]">
                    rev #{prop.revision}
                  </span>
                  <span className="font-mono text-[11px] text-[#71717A]">
                    {prop.target_environment}/{prop.target_feature}
                  </span>
                </div>
                <span className={`rounded-md border px-2.5 py-0.5 font-mono text-[11px] font-medium ${statusBadge(prop.status)}`}>
                  {prop.status}
                </span>
              </div>

              <p className="leading-relaxed text-[#D4D4D8]">{prop.rationale}</p>

              {/* Structured Diff Preview */}
              <div className="rounded-lg border border-[#27272A] bg-[#09090B] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="text-[#A1A1AA]">
                    Action:{' '}
                    <span className="font-semibold text-[#F4F4F5]">
                      {String(prop.diff.recommendation_type)}
                    </span>
                  </span>
                  <span className="text-[#71717A]" title={prop.baseline_config_hash}>
                    Baseline lock: {prop.baseline_config_hash.slice(0, 22)}…
                  </span>
                </div>

                {isChange && proposedWeights && (
                  <div className="grid grid-cols-1 gap-3 border-t border-[#27272A] pt-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-[11px] text-[#71717A]">Current Pilot Split</div>
                      <div className="font-mono text-xs text-[#A1A1AA]">
                        standard {currentWeights?.standard ?? 50}% / guided {currentWeights?.guided ?? 50}%
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] text-[#60A5FA]">Proposed Pilot Split</div>
                      <div className="font-mono text-xs font-semibold text-[#F4F4F5]">
                        standard {proposedWeights.standard ?? 0}% / guided {proposedWeights.guided ?? 100}%
                      </div>
                    </div>
                  </div>
                )}

                {prop.evidence_ids.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-[#27272A] pt-2.5">
                    <span className="text-[11px] text-[#71717A]">Cited Evidence:</span>
                    {prop.evidence_ids.map((eid) => (
                      <span
                        key={eid}
                        className="rounded border border-[#27272A] bg-[#141417] px-2 py-0.5 font-mono text-[10px] text-[#A1A1AA]"
                      >
                        {eid}
                      </span>
                    ))}
                  </div>
                )}

                <div className="border-t border-[#27272A] pt-2">
                  <button
                    type="button"
                    onClick={() => setExpandedJsonId(isJsonOpen ? null : prop.id)}
                    className="inline-flex items-center gap-1 text-[11px] text-[#71717A] hover:text-[#F4F4F5]"
                  >
                    {isJsonOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isJsonOpen ? 'Hide raw proposal JSON' : 'Inspect raw proposal JSON'}
                  </button>
                  {isJsonOpen && (
                    <pre className="mt-2 overflow-x-auto rounded border border-[#27272A] bg-[#141417] p-2.5 font-mono text-[11px] text-[#E4E4E7]">
                      {JSON.stringify(prop.diff, null, 2)}
                    </pre>
                  )}
                </div>
              </div>

              {prop.status === 'pending_review' && (
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDecision(prop, 'reject')}
                    className="rounded-lg border border-[#27272A] bg-[#09090B] px-3.5 py-1.5 text-xs text-[#A1A1AA] hover:border-[#3F3F46] hover:text-[#F4F4F5]"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecision(prop, 'approve')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Approve Revision #{prop.revision}
                  </button>
                </div>
              )}

              {prop.status === 'approved' && isChange && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleApply(prop)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Apply &amp; Verify in Pilot
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent Runs & Tool Trace */}
      {runs.length > 0 && (
        <div className="rr-surface rounded-xl p-4 space-y-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-[#F4F4F5]">
            <Cpu className="h-4 w-4 text-[#60A5FA]" />
            Recent Agent Runs &amp; Tool Trace
          </div>
          <div className="space-y-2 font-mono">
            {runs.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-[#27272A] bg-[#09090B] p-3 space-y-2 text-[#A1A1AA]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[#F4F4F5]">
                    {r.id} · {r.state} <span className="text-[#71717A]">({r.model_name})</span>
                  </span>
                  <span className="text-[11px] text-[#71717A]">
                    {r.tool_calls.length} tools · {r.attempts} attempt(s)
                  </span>
                </div>
                {r.error_message && <div className="text-red-400">{r.error_message}</div>}
                {r.tool_calls.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.tool_calls.map((tc, idx) => (
                      <span
                        key={`${r.id}-${tc.tool_name}-${idx}`}
                        className="inline-flex items-center gap-1 rounded border border-[#27272A] bg-[#141417] px-2 py-0.5 text-[10px]"
                      >
                        <Wrench className="h-2.5 w-2.5 text-[#60A5FA]" />
                        <span className="text-[#E4E4E7]">{tc.tool_name}</span>
                        <span className={tc.status === 'ok' ? 'text-emerald-400' : 'text-red-400'}>
                          {tc.status}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
