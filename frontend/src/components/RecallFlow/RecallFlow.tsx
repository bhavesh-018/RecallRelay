import { useState } from 'react';

export type RecallWorkflowMode = 'standard' | 'guided';

export interface RecallFlowValues {
  forwarded_qty: number;
  sold_qty: number;
  remaining_qty: number;
  set_aside_qty: number;
  confirmed_set_aside: boolean;
}

export interface RecallFlowProps {
  banner?: string;
  batchCode: string;
  productName: string;
  locationName: string;
  noticeText: string;
  received: number;
  forwarded: number;
  workflow?: RecallWorkflowMode;
  initialValues?: Partial<RecallFlowValues>;
  submitting?: boolean;
  errorMessage?: string | null;
  onSubmit: (values: RecallFlowValues) => Promise<void> | void;
}

export function RecallFlow({
  banner = 'Fictional recall drill',
  batchCode,
  productName,
  locationName,
  noticeText,
  received,
  forwarded,
  workflow = 'standard',
  initialValues,
  submitting = false,
  errorMessage = null,
  onSubmit,
}: RecallFlowProps) {
  const [sold, setSold] = useState<string>(
    initialValues?.sold_qty !== undefined ? String(initialValues.sold_qty) : '',
  );
  const [remaining, setRemaining] = useState<string>(
    initialValues?.remaining_qty !== undefined ? String(initialValues.remaining_qty) : '',
  );
  const [setAside, setSetAside] = useState<string>(
    initialValues?.set_aside_qty !== undefined ? String(initialValues.set_aside_qty) : '',
  );
  const [confirmed, setConfirmed] = useState<boolean>(initialValues?.confirmed_set_aside ?? false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (sold.trim() === '' || remaining.trim() === '' || setAside.trim() === '') {
      setLocalError('Please enter whole numbers for Sold, Remaining, and Set Aside.');
      return;
    }

    const soldNum = Number(sold);
    const remNum = Number(remaining);
    const asideNum = Number(setAside);

    if (
      !Number.isInteger(soldNum) ||
      !Number.isInteger(remNum) ||
      !Number.isInteger(asideNum) ||
      soldNum < 0 ||
      remNum < 0 ||
      asideNum < 0
    ) {
      setLocalError('All quantities must be whole non-negative integers.');
      return;
    }

    await onSubmit({
      forwarded_qty: forwarded,
      sold_qty: soldNum,
      remaining_qty: remNum,
      set_aside_qty: asideNum,
      confirmed_set_aside: confirmed,
    });
  }

  const displayedError = localError || errorMessage;

  return (
    <div className="rr-panel-enter mx-auto w-full max-w-md space-y-4">
      {/* Mandatory Drill Banner */}
      <div className="flex items-center justify-between rounded-md border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs">
        <span className="font-medium text-[#EDEDED]">{banner}</span>
        <span className="font-mono text-[#A1A1AA]">{workflow}</span>
      </div>

      {/* Location & Notice Card */}
      <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-[#EDEDED]">{locationName}</h1>
            <p className="text-xs text-[#A1A1AA]">
              {productName} · Batch <span className="font-mono text-[#EDEDED]">{batchCode}</span>
            </p>
          </div>
        </div>

        <p className="rounded-md border border-[#27272A] bg-[#09090B] p-3 text-xs leading-relaxed text-[#A1A1AA]">
          {noticeText}
        </p>

        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          <div className="rounded-md border border-[#27272A] bg-[#09090B] px-3 py-2">
            <div className="text-[#A1A1AA]">Received / Opening</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums text-[#EDEDED]">{received}</div>
          </div>
          <div className="rounded-md border border-[#27272A] bg-[#09090B] px-3 py-2">
            <div className="text-[#A1A1AA]">Forwarded</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums text-[#EDEDED]">{forwarded}</div>
          </div>
        </div>
      </div>

      {/* Standard Single-Page Form */}
      <form
        onSubmit={handleFormSubmit}
        noValidate
        className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-4"
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="rr-sold" className="mb-1 block text-xs font-medium text-[#EDEDED]">
              Units Sold
            </label>
            <input
              id="rr-sold"
              name="sold_qty"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={sold}
              onChange={(e) => setSold(e.target.value)}
              placeholder="0"
              className="w-full rounded-md border border-[#27272A] bg-[#09090B] px-3 py-3 font-mono text-base tabular-nums text-[#EDEDED] focus:border-[#3B82F6] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="rr-remaining" className="mb-1 block text-xs font-medium text-[#EDEDED]">
              Units Remaining at Location
            </label>
            <input
              id="rr-remaining"
              name="remaining_qty"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={remaining}
              onChange={(e) => setRemaining(e.target.value)}
              placeholder="0"
              className="w-full rounded-md border border-[#27272A] bg-[#09090B] px-3 py-3 font-mono text-base tabular-nums text-[#EDEDED] focus:border-[#3B82F6] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="rr-set-aside" className="mb-1 block text-xs font-medium text-[#EDEDED]">
              Units Set Aside (0 ≤ Set Aside ≤ Remaining)
            </label>
            <input
              id="rr-set-aside"
              name="set_aside_qty"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={setAside}
              onChange={(e) => setSetAside(e.target.value)}
              placeholder="0"
              className="w-full rounded-md border border-[#27272A] bg-[#09090B] px-3 py-3 font-mono text-base tabular-nums text-[#EDEDED] focus:border-[#3B82F6] focus:outline-none"
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[#27272A] bg-[#09090B] p-3 text-xs text-[#A1A1AA]">
          <input
            id="rr-confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#3B82F6]"
          />
          <span>I confirm that all remaining affected stock at this location has been set aside.</span>
        </label>

        {displayedError && (
          <div
            role="alert"
            className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-xs text-red-400"
          >
            {displayedError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-[#3B82F6] py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit Recall Response'}
        </button>
      </form>
    </div>
  );
}
