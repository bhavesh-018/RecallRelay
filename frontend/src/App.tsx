import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert, Radio } from 'lucide-react';
import { OperatorConsole } from './pages/operator/OperatorConsole';
import { JoinDrillPage } from './pages/participant/JoinDrillPage';
import { ParticipantTaskPage } from './pages/participant/ParticipantTaskPage';

function AppShell() {
  const location = useLocation();
  const isParticipantRoute = location.pathname.startsWith('/t/') || location.pathname === '/join';

  return (
    <div className="min-h-screen bg-[#09090B] text-[#F4F4F5] selection:bg-[#3B82F6]/30 selection:text-white">
      <header className="sticky top-0 z-30 border-b border-[#27272A]/80 bg-[#09090B]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
          <Link to="/" className="group flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-[#3B82F6]/40 bg-[#3B82F6]/15 text-[#60A5FA] transition-colors group-hover:bg-[#3B82F6]/25">
              <Radio className="h-4 w-4" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight text-[#F4F4F5]">RecallRelay</span>
              <span className="hidden rounded border border-[#27272A] bg-[#141417] px-1.5 py-0.5 font-mono text-[10px] text-[#A1A1AA] sm:inline">
                v1.0
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>Fictional Drill Platform</span>
            </span>
            {!isParticipantRoute && (
              <Link
                to="/join"
                className="hidden rounded-md border border-[#27272A] bg-[#141417] px-2.5 py-1 text-xs font-medium text-[#A1A1AA] transition-colors hover:border-[#3F3F46] hover:text-[#F4F4F5] sm:inline-flex"
              >
                Participant /join
              </Link>
            )}
          </div>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<OperatorConsole />} />
        <Route path="/t/:token" element={<ParticipantTaskPage />} />
        <Route path="/join" element={<JoinDrillPage />} />
      </Routes>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
