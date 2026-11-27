import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Package,
  QrCode,
  Search,
  ShoppingBag,
  Warehouse,
  X,
} from 'lucide-react';
import {
  ApiError,
  type AuditEventItem,
  type RecallListItem,
  type RecallOverview,
  type TaskQrPayload,
  getRecall,
  getTaskAudit,
  getTaskQr,
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
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';
    case 'discrepancy':
      return 'border-red-500/30 bg-red-500/10 text-red-400';
    case 'pending_quarantine':
    case 'acknowledged':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    default:
      return 'border-[#27272A] bg-[#09090B] text-[#A1A1AA]';
  }
}

function roleBadgeClasses(role: string): string {
  switch (role) {
    case 'manufacturer':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
    case 'distributor':
      return 'border-violet-500/30 bg-violet-500/10 text-violet-300';
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

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'manufacturer' | 'distributor' | 'shop'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'reconciled' | 'discrepancy'>('all');

  const [auditTaskId, setAuditTaskId] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [qrPayload, setQrPayload] = useState<TaskQrPayload | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

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

  const filteredTasks = useMemo(() => {
    if (!overview) return [];
    const q = searchQuery.trim().toLowerCase();
    return overview.tasks.filter((task) => {
      if (roleFilter !== 'all' && task.role !== roleFilter) return false;
      if (statusFilter === 'pending' && task.status === 'reconciled') return false;
      if (statusFilter === 'reconciled' && task.status !== 'reconciled') return false;
      if (statusFilter === 'discrepancy' && task.status !== 'discrepancy') return false;
      if (q && !task.location_name.toLowerCase().includes(q) && !task.role.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [overview, searchQuery, roleFilter, statusFilter]);

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

  async function handleShowQr(taskId: string) {
    setQrError(null);
    if (!operatorAuthenticated) {
      setQrPayload(null);
      setQrError('Sign in as Operator to generate printable QR codes.');
      return;
    }
    try {
      const payload = await getTaskQr(taskId, window.location.origin);
      setQrPayload(payload);
    } catch (err) {
      setQrPayload(null);
      setQrError(err instanceof ApiError ? err.message : 'Unable to generate QR code.');
    }
  }

  if (loading && !overview) {
    return (
      <div className="rr-surface rounded-xl p-6 text-xs text-[#A1A1AA]">
        Loading active recall overview…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-900/60 bg-[#141417] p-5 text-xs text-red-400">
        {error}
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="rr-panel-enter rr-surface rounded-xl p-8 text-center space-y-3">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-[#27272A] bg-[#09090B] text-[#60A5FA]">
          <Package className="h-5 w-5" />
        </div>
        <div className="text-sm font-semibold text-[#F4F4F5]">No Active Recall Published</div>
        <p className="mx-auto max-w-md text-xs leading-relaxed text-[#A1A1AA]">
          Publish a fictional drill notice for an affected batch to generate scoped participant reconciliation tasks across all reached supply-chain locations.
        </p>
        <div className="pt-1">
          <button
            type="button"
            onClick={onNavigatePublish}
            className="rounded-md bg-[#3B82F6] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            Publish Drill Notice
          </button>
        </div>
      </div>
    );
  }

  const pctComplete =
    overview.total_tasks > 0 ? Math.round((overview.completed_tasks / overview.total_tasks) * 100) : 0;

  return (
    <div className="rr-panel-enter space-y-5">
      {/* Header & Recall Selector */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-[#F4F4F5]">
              Batch {overview.batch_code} · {overview.product_name}
            </h2>
            <span className="rounded-md border border-[#27272A] bg-[#141417] px-2 py-0.5 font-mono text-[11px] text-[#A1A1AA]">
              v{overview.notice_version}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Live · {lastUpdated || 'synced'}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#A1A1AA]">
            Batch-level conservation across {overview.total_tasks} reached locations · Zero transfer double-counting
          </p>
        </div>

        {recalls.length > 1 && (
          <select
            aria-label="Select active recall"
            value={overview.id}
            onChange={(e) => onSelectRecall(e.target.value)}
            className="rounded-lg border border-[#27272A] bg-[#141417] px-3 py-1.5 font-mono text-xs text-[#F4F4F5] focus:border-[#3B82F6] focus:outline-none"
          >
            {recalls.map((r) => (
              <option key={r.id} value={r.id}>
                {r.batch_code} (v{r.notice_version}) · {r.completed_tasks}/{r.total_tasks}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* KPI Metric Strip */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rr-surface rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
            <span>Opening Batch</span>
            <Package className="h-4 w-4 text-[#60A5FA]" />
          </div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-[#F4F4F5]">
            {overview.trace.opening_quantity}
          </div>
          <div className="text-[11px] text-[#71717A]">
            Accounted: <span className="font-mono text-[#A1A1AA]">{overview.trace.accounted_total} units</span>
          </div>
        </div>

        <div className="rr-surface rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
            <span>Remaining Stock</span>
            <Warehouse className="h-4 w-4 text-amber-400" />
          </div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-[#F4F4F5]">
            {overview.trace.total_remaining}
          </div>
          <div className="text-[11px] text-[#71717A]">
            Quarantined: <span className="font-mono text-emerald-400">{overview.trace.total_set_aside} set aside</span>
          </div>
        </div>

        <div className="rr-surface rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
            <span>Sold Downstream</span>
            <ShoppingBag className="h-4 w-4 text-violet-400" />
          </div>
          <div className="font-mono text-2xl font-semibold tabular-nums text-[#F4F4F5]">
            {overview.trace.total_sold}
          </div>
          <div className="text-[11px] text-[#71717A]">
            Discrepancy:{' '}
            <span className={`font-mono ${overview.trace.discrepancy > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {overview.trace.discrepancy}
            </span>
          </div>
        </div>

        <div className="rr-surface rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A1A1AA]">
            <span>Tasks Reconciled</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-2xl font-semibold tabular-nums text-[#F4F4F5]">
              {overview.completed_tasks}
              <span className="text-sm font-normal text-[#71717A]"> / {overview.total_tasks}</span>
            </span>
            <span className="font-mono text-xs text-[#60A5FA]">{pctComplete}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#09090B]">
            <div
              className="h-full rounded-full bg-[#3B82F6] transition-all duration-300"
              style={{ width: `${pctComplete}%` }}
            />
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#71717A]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter locations…"
            className="w-full rounded-lg border border-[#27272A] bg-[#141417] py-1.5 pl-8 pr-3 text-xs text-[#F4F4F5] placeholder:text-[#52525B] focus:border-[#3B82F6] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'manufacturer', 'distributor', 'shop'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                roleFilter === r
                  ? 'border-[#3B82F6]/50 bg-[#3B82F6]/15 text-[#60A5FA]'
                  : 'border-[#27272A] bg-[#141417] text-[#A1A1AA] hover:text-[#F4F4F5]'
              }`}
            >
              {r === 'all' ? 'All Roles' : r}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[#27272A]" />
          {(['all', 'pending', 'reconciled', 'discrepancy'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                statusFilter === st
                  ? 'border-[#3B82F6]/50 bg-[#3B82F6]/15 text-[#60A5FA]'
                  : 'border-[#27272A] bg-[#141417] text-[#A1A1AA] hover:text-[#F4F4F5]'
              }`}
            >
              {st === 'all' ? 'All Status' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Location Tasks Reconciliation Table */}
      <div className="rr-surface overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#27272A] bg-[#0D0D10] text-[11px] uppercase tracking-wider text-[#71717A]">
                <th className="px-4 py-3 font-medium">Location ({filteredTasks.length})</th>
                <th className="px-2.5 py-3 text-right font-medium">Recv</th>
                <th className="px-2.5 py-3 text-right font-medium">Fwd</th>
                <th className="px-2.5 py-3 text-right font-medium">Sold</th>
                <th className="px-2.5 py-3 text-right font-medium">Rem</th>
                <th className="px-2.5 py-3 text-right font-medium">Aside</th>
                <th className="px-3 py-3 text-right font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272A]/70 font-mono tabular-nums">
              {filteredTasks.map((task) => (
                <tr key={task.task_id} className="transition-colors hover:bg-[#1C1C21]/70">
                  <td className="px-4 py-3 font-sans">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#F4F4F5]">{task.location_name}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize ${roleBadgeClasses(task.role)}`}
                      >
                        {task.role}
                      </span>
                    </div>
                  </td>
                  <td className="px-2.5 py-3 text-right text-[#F4F4F5]">{task.received}</td>
                  <td className="px-2.5 py-3 text-right text-[#A1A1AA]">{task.forwarded}</td>
                  <td className="px-2.5 py-3 text-right text-[#A1A1AA]">
                    {task.response ? task.response.sold_qty : '—'}
                  </td>
                  <td className="px-2.5 py-3 text-right text-[#A1A1AA]">
                    {task.response ? task.response.remaining_qty : '—'}
                  </td>
                  <td className="px-2.5 py-3 text-right text-emerald-400">
                    {task.response ? task.response.set_aside_qty : '—'}
                  </td>
                  <td className="px-3 py-3 text-right font-sans">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusPillClasses(task.status)}`}
                    >
                      {task.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-sans">
                    <div className="inline-flex items-center gap-1">
                      <Link
                        to={`/t/${task.access_token}`}
                        className="inline-flex items-center gap-1 rounded-md border border-[#27272A] bg-[#09090B] px-2 py-1 text-[11px] font-medium text-[#F4F4F5] transition-colors hover:border-[#3B82F6] hover:text-[#60A5FA]"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleCopyLink(task.task_id, task.access_token)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#27272A] bg-[#09090B] px-2 py-1 text-[11px] text-[#A1A1AA] transition-colors hover:border-[#3F3F46] hover:text-[#F4F4F5]"
                      >
                        {copiedTaskId === task.task_id ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedTaskId === task.task_id ? 'Copied' : 'Link'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleShowQr(task.task_id)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#27272A] bg-[#09090B] px-2 py-1 text-[11px] text-[#A1A1AA] transition-colors hover:border-[#3F3F46] hover:text-[#F4F4F5]"
                      >
                        <QrCode className="h-3 w-3" />
                        QR
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleInspectAudit(task.task_id)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#27272A] bg-[#09090B] px-2 py-1 text-[11px] text-[#A1A1AA] transition-colors hover:border-[#3F3F46] hover:text-[#F4F4F5]"
                      >
                        <ClipboardList className="h-3 w-3" />
                        Audit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center font-sans text-xs text-[#71717A]">
                    No locations match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* QR Label Preview Panel */}
      {(qrPayload || qrError) && (
        <div className="rr-panel-enter rr-surface rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F4F4F5]">
              <QrCode className="h-4 w-4 text-[#60A5FA]" />
              Printable Box QR Label {qrPayload ? `· ${qrPayload.location_name}` : ''}
            </div>
            <button
              type="button"
              onClick={() => {
                setQrPayload(null);
                setQrError(null);
              }}
              className="rounded p-1 text-[#A1A1AA] hover:bg-[#27272A] hover:text-[#F4F4F5]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {qrError ? (
            <div className="text-xs text-amber-300">{qrError}</div>
          ) : (
            qrPayload && (
              <div className="flex flex-wrap items-center gap-4">
                <img
                  src={qrPayload.qr_data_url}
                  alt={`QR code for ${qrPayload.location_name}`}
                  className="h-32 w-32 rounded-lg border border-[#27272A] bg-white p-1.5"
                />
                <div className="min-w-0 flex-1 space-y-2 text-xs">
                  <div className="font-medium text-[#F4F4F5]">{qrPayload.banner}</div>
                  <div className="break-all font-mono text-[11px] text-[#A1A1AA]">{qrPayload.target_url}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={qrPayload.qr_data_url}
                      download={`recallrelay-qr-${qrPayload.location_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#27272A] bg-[#09090B] px-2.5 py-1 text-xs text-[#F4F4F5] hover:border-[#3B82F6]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download PNG
                    </a>
                  </div>
                  {qrPayload.is_localhost_warning && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
                      Localhost URL detected: open the console via your cloudflared HTTPS URL before scanning from a phone.
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Audit Drawer */}
      {auditTaskId && (
        <div className="rr-panel-enter rr-surface rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F4F4F5]">
              <ClipboardList className="h-4 w-4 text-[#60A5FA]" />
              Task Audit Trail · <span className="font-mono text-[#A1A1AA]">{auditTaskId}</span>
            </div>
            <button
              type="button"
              onClick={() => setAuditTaskId(null)}
              className="rounded p-1 text-[#A1A1AA] hover:bg-[#27272A] hover:text-[#F4F4F5]"
            >
              <X className="h-3.5 w-3.5" />
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
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2"
                >
                  <span>
                    <span className="text-[#F4F4F5]">{ev.action}</span>
                    {ev.revision_ref !== null ? ` (rev ${ev.revision_ref})` : ''} · {ev.actor}
                  </span>
                  <span className="text-[#71717A]">{new Date(ev.created_at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
