import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, GitBranch, Layers } from 'lucide-react';
import {
  type BatchSummary,
  type BatchTraceSummary,
  getBatchTrace,
  listBatches,
} from '../../api/client';

function nodeStroke(status: string, highlighted: boolean): string {
  if (highlighted) return '#3B82F6';
  if (status === 'reconciled') return '#10B981';
  if (status === 'discrepancy') return '#EF4444';
  if (status === 'pending_quarantine') return '#F59E0B';
  return '#2E2E34';
}

function nodeDotFill(status: string): string {
  if (status === 'reconciled') return '#10B981';
  if (status === 'discrepancy') return '#EF4444';
  if (status === 'pending_quarantine') return '#F59E0B';
  return '#71717A';
}

const TIER_LABELS = ['TIER 1 · SOURCE', 'TIER 2 · DISTRIBUTION', 'TIER 3 · RETAIL', 'TIER 4 · DOWNSTREAM'];

export function BatchTraceView() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selectedCode, setSelectedCode] = useState<string>('');
  const [trace, setTrace] = useState<BatchTraceSummary | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listBatches()
      .then((list) => {
        if (!active) return;
        setBatches(list);
        if (list.length > 0 && !selectedCode) {
          setSelectedCode(list[0].batch_code);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load batches.');
      });
    return () => {
      active = false;
    };
  }, [selectedCode]);

  useEffect(() => {
    if (!selectedCode) return;
    let active = true;
    getBatchTrace(selectedCode)
      .then((data) => {
        if (!active) return;
        setTrace(data);
        setSelectedNodeId(null);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load batch trace.');
      });
    return () => {
      active = false;
    };
  }, [selectedCode]);

  // Fixture-agnostic layered BFS layout that scales cleanly from 5 to 20+ nodes
  const layout = useMemo(() => {
    if (!trace) {
      return {
        positions: new Map<string, { x: number; y: number }>(),
        colHeaders: [] as Array<{ x: number; label: string; count: number }>,
        width: 780,
        height: 220,
      };
    }
    const depth = new Map<string, number>();
    depth.set(trace.opening_location_id, 0);
    const queue = [trace.opening_location_id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDepth = depth.get(current) ?? 0;
      for (const edge of trace.edges) {
        if (edge.sender_id === current && !depth.has(edge.receiver_id)) {
          depth.set(edge.receiver_id, currentDepth + 1);
          queue.push(edge.receiver_id);
        }
      }
    }
    const columns = new Map<number, string[]>();
    for (const node of trace.nodes) {
      const d = depth.get(node.location_id) ?? 0;
      const list = columns.get(d) ?? [];
      list.push(node.location_id);
      columns.set(d, list);
    }

    const colCount = Math.max(columns.size, 1);
    const maxRows = Math.max(...Array.from(columns.values()).map((c) => c.length), 1);
    const nodeW = 204;
    const colGap = 276;
    const rowGap = maxRows > 8 ? 64 : 74;
    const topPad = 44;
    const width = Math.max(820, (colCount - 1) * colGap + nodeW + 48);
    const height = Math.max(220, topPad + maxRows * rowGap + 20);
    const positions = new Map<string, { x: number; y: number }>();
    const colHeaders: Array<{ x: number; label: string; count: number }> = [];

    for (const [colIdx, locIds] of Array.from(columns.entries()).sort((a, b) => a[0] - b[0])) {
      const x = 24 + colIdx * colGap;
      colHeaders.push({
        x,
        label: TIER_LABELS[colIdx] ?? `TIER ${colIdx + 1}`,
        count: locIds.length,
      });
      const totalColHeight = locIds.length * rowGap;
      const startY = topPad + Math.max(0, (height - topPad - totalColHeight) / 2);
      locIds.forEach((locId, rowIdx) => {
        positions.set(locId, { x, y: startY + rowIdx * rowGap });
      });
    }
    return { positions, colHeaders, width, height };
  }, [trace]);

  const activeNode = useMemo(
    () => trace?.nodes.find((n) => n.location_id === selectedNodeId) ?? null,
    [trace, selectedNodeId],
  );

  return (
    <div className="rr-panel-enter space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[#F4F4F5]">Batch Shipment Topology</h2>
          <p className="mt-1 text-xs text-[#A1A1AA]">
            Click any node to highlight its upstream/downstream transfer path · Conservation verified across all tiers
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {batches.map((b) => (
            <button
              key={b.batch_code}
              type="button"
              onClick={() => setSelectedCode(b.batch_code)}
              className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-all ${
                selectedCode === b.batch_code
                  ? 'border-[#3B82F6] bg-[#3B82F6]/15 text-[#F4F4F5]'
                  : 'border-[#27272A] bg-[#141417] text-[#A1A1AA] hover:border-[#3F3F46] hover:text-[#F4F4F5]'
              }`}
            >
              {b.batch_code} ({b.opening_quantity})
              {b.has_active_recall ? ' · Active' : ''}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-[#141417] p-4 text-xs text-red-400">
          {error}
        </div>
      )}

      {trace && (
        <>
          <div className="rr-surface rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-[#60A5FA]" />
                <span className="font-medium text-[#F4F4F5]">{trace.product_name}</span>
                <span className="rounded border border-[#27272A] bg-[#09090B] px-1.5 py-0.5 font-mono text-[11px] text-[#60A5FA]">
                  {trace.batch_code}
                </span>
                <span className="text-[#71717A]">
                  · {trace.nodes.length} nodes · {trace.edges.length} transfers
                </span>
              </div>
              <span className="font-mono text-[11px] text-[#A1A1AA]">
                {trace.total_remaining} rem + {trace.total_sold} sold ={' '}
                <span className="text-[#F4F4F5]">
                  {trace.accounted_total} / {trace.opening_quantity}
                </span>
              </span>
            </div>

            <div className="rr-dot-grid overflow-x-auto rounded-lg border border-[#27272A] p-2">
              <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="h-auto w-full min-w-[700px] select-none"
                role="img"
                aria-label={`Shipment trace graph for batch ${trace.batch_code}`}
              >
                {/* Tier Column Headers */}
                {layout.colHeaders.map((col) => (
                  <g key={col.label}>
                    <text
                      x={col.x}
                      y={22}
                      fill="#71717A"
                      fontSize="10"
                      fontWeight="600"
                      fontFamily="monospace"
                      letterSpacing="0.06em"
                    >
                      {col.label} ({col.count})
                    </text>
                  </g>
                ))}

                {/* Directed Transfer Curves */}
                {trace.edges.map((edge) => {
                  const from = layout.positions.get(edge.sender_id);
                  const to = layout.positions.get(edge.receiver_id);
                  if (!from || !to) return null;
                  const x1 = from.x + 204;
                  const y1 = from.y + 26;
                  const x2 = to.x;
                  const y2 = to.y + 26;
                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2;
                  const isConnected =
                    selectedNodeId !== null &&
                    (edge.sender_id === selectedNodeId || edge.receiver_id === selectedNodeId);
                  const dimmed = selectedNodeId !== null && !isConnected;
                  return (
                    <g key={edge.shipment_id} opacity={dimmed ? 0.25 : 1}>
                      <path
                        d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke={isConnected ? '#3B82F6' : '#32323A'}
                        strokeWidth={isConnected ? '2' : '1.4'}
                      />
                      <rect
                        x={mx - 16}
                        y={my - 10}
                        width="32"
                        height="20"
                        rx="5"
                        fill={isConnected ? '#172554' : '#141417'}
                        stroke={isConnected ? '#3B82F6' : '#27272A'}
                      />
                      <text
                        x={mx}
                        y={my + 4}
                        textAnchor="middle"
                        fill={isConnected ? '#93C5FD' : '#A1A1AA'}
                        fontSize="10"
                        fontFamily="monospace"
                      >
                        {edge.quantity}
                      </text>
                    </g>
                  );
                })}

                {/* Supply-Chain Location Nodes */}
                {trace.nodes.map((node) => {
                  const pos = layout.positions.get(node.location_id);
                  if (!pos) return null;
                  const isSelected = selectedNodeId === node.location_id;
                  const isNeighbor =
                    selectedNodeId !== null &&
                    trace.edges.some(
                      (e) =>
                        (e.sender_id === selectedNodeId && e.receiver_id === node.location_id) ||
                        (e.receiver_id === selectedNodeId && e.sender_id === node.location_id),
                    );
                  const dimmed = selectedNodeId !== null && !isSelected && !isNeighbor;
                  return (
                    <g
                      key={node.location_id}
                      onClick={() =>
                        setSelectedNodeId((prev) => (prev === node.location_id ? null : node.location_id))
                      }
                      className="cursor-pointer"
                      opacity={dimmed ? 0.35 : 1}
                    >
                      <rect
                        x={pos.x}
                        y={pos.y}
                        width="204"
                        height="52"
                        rx="8"
                        fill={isSelected ? '#1C1C24' : '#141417'}
                        stroke={nodeStroke(node.status, isSelected)}
                        strokeWidth={isSelected ? '1.8' : '1.2'}
                      />
                      <circle cx={pos.x + 14} cy={pos.y + 18} r="3.5" fill={nodeDotFill(node.status)} />
                      <text
                        x={pos.x + 25}
                        y={pos.y + 21}
                        fill="#F4F4F5"
                        fontSize="11"
                        fontWeight="600"
                      >
                        {node.location_name.length > 24
                          ? `${node.location_name.slice(0, 23)}…`
                          : node.location_name}
                      </text>
                      <text
                        x={pos.x + 14}
                        y={pos.y + 39}
                        fill="#A1A1AA"
                        fontSize="10"
                        fontFamily="monospace"
                      >
                        In {node.received} · Out {node.forwarded} · Rem {node.remaining}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Selected Node Inspector */}
            {activeNode && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/10 px-3.5 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-[#60A5FA]" />
                  <span className="font-semibold text-[#F4F4F5]">{activeNode.location_name}</span>
                  <span className="rounded border border-[#27272A] bg-[#09090B] px-1.5 py-0.5 text-[10px] capitalize text-[#A1A1AA]">
                    {activeNode.role}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#E4E4E7]">
                  <span>Received: {activeNode.received}</span>
                  <span>Forwarded: {activeNode.forwarded}</span>
                  <span>Sold: {activeNode.sold}</span>
                  <span>Remaining: {activeNode.remaining}</span>
                  <span>Status: {activeNode.status}</span>
                </div>
              </div>
            )}
          </div>

          {/* Recorded Shipments Ledger */}
          <div className="rr-surface overflow-hidden rounded-xl">
            <div className="border-b border-[#27272A] bg-[#0D0D10] px-4 py-2.5 text-xs font-medium text-[#A1A1AA]">
              Accepted Shipment Transfers ({trace.edges.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#27272A] bg-[#09090B] text-[11px] uppercase tracking-wider text-[#71717A]">
                    <th className="px-4 py-2.5 font-medium">Shipment ID</th>
                    <th className="px-3 py-2.5 font-medium">Route</th>
                    <th className="px-4 py-2.5 text-right font-medium">Units</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272A]/70 font-mono tabular-nums">
                  {trace.edges.map((edge) => (
                    <tr key={edge.shipment_id} className="transition-colors hover:bg-[#1C1C21]/60">
                      <td className="px-4 py-2.5 text-[#71717A]">{edge.shipment_id}</td>
                      <td className="px-3 py-2.5 font-sans text-[#F4F4F5]">
                        <span className="inline-flex items-center gap-2">
                          <span>{edge.sender_name}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-[#71717A]" />
                          <span>{edge.receiver_name}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-[#F4F4F5]">{edge.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
