import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ApiError,
  type ScopedTaskView,
  type TaskResponseResult,
  getScopedTask,
  submitTaskResponse,
} from '../../api/client';
import { RecallFlow, type RecallFlowValues } from '../../components/RecallFlow';

export function ParticipantTaskPage() {
  const { token } = useParams<{ token: string }>();
  const [task, setTask] = useState<ScopedTaskView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TaskResponseResult | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('Missing scoped task token.');
      setLoading(false);
      return;
    }
    let active = true;
    getScopedTask(token)
      .then((data) => {
        if (!active) return;
        setTask(data);
        if (data.current_response) {
          setReceipt({
            task_id: data.task_id,
            task_status: data.status,
            idempotent_duplicate: false,
            response: data.current_response,
          });
        }
      })
      .catch((err) => {
        if (active) {
          setLoadError(err instanceof ApiError ? err.message : 'Unable to load recall task.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function handleSubmit(values: RecallFlowValues) {
    if (!token || !task) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitTaskResponse(token, {
        task_id: task.task_id,
        ...values,
      });
      setReceipt(result);
      setEditing(false);
      setTask((prev) =>
        prev
          ? {
              ...prev,
              status: result.task_status,
              current_response: result.response,
            }
          : prev,
      );
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Submission failed. Please verify your counts.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-md px-4 py-8 text-xs text-[#A1A1AA]">
        Loading scoped recall task…
      </main>
    );
  }

  if (loadError || !task) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <div className="rounded-lg border border-red-900/60 bg-[#18181B] p-5 text-xs text-red-400">
          {loadError || 'Recall task not found.'}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      {receipt && !editing ? (
        <div className="rr-panel-enter space-y-4">
          <div className="rounded-md border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs font-medium text-[#EDEDED]">
            {task.banner}
          </div>
          <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-5 space-y-4">
            <div>
              <div className="text-xs font-mono text-emerald-400">
                {receipt.task_status === 'reconciled' ? '✓ Reconciled' : 'Recorded (Pending Quarantine Confirmation)'}
              </div>
              <h1 className="mt-1 text-base font-semibold text-[#EDEDED]">Response Receipt</h1>
              <p className="text-xs text-[#A1A1AA]">
                {task.location_name} · Batch {task.batch_code} · Revision #{receipt.response.revision}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-2 font-mono text-xs">
              <div className="rounded border border-[#27272A] bg-[#09090B] p-2.5">
                <dt className="text-[#A1A1AA]">Sold</dt>
                <dd className="mt-0.5 text-sm font-semibold text-[#EDEDED]">{receipt.response.sold_qty}</dd>
              </div>
              <div className="rounded border border-[#27272A] bg-[#09090B] p-2.5">
                <dt className="text-[#A1A1AA]">Remaining</dt>
                <dd className="mt-0.5 text-sm font-semibold text-[#EDEDED]">{receipt.response.remaining_qty}</dd>
              </div>
              <div className="rounded border border-[#27272A] bg-[#09090B] p-2.5">
                <dt className="text-[#A1A1AA]">Set Aside</dt>
                <dd className="mt-0.5 text-sm font-semibold text-[#EDEDED]">{receipt.response.set_aside_qty}</dd>
              </div>
              <div className="rounded border border-[#27272A] bg-[#09090B] p-2.5">
                <dt className="text-[#A1A1AA]">Updated</dt>
                <dd className="mt-0.5 text-[#EDEDED]">
                  {new Date(receipt.response.updated_at).toLocaleTimeString()}
                </dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={() => setEditing(true)}
              className="w-full rounded-md border border-[#27272A] bg-[#09090B] py-2.5 text-xs font-medium text-[#EDEDED] transition-colors hover:border-[#3B82F6]"
            >
              Reopen / Revise Response
            </button>
          </div>
        </div>
      ) : (
        <RecallFlow
          banner={task.banner}
          batchCode={task.batch_code}
          productName={task.product_name}
          locationName={task.location_name}
          noticeText={task.notice_text}
          received={task.received}
          forwarded={task.forwarded}
          workflow="standard"
          initialValues={task.current_response ?? undefined}
          submitting={submitting}
          errorMessage={submitError}
          onSubmit={handleSubmit}
        />
      )}
    </main>
  );
}
