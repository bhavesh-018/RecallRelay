import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  type AuditEventItem,
  type RecallListItem,
  type RecallOverview,
  getRecall,
  getTaskAudit,
  listRecalls,
} from '../../api/client';

interface OperatorOverviewProps {
  operatorAuthenticated: boolean;
  onNavigatePublish: () => void;
  selectedRecallId: string | null;
  onSelectRecall: (id: string) => void;
}

function statusPillClasses(status: string): string {
  switch (status) {
    case 'reconciled':
      return 'border-emerald-800/60 bg-emerald-950/40 text-emerald-400';
    case 'discrepancy':
      return 'border-red-800/60 bg-red-950/40 text-red-400';
    case 'pending_quarantine':
    case 'acknowledged':
      return 'border-amber-800/60 bg-amber-950/40 text-amber-300';
    default:
      return 'border-[#27272A] bg-[#09090B] text-[#A1A1AA]';
  }
}

export function OperatorOverview({
  operatorAuthenticated,
  onNavigatePublish,
  selectedRecallId,
  onSelectRecall,
}: OperatorOverviewProps) {
  const [recalls, setRecalls] = useState<RecallListItem[]>([]);
  const [overview, setOverview] = useState<RecallOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);

  const [auditTaskId, setAuditTaskId] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const list = await listRecalls();
        if (!active) return;
        setRecalls(list);
        const targetId = selectedRecallId ?? list[0]?.id ?? null;
        if (targetId) {
          if (targetId !== selectedRecallId) {
            onSelectRecall(targetId);
          }
          const detail = await getRecall(targetId);
          if (!active) return;
          setOverview(detail);
        } else {
          setOverview(null);
        }
        setError(null);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load recall overview.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedRecallId, onSelectRecall]);

  async function handleInspectAudit(taskId: string) {
    setAuditTaskId(taskId);
    setAuditError(null);
    if (!operatorAuthenticated) {
      setAuditEvents([]);
      setAuditError('Sign in as Operator to inspect task audit history.');
      return;
    }
    try {
      const events = await getTaskAudit(taskId);
      setAuditEvents(events);
    } catch (err) {
      setAuditEvents([]);
      setAuditError(err instanceof ApiError ? err.message : 'Could not load audit trail.');
    }
  }

  function handleCopyLink(taskId: string, token: string) {
    const url = `${window.location.origin}/t/${token}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url);
    }
    setCopiedTaskId(taskId);
    window.setTimeout(() => setCopiedTaskId(null), 1800);
  }

  if (loading && !overview) {
    return (
      <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-6 text-xs text-[#A1A1AA]">
        Loading active recall overview…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-[#18181B] p-5 text-xs text-red-400">
        {error}
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="rr-panel-enter rounded-lg border border-[#27272A] bg-[#18181B] p-6 space-y-3">
        <div className="text-sm font-semibold text-[#EDEDED]">No Active Recall Published</div>
        <p className="text-xs text-[#A1A1AA]">
          Publish a fictional drill notice for Batch B17 to generate scoped participant tasks across all 5 locations.
        </p>
        <button
          type="button"
          onClick={onNavigatePublish}
          className="rounded-md bg-[#3B82F6] px-3.5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          Publish Drill Notice
        </button>
      </div>
    );
  }

  const pctComplete =
    overview.total_tasks > 0 ? Math.round((overview.completed_tasks / overview.total_tasks) * 100) : 0;

  return (
    <div className="rr-panel-enter space-y-5">
      {/* Header & Recall Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-[#EDEDED]">
              Batch {overview.batch_code} · {overview.product_name}
            </h2>
            <span className="rounded border border-[#27272A] bg-[#09090B] px-2 py-0.5 font-mono text-xs text-[#A1A1AA]">
              v{overview.notice_version}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[#A1A1AA]">
            Live 5-second polling · Last sync {lastUpdated || 'just now'} · Batch-level reconciliation without transfer double-counting
          </p>
        </div>

        {recalls.length > 1 && (
          <select
            aria-label="Select active recall"
            value={overview.id}
            onChange={(e) => onSelectRecall(e.target.value)}
            className="rounded-md border border-[#27272A] bg-[#09090B] px-3 py-1.5 font-mono text-xs text-[#EDEDED]"
          >
            {recalls.map((r) => (
              <option key={r.id} value={r.id}>
                {r.batch_code} (v{r.notice_version}) · {r.completed_tasks}/{r.total_tasks}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-1">
          <div className="text-xs text-[#A1A1AA]">Opening Batch</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-[#EDEDED]">
            {overview.trace.opening_quantity}
          </div>
          <div className="text-xs text-[#A1A1AA]">Accounted: {overview.trace.accounted_total}</div>
        </div>
        <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-1">
          <div className="text-xs text-[#A1A1AA]">Remaining Stock</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-[#EDEDED]">
            {overview.trace.total_remaining}
          </div>
          <div className="text-xs text-[#A1A1AA]">Set aside: {overview.trace.total_set_aside}</div>
        </div>
        <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-1">
          <div className="text-xs text-[#A1A1AA]">Sold Downstream</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-[#EDEDED]">
            {overview.trace.total_sold}
          </div>
          <div className="text-xs text-[#A1A1AA]">Discrepancy: {overview.trace.discrepancy}</div>
        </div>
        <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-1.5">
          <div className="text-xs text-[#A1A1AA]">Tasks Reconciled</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-[#EDEDED]">
            {overview.completed_tasks} / {overview.total_tasks}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#09090B]">
            <div
              className="h-full bg-[#3B82F6] transition-all duration-300"
              style={{ width: `${pctComplete}%` }}
            />
          </div>
        </div>
      </div>

      {/* Location Tasks Reconciliation Table */}
      <div className="overflow-x-auto rounded-lg border border-[#27272A] bg-[#18181B]">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[#27272A] bg-[#09090B] text-[#A1A1AA]">
              <th className="px-4 py-2.5 font-medium">Location</th>
              <th className="px-2 py-2.5 text-right font-medium">Recv</th>
              <th className="px-2 py-2.5 text-right font-medium">Fwd</th>
              <th className="px-2 py-2.5 text-right font-medium">Sold</th>
              <th className="px-2 py-2.5 text-right font-medium">Rem</th>
              <th className="px-2 py-2.5 text-right font-medium">Aside</th>
              <th className="px-3 py-2.5 text-right font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#27272A] font-mono tabular-nums">
            {overview.tasks.map((task) => (
              <tr key={task.task_id} className="transition-colors hover:bg-[#09090B]/60">
                <td className="px-4 py-3 font-sans">
                  <div className="font-medium text-[#EDEDED]">{task.location_name}</div>
                  <div className="text-xs capitalize text-[#A1A1AA]">{task.role}</div>
                </td>
                <td className="px-2 py-3 text-right">{task.received}</td>
                <td className="px-2 py-3 text-right">{task.forwarded}</td>
                <td className="px-2 py-3 text-right">{task.response ? task.response.sold_qty : '—'}</td>
                <td className="px-2 py-3 text-right">{task.response ? task.response.remaining_qty : '—'}</td>
                <td className="px-2 py-3 text-right">{task.response ? task.response.set_aside_qty : '—'}</td>
                <td className="px-3 py-3 text-right font-sans">
                  <span
                    className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${statusPillClasses(task.status)}`}
                  >
                    {task.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-sans">
                  <div className="inline-flex items-center gap-1.5">
                    <Link
                      to={`/t/${task.access_token}`}
                      className="rounded border border-[#27272A] bg-[#09090B] px-2 py-1 text-xs text-[#EDEDED] transition-colors hover:border-[#3B82F6]"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleCopyLink(task.task_id, task.access_token)}
                      className="rounded border border-[#27272A] bg-[#09090B] px-2 py-1 text-xs text-[#A1A1AA] transition-colors hover:text-[#EDEDED]"
                    >
                      {copiedTaskId === task.task_id ? 'Copied' : 'Link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleInspectAudit(task.task_id)}
                      className="rounded border border-[#27272A] bg-[#09090B] px-2 py-1 text-xs text-[#A1A1AA] transition-colors hover:text-[#EDEDED]"
                    >
                      Audit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Audit Drawer */}
      {auditTaskId && (
        <div className="rr-panel-enter rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-[#EDEDED]">
              Task Audit Trail · <span className="font-mono text-[#A1A1AA]">{auditTaskId}</span>
            </div>
            <button
              type="button"
              onClick={() => setAuditTaskId(null)}
              className="text-xs text-[#A1A1AA] hover:text-[#EDEDED]"
            >
              Close
            </button>
          </div>
          {auditError ? (
            <div className="text-xs text-amber-300">{auditError}</div>
          ) : auditEvents.length === 0 ? (
            <div className="text-xs text-[#A1A1AA]">No audit events recorded for this task yet.</div>
          ) : (
            <ul className="space-y-1.5 font-mono text-xs text-[#A1A1AA]">
              {auditEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#27272A] bg-[#09090B] px-3 py-2"
                >
                  <span>
                    <span className="text-[#EDEDED]">{ev.action}</span>
                    {ev.revision_ref !== null ? ` (rev ${ev.revision_ref})` : ''} · {ev.actor}
                  </span>
                  <span>{new Date(ev.created_at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
