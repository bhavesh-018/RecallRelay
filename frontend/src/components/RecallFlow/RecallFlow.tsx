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

const GUIDED_STEP_META: Record<1 | 2 | 3, { label: string; pct: string; width: string }> = {
  1: { label: 'Step 1 of 3 · Count', pct: '33%', width: '33.3%' },
  2: { label: 'Step 2 of 3 · Reconcile', pct: '67%', width: '66.6%' },
  3: { label: 'Step 3 of 3 · Confirm', pct: '100%', width: '100%' },
};

function parseWholeNonNegative(raw: string): number | null {
  if (raw.trim() === '') return null;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 0) return null;
  return num;
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
  const [guidedStep, setGuidedStep] = useState<1 | 2 | 3>(1);

  async function submitValidated(soldNum: number, remNum: number, asideNum: number) {
    await onSubmit({
      forwarded_qty: forwarded,
      sold_qty: soldNum,
      remaining_qty: remNum,
      set_aside_qty: asideNum,
      confirmed_set_aside: confirmed,
    });
  }

  async function handleStandardSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (sold.trim() === '' || remaining.trim() === '' || setAside.trim() === '') {
      setLocalError('Please enter whole numbers for Sold, Remaining, and Set Aside.');
      return;
    }

    const soldNum = parseWholeNonNegative(sold);
    const remNum = parseWholeNonNegative(remaining);
    const asideNum = parseWholeNonNegative(setAside);

    if (soldNum === null || remNum === null || asideNum === null) {
      setLocalError('All quantities must be whole non-negative integers.');
      return;
    }

    await submitValidated(soldNum, remNum, asideNum);
  }

  function handleGuidedStep1Next() {
    setLocalError(null);
    if (sold.trim() === '' || remaining.trim() === '') {
      setLocalError('Please enter whole numbers for Sold and Remaining.');
      return;
    }
    const soldNum = parseWholeNonNegative(sold);
    const remNum = parseWholeNonNegative(remaining);
    if (soldNum === null || remNum === null) {
      setLocalError('All quantities must be whole non-negative integers.');
      return;
    }
    setGuidedStep(2);
  }

  async function handleGuidedFinalSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    const soldNum = parseWholeNonNegative(sold);
    const remNum = parseWholeNonNegative(remaining);
    if (soldNum === null || remNum === null) {
      setLocalError('All quantities must be whole non-negative integers.');
      setGuidedStep(1);
      return;
    }
    if (setAside.trim() === '') {
      setLocalError('Please enter a whole number for Units Set Aside.');
      return;
    }
    const asideNum = parseWholeNonNegative(setAside);
    if (asideNum === null) {
      setLocalError('Set-aside quantity must be a whole non-negative integer.');
      return;
    }
    if (asideNum > remNum) {
      setLocalError(`Set-aside quantity (${asideNum}) cannot exceed remaining stock (${remNum}).`);
      return;
    }

    await submitValidated(soldNum, remNum, asideNum);
  }

  const displayedError = localError || errorMessage;
  const parsedSold = parseWholeNonNegative(sold) ?? 0;
  const parsedRem = parseWholeNonNegative(remaining) ?? 0;
  const computedTotal = forwarded + parsedSold + parsedRem;
  const balanceMatches = computedTotal === received;
  const stepMeta = GUIDED_STEP_META[guidedStep];

  return (
    <div className="rr-panel-enter mx-auto w-full max-w-md space-y-4">
      {/* Mandatory Drill Banner */}
      <div className="flex items-center justify-between rounded-md border border-[#27272A] bg-[#18181B] px-3.5 py-2 text-xs">
        <span className="font-medium text-[#EDEDED]">{banner}</span>
        <span className="font-mono text-[#A1A1AA]">{workflow}</span>
      </div>

      {/* Location & Notice Card (Identical Across Both Variants) */}
      <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-[#EDEDED]">{locationName}</h1>
          <p className="text-xs text-[#A1A1AA]">
            {productName} · Batch <span className="font-mono text-[#EDEDED]">{batchCode}</span>
          </p>
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

      {workflow === 'standard' ? (
        /* VARIANT A: Standard Single-Page Form */
        <form
          onSubmit={handleStandardSubmit}
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
      ) : (
        /* VARIANT B: Guided 3-Step Count -> Reconcile -> Confirm Workflow */
        <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-4">
          {/* Smooth Animated Step Progress */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-xs text-[#A1A1AA]">
              <span>{stepMeta.label}</span>
              <span>{stepMeta.pct}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#09090B]">
              <div
                className="h-full bg-[#3B82F6] transition-all duration-300 ease-out"
                style={{ width: stepMeta.width }}
              />
            </div>
          </div>

          {guidedStep === 1 && (
            <div key="step-1" className="rr-step-slide space-y-4">
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
              </div>

              {displayedError && (
                <div
                  role="alert"
                  className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-xs text-red-400"
                >
                  {displayedError}
                </div>
              )}

              <button
                type="button"
                onClick={handleGuidedStep1Next}
                className="w-full rounded-md bg-[#3B82F6] py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Continue to Reconcile →
              </button>
            </div>
          )}

          {guidedStep === 2 && (
            <div key="step-2" className="rr-step-slide space-y-4">
              <div className="rounded-md border border-[#27272A] bg-[#09090B] p-3.5 font-mono text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-[#A1A1AA]">Received / Opening</span>
                  <span className="text-[#EDEDED]">{received}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A1A1AA]">Forwarded + Sold + Remaining</span>
                  <span className="text-[#EDEDED]">
                    {forwarded} + {parsedSold} + {parsedRem} = {computedTotal}
                  </span>
                </div>
                {balanceMatches ? (
                  <div className="border-t border-[#27272A] pt-2 text-emerald-400">
                    ✓ Stock balance reconciles ({received} = {forwarded} + {parsedSold} + {parsedRem})
                  </div>
                ) : (
                  <div
                    role="alert"
                    className="border-t border-[#27272A] pt-2 text-red-400"
                  >
                    Stock balance mismatch: received ({received}) must equal forwarded ({forwarded}) + sold ({parsedSold}) + remaining ({parsedRem}) = {computedTotal}.
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLocalError(null);
                    setGuidedStep(1);
                  }}
                  className="w-1/3 rounded-md border border-[#27272A] bg-[#09090B] py-3 text-xs font-medium text-[#A1A1AA] transition-colors hover:text-[#EDEDED]"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  disabled={!balanceMatches}
                  onClick={() => {
                    setLocalError(null);
                    setGuidedStep(3);
                  }}
                  className="w-2/3 rounded-md bg-[#3B82F6] py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Continue to Confirm →
                </button>
              </div>
            </div>
          )}

          {guidedStep === 3 && (
            <form key="step-3" onSubmit={handleGuidedFinalSubmit} noValidate className="rr-step-slide space-y-4">
              <div>
                <label htmlFor="rr-set-aside" className="mb-1 block text-xs font-medium text-[#EDEDED]">
                  Units Set Aside (0 ≤ Set Aside ≤ {parsedRem})
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
                  placeholder={String(parsedRem)}
                  className="w-full rounded-md border border-[#27272A] bg-[#09090B] px-3 py-3 font-mono text-base tabular-nums text-[#EDEDED] focus:border-[#3B82F6] focus:outline-none"
                />
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

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLocalError(null);
                    setGuidedStep(2);
                  }}
                  className="w-1/3 rounded-md border border-[#27272A] bg-[#09090B] py-3 text-xs font-medium text-[#A1A1AA] transition-colors hover:text-[#EDEDED]"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-2/3 rounded-md bg-[#3B82F6] py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Submit Recall Response'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
