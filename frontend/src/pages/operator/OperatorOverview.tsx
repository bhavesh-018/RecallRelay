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
import { BrandLogo } from '../../components/BrandLogo';

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
  const [auditLocationName, setAuditLocationName] = useState<string>('');
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

  async function handleInspectAudit(taskId: string, locationName: string) {
    setAuditTaskId(taskId);
    setAuditLocationName(locationName);
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
      <div className="rr-surface rounded-xl p-8 text-xs text-[#A1A1AA]">
        Loading active recall overview…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-900/60 bg-[#111114] p-5 text-xs text-red-400">
        {error}
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="rr-panel-enter rr-surface rounded-2xl px-8 py-16 text-center space-y-5">
        <div className="flex justify-center">
          <BrandLogo size="lg" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-[#F4F4F5]">
            No Active Recall Published
          </h1>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-[#A1A1AA]">
            Publish a fictional drill notice for an affected batch to generate scoped participant reconciliation tasks across all reached supply-chain locations.
          </p>
        </div>
        <div className="pt-1">
          <button
            type="button"
            onClick={onNavigatePublish}
            className="rounded-lg bg-[#3B82F6] px-5 py-2.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Publish Drill Notice
          </button>
        </div>
      </div>
    );
  }

  const pctComplete =
    overview.total_tasks > 0 ? Math.round((overview.completed_tasks / overview.total_tasks) * 100) : 0;

  const opening = Math.max(overview.trace.opening_quantity, 1);
  const quarantinedPct = Math.min(100, (overview.trace.total_set_aside / opening) * 100);
  const unquarantinedRem = Math.max(0, overview.trace.total_remaining - overview.trace.total_set_aside);
  const unquarantinedPct = Math.min(100 - quarantinedPct, (unquarantinedRem / opening) * 100);
  const soldPct = Math.min(100 - quarantinedPct - unquarantinedPct, (overview.trace.total_sold / opening) * 100);

  return (
    <div className="rr-panel-enter space-y-6">
      {/* Page Title & Active Batch Selector */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[#F4F4F5]">
              Batch {overview.batch_code}
            </h1>
            <span className="text-lg font-normal rr-muted">·</span>
            <span className="text-base font-medium text-[#D4D4D8]">{overview.product_name}</span>
            <span className="rounded-md border border-[#222228] bg-[#141418] px-2 py-0.5 font-mono text-xs text-[#A1A1AA]">
              v{overview.notice_version}
            </span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs rr-muted">
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Updates every 5s
            </span>
            <span>·</span>
            <span>Last sync {lastUpdated || 'just now'}</span>
            <span>·</span>
            <span>{overview.total_tasks} locations tracked</span>
          </p>
        </div>

        {recalls.length > 1 && (
          <select
            aria-label="Select active recall"
            value={overview.id}
            onChange={(e) => onSelectRecall(e.target.value)}
            className="rounded-lg border border-[#222228] bg-[#111114] px-3 py-2 font-mono text-xs text-[#F4F4F5] focus:border-[#3B82F6] focus:outline-none"
          >
            {recalls.map((r) => (
              <option key={r.id} value={r.id}>
                {r.batch_code} (v{r.notice_version}) · {r.completed_tasks}/{r.total_tasks}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* KPI Metric Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rr-surface rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-[0.06em] rr-muted">
              Opening Batch
            </span>
            <Package className="h-4 w-4 rr-metric-icon" />
          </div>
          <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-[#F4F4F5]">
            {overview.trace.opening_quantity}
          </div>
          <div className="text-xs rr-muted">
            Accounted:{' '}
            <span className="font-mono font-medium text-[#D4D4D8]">{overview.trace.accounted_total} units</span>
          </div>
        </div>

        <div className="rr-surface rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-[0.06em] rr-muted">
              Remaining Stock
            </span>
            <Warehouse className="h-4 w-4 rr-metric-icon" />
          </div>
          <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-[#F4F4F5]">
            {overview.trace.total_remaining}
          </div>
          <div className="text-xs rr-muted">
            Quarantined:{' '}
            <span className="font-mono font-medium text-emerald-400">{overview.trace.total_set_aside} set aside</span>
          </div>
        </div>

        <div className="rr-surface rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-[0.06em] rr-muted">
              Sold Downstream
            </span>
            <ShoppingBag className="h-4 w-4 rr-metric-icon" />
          </div>
          <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-[#F4F4F5]">
            {overview.trace.total_sold}
          </div>
          <div className="text-xs rr-muted">
            Discrepancy:{' '}
            <span
              className={`font-mono font-medium ${
                overview.trace.discrepancy > 0 ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              {overview.trace.discrepancy}
            </span>
          </div>
        </div>

        <div className="rr-surface rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-[0.06em] rr-muted">
              Tasks Reconciled
            </span>
            <CheckCircle2 className="h-4 w-4 rr-metric-icon" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-[#F4F4F5]">
              {overview.completed_tasks}
              <span className="text-base font-normal rr-muted"> / {overview.total_tasks}</span>
            </span>
            <span className="font-mono text-xs font-medium text-[#60A5FA]">{pctComplete}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#09090B]">
            <div
              className="h-full rounded-full bg-[#3B82F6] transition-all duration-300"
              style={{ width: `${pctComplete}%` }}
            />
          </div>
        </div>
      </div>

      {/* Segmented Batch Conservation Bar */}
      <div className="rr-surface rounded-xl p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-medium text-[#F4F4F5]">Batch Unit Conservation</span>
          <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-[#A1A1AA]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Quarantined ({overview.trace.total_set_aside})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Pending Quarantine ({unquarantinedRem})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full rr-stock-sold" />
              Sold ({overview.trace.total_sold})
            </span>
          </div>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#09090B]">
          <div className="bg-emerald-500 transition-all duration-300" style={{ width: `${quarantinedPct}%` }} />
          <div className="bg-amber-400/80 transition-all duration-300" style={{ width: `${unquarantinedPct}%` }} />
          <div className="rr-stock-sold transition-all duration-300" style={{ width: `${soldPct}%` }} />
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[#52525B]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search locations or hubs…"
            className="w-full rounded-lg border border-[#222228] bg-[#111114] py-2 pl-9 pr-3 text-xs text-[#F4F4F5] placeholder:text-[#52525B] focus:border-[#3B82F6] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'manufacturer', 'distributor', 'shop'] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={roleFilter === r}
              onClick={() => setRoleFilter(r)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                roleFilter === r
                  ? 'border-[#3B82F6]/50 bg-[#3B82F6]/15 text-[#60A5FA]'
                  : 'border-[#222228] bg-[#111114] text-[#A1A1AA] hover:text-[#F4F4F5]'
              }`}
            >
              {r === 'all' ? 'All Tiers' : r}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[#222228]" />
          {(['all', 'pending', 'reconciled', 'discrepancy'] as const).map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={statusFilter === st}
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                statusFilter === st
                  ? 'border-[#3B82F6]/50 bg-[#3B82F6]/15 text-[#60A5FA]'
                  : 'border-[#222228] bg-[#111114] text-[#A1A1AA] hover:text-[#F4F4F5]'
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
              <tr className="border-b border-[#222228] bg-[#0B0B0E] text-[11px] font-semibold uppercase tracking-[0.07em] rr-muted">
                <th className="px-5 py-3">Location ({filteredTasks.length})</th>
                <th className="px-3 py-3 text-right">Received</th>
                <th className="px-3 py-3 text-right">Forwarded</th>
                <th className="px-3 py-3 text-right">Sold</th>
                <th className="px-3 py-3 text-right">Remaining</th>
                <th className="px-3 py-3 text-right">Set aside</th>
                <th className="px-4 py-3 text-right">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E1E24] font-mono tabular-nums">
              {filteredTasks.map((task) => (
                <tr key={task.task_id} className="transition-colors hover:bg-[#18181E]/75">
                  <td className="px-5 py-3.5 font-sans">
                    <div className="flex items-center gap-2.5">
                      <span className="font-medium text-[#F4F4F5]">{task.location_name}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize rr-neutral-badge`}
                      >
                        {task.role}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-right text-[#F4F4F5]">{task.received}</td>
                  <td className="px-3 py-3.5 text-right text-[#A1A1AA]">{task.forwarded}</td>
                  <td className="px-3 py-3.5 text-right text-[#A1A1AA]">
                    {task.response ? task.response.sold_qty : '—'}
                  </td>
                  <td className="px-3 py-3.5 text-right text-[#A1A1AA]">
                    {task.response ? task.response.remaining_qty : '—'}
                  </td>
                  <td className="px-3 py-3.5 text-right text-emerald-400">
                    {task.response ? task.response.set_aside_qty : '—'}
                  </td>
                  <td className="px-4 py-3.5 text-right font-sans">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusPillClasses(task.status)}`}
                    >
                      {task.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-sans">
                    <div className="inline-flex items-center gap-1.5">
                      <Link
                        to={`/t/${task.access_token}`}
                        className="inline-flex items-center gap-1 rounded-md border border-[#222228] bg-[#09090B] px-2.5 py-1 text-xs font-medium text-[#F4F4F5] transition-colors hover:border-[#3B82F6] hover:text-[#60A5FA]"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleCopyLink(task.task_id, task.access_token)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#222228] bg-[#09090B] px-2 py-1 text-xs text-[#A1A1AA] transition-colors hover:border-[#32323C] hover:text-[#F4F4F5]"
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
                        className="inline-flex items-center gap-1 rounded-md border border-[#222228] bg-[#09090B] px-2 py-1 text-xs text-[#A1A1AA] transition-colors hover:border-[#32323C] hover:text-[#F4F4F5]"
                      >
                        <QrCode className="h-3 w-3" />
                        QR
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleInspectAudit(task.task_id, task.location_name)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#222228] bg-[#09090B] px-2 py-1 text-xs text-[#A1A1AA] transition-colors hover:border-[#32323C] hover:text-[#F4F4F5]"
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
                  <td colSpan={8} className="px-5 py-10 text-center font-sans text-xs rr-muted">
                    No locations match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Centered Print-Ready QR Label Modal */}
      {(qrPayload || qrError) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => {
            setQrPayload(null);
            setQrError(null);
          }}
        >
          <div
            className="rr-panel-enter rr-surface w-full max-w-md rounded-2xl p-6 space-y-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#F4F4F5]">
                <QrCode className="h-4 w-4 text-[#60A5FA]" />
                Printable Box QR Label
              </div>
              <button
                type="button"
                onClick={() => {
                  setQrPayload(null);
                  setQrError(null);
                }}
                className="rounded-lg p-1 text-[#A1A1AA] hover:bg-[#1E1E24] hover:text-[#F4F4F5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {qrError ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                {qrError}
              </div>
            ) : (
              qrPayload && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center rounded-xl border border-[#222228] bg-[#09090B] p-5 text-center space-y-3">
                    <img
                      src={qrPayload.qr_data_url}
                      alt={`QR code for ${qrPayload.location_name}`}
                      className="h-44 w-44 rounded-lg bg-white p-2 shadow"
                    />
                    <div>
                      <div className="text-sm font-semibold text-[#F4F4F5]">{qrPayload.location_name}</div>
                      <div className="mt-0.5 text-xs rr-muted">{qrPayload.banner}</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#222228] bg-[#09090B] px-3 py-2 font-mono text-xs break-all text-[#A1A1AA]">
                    {qrPayload.target_url}
                  </div>

                  {qrPayload.is_localhost_warning && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      Localhost URL detected: open the console via your cloudflared HTTPS URL before scanning from a phone.
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <a
                      href={qrPayload.qr_data_url}
                      download={`recallrelay-qr-${qrPayload.location_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-4 py-2 text-xs font-medium text-white hover:opacity-90"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download PNG Label
                    </a>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Right-Hand Slide-Over Audit Inspector Drawer */}
      {auditTaskId && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setAuditTaskId(null)}
        >
          <div
            className="rr-drawer-enter flex h-full w-full max-w-md flex-col border-l border-[#222228] bg-[#0B0B0E] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#1E1E24] px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#F4F4F5]">
                  <ClipboardList className="h-4 w-4 text-[#60A5FA]" />
                  Audit Timeline
                </div>
                <div className="mt-0.5 font-mono text-xs rr-muted">
                  {auditLocationName} · {auditTaskId}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAuditTaskId(null)}
                className="rounded-lg p-1.5 text-[#A1A1AA] hover:bg-[#18181E] hover:text-[#F4F4F5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {auditError ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                  {auditError}
                </div>
              ) : auditEvents.length === 0 ? (
                <div className="py-12 text-center text-xs rr-muted">
                  No audit events recorded for this task yet.
                </div>
              ) : (
                <ol className="relative space-y-4 border-l border-[#222228] pl-5">
                  {auditEvents.map((ev) => (
                    <li key={ev.id} className="relative">
                      <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#0B0B0E] bg-[#3B82F6]" />
                      <div className="rr-surface rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 font-mono text-xs">
                          <span className="font-semibold text-[#F4F4F5]">{ev.action}</span>
                          <span className="text-[11px] rr-muted">
                            {new Date(ev.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="font-mono text-xs text-[#A1A1AA]">
                          actor: {ev.actor}
                          {ev.revision_ref !== null ? ` · rev #${ev.revision_ref}` : ''}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
