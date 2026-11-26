import { useEffect, useState } from 'react';
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

function statusBadge(status: string): string {
  switch (status) {
    case 'verified':
    case 'applied':
    case 'approved':
      return 'border-emerald-800/60 bg-emerald-950/40 text-emerald-400';
    case 'pending_review':
      return 'border-amber-800/60 bg-amber-950/40 text-amber-300';
    case 'stale_conflict':
    case 'failed':
      return 'border-red-800/60 bg-red-950/40 text-red-400';
    default:
      return 'border-[#27272A] bg-[#09090B] text-[#A1A1AA]';
  }
}

export function AgentWorkbenchView({ operatorAuthenticated }: AgentWorkbenchViewProps) {
  const [drillId, setDrillId] = useState('B17');
  const [instruction, setInstruction] = useState(
    'Review this drill and prepare a pilot workflow improvement.',
  );
  const [proposals, setProposals] = useState<AgentProposalItem[]>([]);
  const [runs, setRuns] = useState<AgentRunItem[]>([]);
  const [running, setRunning] = useState(false);
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
        setNotice(`Run ${res.run_id} completed in ${res.attempts} attempt(s) with ${res.tool_calls.length} tool calls.`);
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
      <div>
        <h2 className="text-base font-semibold tracking-tight text-[#EDEDED]">Bounded Agent Workbench</h2>
        <p className="mt-0.5 text-xs text-[#A1A1AA]">
          Allowlisted target: <span className="font-mono text-[#EDEDED]">Pilot / recall_response_flow</span> · Limits: 8 tool calls, 2 revisions, 60s budget · Human approval required
        </p>
      </div>

      {!operatorAuthenticated && (
        <div className="rounded-lg border border-amber-800/60 bg-[#18181B] p-4 text-xs text-amber-300">
          Sign in as Operator in the header to run the bounded agent and review/approve pilot proposals.
        </div>
      )}

      {/* Agent Run Prompt Bar */}
      <form
        onSubmit={handleRun}
        className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="agent-drill-id" className="mb-1 block text-xs text-[#A1A1AA]">
              Drill / Batch ID
            </label>
            <input
              id="agent-drill-id"
              value={drillId}
              onChange={(e) => setDrillId(e.target.value)}
              className="w-full rounded-md border border-[#27272A] bg-[#09090B] px-3 py-2 font-mono text-xs text-[#EDEDED] focus:border-[#3B82F6] focus:outline-none"
            />
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="agent-instruction" className="mb-1 block text-xs text-[#A1A1AA]">
              Operator Instruction
            </label>
            <div className="flex gap-2">
              <input
                id="agent-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                className="w-full rounded-md border border-[#27272A] bg-[#09090B] px-3 py-2 text-xs text-[#EDEDED] focus:border-[#3B82F6] focus:outline-none"
              />
              <button
                type="submit"
                disabled={running || !operatorAuthenticated}
                className="shrink-0 rounded-md bg-[#3B82F6] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {running ? 'Running…' : 'Run Agent'}
              </button>
            </div>
          </div>
        </div>
      </form>

      {error && (
        <div role="alert" className="rounded-lg border border-red-900/60 bg-[#18181B] p-3.5 text-xs text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-900/60 bg-[#18181B] p-3.5 text-xs text-emerald-400">
          {notice}
        </div>
      )}

      {/* 5-Stage Bounded Pipeline Indicator */}
      {latest && (
        <div className="grid grid-cols-5 gap-1.5 text-center font-mono text-xs">
          {['1. Read', '2. Propose', '3. Validate', '4. Approve', '5. Verify'].map((label, idx) => {
            const done =
              idx < 3 ||
              (idx === 3 && ['approved', 'applied', 'verified'].includes(latest.status)) ||
              (idx === 4 && latest.status === 'verified');
            const active = idx === 3 && latest.status === 'pending_review';
            return (
              <div
                key={label}
                className={`rounded border px-2 py-1.5 transition-colors ${
                  done
                    ? 'border-emerald-800/60 bg-[#18181B] text-emerald-400'
                    : active
                      ? 'border-amber-700/70 bg-[#18181B] text-amber-300'
                      : 'border-[#27272A] bg-[#09090B] text-[#A1A1AA]'
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>
      )}

      {/* Proposals List */}
      <div className="space-y-3">
        {proposals.map((prop) => (
          <div
            key={prop.id}
            className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-[#EDEDED]">{prop.id}</span>
                <span className="font-mono text-[#A1A1AA]">
                  rev #{prop.revision} · {prop.target_environment}/{prop.target_feature}
                </span>
              </div>
              <span className={`rounded border px-2 py-0.5 font-mono ${statusBadge(prop.status)}`}>
                {prop.status}
              </span>
            </div>

            <p className="leading-relaxed text-[#A1A1AA]">{prop.rationale}</p>

            <div className="rounded border border-[#27272A] bg-[#09090B] p-3 font-mono text-xs space-y-1">
              <div className="text-[#A1A1AA]">baseline: {prop.baseline_config_hash}</div>
              <div className="text-[#A1A1AA]">
                evidence_ids: {prop.evidence_ids.length > 0 ? prop.evidence_ids.join(', ') : '(none)'}
              </div>
              <pre className="overflow-x-auto pt-1 text-[#EDEDED]">
                {JSON.stringify(prop.diff, null, 2)}
              </pre>
            </div>

            {prop.status === 'pending_review' && (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleDecision(prop, 'reject')}
                  className="rounded-md border border-[#27272A] bg-[#09090B] px-3 py-1.5 text-xs text-[#A1A1AA] hover:text-[#EDEDED]"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => void handleDecision(prop, 'approve')}
                  className="rounded-md bg-[#3B82F6] px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  Approve Revision #{prop.revision}
                </button>
              </div>
            )}

            {prop.status === 'approved' && prop.diff.recommendation_type === 'change_workflow' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleApply(prop)}
                  className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                >
                  Apply &amp; Verify in Pilot
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Recent Runs & Tool Trace */}
      {runs.length > 0 && (
        <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-2.5 text-xs">
          <div className="font-semibold text-[#EDEDED]">Recent Agent Runs &amp; Tool Calls</div>
          <div className="space-y-2 font-mono">
            {runs.map((r) => (
              <div
                key={r.id}
                className="rounded border border-[#27272A] bg-[#09090B] p-3 space-y-1 text-[#A1A1AA]"
              >
                <div className="flex justify-between">
                  <span className="text-[#EDEDED]">
                    {r.id} · {r.state} ({r.model_name})
                  </span>
                  <span>{r.tool_calls.length} tools · {r.attempts} attempt(s)</span>
                </div>
                {r.error_message && <div className="text-red-400">{r.error_message}</div>}
                {r.tool_calls.length > 0 && (
                  <div className="text-[#A1A1AA]">
                    {r.tool_calls.map((tc) => `${tc.tool_name}[${tc.status}]`).join(' → ')}
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
