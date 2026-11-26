import { useEffect, useState } from 'react';
import {
  type BatchSummary,
  type BatchTraceSummary,
  getBatchTrace,
  listBatches,
} from '../../api/client';

function nodeStroke(status: string): string {
  if (status === 'reconciled') return '#10B981';
  if (status === 'discrepancy') return '#EF4444';
  if (status === 'pending_quarantine') return '#F59E0B';
  return '#27272A';
}

function nodeDotFill(status: string): string {
  if (status === 'reconciled') return '#10B981';
  if (status === 'discrepancy') return '#EF4444';
  if (status === 'pending_quarantine') return '#F59E0B';
  return '#71717A';
}

export function BatchTraceView() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selectedCode, setSelectedCode] = useState<string>('');
  const [trace, setTrace] = useState<BatchTraceSummary | null>(null);
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
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load batch trace.');
      });
    return () => {
      active = false;
    };
  }, [selectedCode]);

  // Compute fixture-agnostic layered positions (BFS depth from opening_location_id)
  const layout = (() => {
    if (!trace) return { positions: new Map<string, { x: number; y: number }>(), width: 720, height: 180 };
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
    const colGap = 240;
    const rowGap = 72;
    const width = Math.max(700, colCount * colGap + 40);
    const height = Math.max(176, maxRows * rowGap + 24);
    const positions = new Map<string, { x: number; y: number }>();

    for (const [colIdx, locIds] of columns.entries()) {
      const x = 16 + colIdx * colGap;
      const totalColHeight = locIds.length * rowGap;
      const startY = Math.max(14, (height - totalColHeight) / 2 + 8);
      locIds.forEach((locId, rowIdx) => {
        positions.set(locId, { x, y: startY + rowIdx * rowGap });
      });
    }
    return { positions, width, height };
  })();

  return (
    <div className="rr-panel-enter space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-[#EDEDED]">Batch Shipment Trace</h2>
          <p className="mt-0.5 text-xs text-[#A1A1AA]">
            Fixture-agnostic distribution graph built directly from accepted shipment transfers
          </p>
        </div>
        <div className="flex items-center gap-2">
          {batches.map((b) => (
            <button
              key={b.batch_code}
              type="button"
              onClick={() => setSelectedCode(b.batch_code)}
              className={`rounded-md border px-3 py-1.5 font-mono text-xs transition-colors ${
                selectedCode === b.batch_code
                  ? 'border-[#3B82F6] bg-[#18181B] text-[#EDEDED]'
                  : 'border-[#27272A] bg-[#09090B] text-[#A1A1AA] hover:text-[#EDEDED]'
              }`}
            >
              {b.batch_code} ({b.opening_quantity})
              {b.has_active_recall ? ' · Active' : ''}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-[#18181B] p-4 text-xs text-red-400">
          {error}
        </div>
      )}

      {trace && (
        <>
          {/* Architectural SVG Graph */}
          <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-[#EDEDED]">
                {trace.product_name} · <span className="font-mono">{trace.batch_code}</span>
              </span>
              <span className="font-mono text-[#A1A1AA]">
                {trace.total_remaining} remaining + {trace.total_sold} sold = {trace.accounted_total} / {trace.opening_quantity}
              </span>
            </div>

            <div className="overflow-x-auto rounded border border-[#27272A] bg-[#09090B] p-2">
              <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="h-auto w-full min-w-[600px] select-none"
                role="img"
                aria-label={`Shipment trace graph for batch ${trace.batch_code}`}
              >
                {trace.edges.map((edge) => {
                  const from = layout.positions.get(edge.sender_id);
                  const to = layout.positions.get(edge.receiver_id);
                  if (!from || !to) return null;
                  const x1 = from.x + 178;
                  const y1 = from.y + 26;
                  const x2 = to.x;
                  const y2 = to.y + 26;
                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2;
                  return (
                    <g key={edge.shipment_id}>
                      <path
                        d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke="#27272A"
                        strokeWidth="1.5"
                      />
                      <rect x={mx - 15} y={my - 10} width="30" height="20" rx="4" fill="#18181B" stroke="#27272A" />
                      <text
                        x={mx}
                        y={my + 4}
                        textAnchor="middle"
                        fill="#A1A1AA"
                        fontSize="10"
                        fontFamily="monospace"
                      >
                        {edge.quantity}
                      </text>
                    </g>
                  );
                })}

                {trace.nodes.map((node) => {
                  const pos = layout.positions.get(node.location_id);
                  if (!pos) return null;
                  return (
                    <g key={node.location_id}>
                      <rect
                        x={pos.x}
                        y={pos.y}
                        width="178"
                        height="52"
                        rx="6"
                        fill="#18181B"
                        stroke={nodeStroke(node.status)}
                        strokeWidth="1.2"
                      />
                      <circle cx={pos.x + 13} cy={pos.y + 18} r="3.5" fill={nodeDotFill(node.status)} />
                      <text
                        x={pos.x + 23}
                        y={pos.y + 21}
                        fill="#EDEDED"
                        fontSize="11"
                        fontWeight="600"
                      >
                        {node.location_name.slice(0, 21)}
                      </text>
                      <text
                        x={pos.x + 12}
                        y={pos.y + 39}
                        fill="#A1A1AA"
                        fontSize="10"
                        fontFamily="monospace"
                      >
                        Recv {node.received} · Fwd {node.forwarded} · Rem {node.remaining}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Recorded Shipments Table */}
          <div className="overflow-x-auto rounded-lg border border-[#27272A] bg-[#18181B]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#27272A] bg-[#09090B] text-[#A1A1AA]">
                  <th className="px-4 py-2.5 font-medium">Shipment</th>
                  <th className="px-3 py-2.5 font-medium">From</th>
                  <th className="px-3 py-2.5 font-medium">To</th>
                  <th className="px-3 py-2.5 text-right font-medium">Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272A] font-mono tabular-nums">
                {trace.edges.map((edge) => (
                  <tr key={edge.shipment_id}>
                    <td className="px-4 py-2.5 text-[#A1A1AA]">{edge.shipment_id}</td>
                    <td className="px-3 py-2.5 font-sans text-[#EDEDED]">{edge.sender_name}</td>
                    <td className="px-3 py-2.5 font-sans text-[#EDEDED]">{edge.receiver_name}</td>
                    <td className="px-3 py-2.5 text-right text-[#EDEDED]">{edge.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
