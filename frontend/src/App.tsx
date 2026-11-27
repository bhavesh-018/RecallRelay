import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { BrandLogo } from './components/BrandLogo';
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
          <Link to="/" className="group flex items-center gap-2.5 transition-opacity hover:opacity-95">
            <BrandLogo size="sm" showWordmark subtitle="Supply Chain Recall & Flagsmith Workbench" />
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
