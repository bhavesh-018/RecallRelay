import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';

function OperatorShell() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-6 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center rounded border border-[#27272A] bg-[#09090B] px-2 py-0.5 text-xs font-mono text-[#A1A1AA]">
              Phase 1 Baseline
            </span>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-[#EDEDED]">
              RecallRelay Operator Console
            </h1>
          </div>
          <Link
            to="/join"
            className="rounded-md bg-[#3B82F6] px-3.5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            Preview Participant Entry
          </Link>
        </div>
        <p className="text-sm text-[#A1A1AA]">
          Supply chain batch recall coordination, deterministic stock reconciliation, live Flagsmith experimentation, and bounded AI workflow orchestration.
        </p>
      </div>
    </main>
  );
}

function ParticipantPlaceholder() {
  return (
    <main className="mx-auto max-w-md px-4 py-8 space-y-4">
      <div className="rounded-md border border-[#27272A] bg-[#18181B] px-3 py-2 text-xs font-medium text-[#EDEDED]">
        Fictional recall drill
      </div>
      <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-5 space-y-3">
        <h2 className="text-base font-semibold text-[#EDEDED]">Participant Drill Entry</h2>
        <p className="text-xs text-[#A1A1AA]">
          Scoped QR tasks and Flagsmith-controlled workflows (`standard` / `guided`) will mount here in Phases 4–7.
        </p>
        <Link
          to="/"
          className="inline-block text-xs text-[#3B82F6] hover:underline"
        >
          ← Back to Operator Console
        </Link>
      </div>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#09090B] text-[#EDEDED]">
        <header className="border-b border-[#27272A] bg-[#09090B]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-[#3B82F6] text-xs font-bold text-white">
                R
              </div>
              <span className="text-sm font-semibold tracking-tight">RecallRelay</span>
            </div>
            <span className="text-xs font-mono text-[#A1A1AA]">API :8080</span>
          </div>
        </header>
        <Routes>
          <Route path="/" element={<OperatorShell />} />
          <Route path="/join" element={<ParticipantPlaceholder />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
