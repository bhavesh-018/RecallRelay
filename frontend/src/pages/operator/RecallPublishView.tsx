import { useEffect, useState } from 'react';
import {
  ApiError,
  type BatchSummary,
  type BatchTraceSummary,
  type RecallOverview,
  getBatchTrace,
  listBatches,
  publishRecall,
} from '../../api/client';

const DEFAULT_NOTICE =
  'FICTIONAL RECALL DRILL — ACTION REQUIRED: Inspect your location inventory for the affected batch, count all units sold and remaining on hand, and confirm all remaining affected stock has been set aside in quarantine.';

interface RecallPublishViewProps {
  operatorAuthenticated: boolean;
  onPublished: (overview: RecallOverview) => void;
}

export function RecallPublishView({
  operatorAuthenticated,
  onPublished,
}: RecallPublishViewProps) {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchCode, setBatchCode] = useState<string>('B17');
  const [noticeText, setNoticeText] = useState<string>(DEFAULT_NOTICE);
  const [preview, setPreview] = useState<BatchTraceSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listBatches()
      .then((list) => {
        if (!active) return;
        setBatches(list);
        if (list.length > 0 && !list.some((b) => b.batch_code === batchCode)) {
          setBatchCode(list[0].batch_code);
        }
      })
      .catch(() => {
        // Handled when trace loads
      });
    return () => {
      active = false;
    };
  }, [batchCode]);

  useEffect(() => {
    if (!batchCode) return;
    let active = true;
    getBatchTrace(batchCode)
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch(() => {
        if (active) setPreview(null);
      });
    return () => {
      active = false;
    };
  }, [batchCode]);

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultMsg(null);
    if (!operatorAuthenticated) {
      setError('Operator authentication is required to publish a recall notice.');
      return;
    }
    setSubmitting(true);
    try {
      const overview = await publishRecall({
        batch_code: batchCode,
        notice_text: noticeText,
        notice_version: 1,
        is_drill: true,
      });
      setResultMsg(
        overview.idempotent_reused
          ? `Reused existing recall ${overview.id} for Batch ${overview.batch_code} (${overview.total_tasks} tasks).`
          : `Published recall ${overview.id} for Batch ${overview.batch_code} (${overview.total_tasks} tasks created).`,
      );
      onPublished(overview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to publish recall.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rr-panel-enter space-y-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-[#EDEDED]">Publish Recall Drill</h2>
        <p className="mt-0.5 text-xs text-[#A1A1AA]">
          Idempotent publish generates scoped participant tasks exclusively for locations reached by the selected batch.
        </p>
      </div>

      <form onSubmit={handlePublish} className="rounded-lg border border-[#27272A] bg-[#18181B] p-5 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="publish-batch" className="block text-xs font-medium text-[#EDEDED]">
            Affected Batch
          </label>
          <select
            id="publish-batch"
            value={batchCode}
            onChange={(e) => setBatchCode(e.target.value)}
            className="w-full rounded-md border border-[#27272A] bg-[#09090B] px-3 py-2 font-mono text-xs text-[#EDEDED]"
          >
            {batches.map((b) => (
              <option key={b.batch_code} value={b.batch_code}>
                {b.batch_code} · {b.product_name} ({b.opening_quantity} units)
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="publish-notice" className="block text-xs font-medium text-[#EDEDED]">
            Prepared Drill Notice (Identical Across Experiment Variants)
          </label>
          <textarea
            id="publish-notice"
            rows={4}
            value={noticeText}
            onChange={(e) => setNoticeText(e.target.value)}
            className="w-full rounded-md border border-[#27272A] bg-[#09090B] p-3 text-xs leading-relaxed text-[#EDEDED] focus:border-[#3B82F6] focus:outline-none"
          />
        </div>

        {preview && (
          <div className="rounded-md border border-[#27272A] bg-[#09090B] p-3.5 space-y-2">
            <div className="text-xs font-medium text-[#EDEDED]">
              Affected Locations Preview ({preview.nodes.length} tasks will be generated)
            </div>
            <div className="flex flex-wrap gap-2">
              {preview.nodes.map((n) => (
                <span
                  key={n.location_id}
                  className="rounded border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-xs text-[#A1A1AA]"
                >
                  {n.location_name} <span className="font-mono text-[#EDEDED]">({n.received})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {error && <div className="text-xs text-red-400">{error}</div>}
        {resultMsg && <div className="text-xs text-emerald-400">{resultMsg}</div>}

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[#3B82F6] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Publishing…' : `Publish Recall for ${batchCode}`}
          </button>
        </div>
      </form>
    </div>
  );
}
