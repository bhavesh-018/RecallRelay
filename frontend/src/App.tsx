import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { BrandLogo } from './components/BrandLogo';
import { ThemeProvider, ThemeToggle } from './components/ThemeContext';
import { OperatorConsole } from './pages/operator/OperatorConsole';
import { JoinDrillPage } from './pages/participant/JoinDrillPage';
import { ParticipantTaskPage } from './pages/participant/ParticipantTaskPage';

function AppShell() {
  const location = useLocation();
  const isParticipantRoute = location.pathname.startsWith('/t/') || location.pathname === '/join';

  return (
    <div className="min-h-screen bg-[#09090B] text-[#F4F4F5] selection:bg-[#3B82F6]/30 selection:text-white">
      {isParticipantRoute && (
        <header className="sticky top-0 z-30 border-b border-[#222228] bg-[#09090B]/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
            <Link to="/" className="transition-opacity hover:opacity-90">
              <BrandLogo size="sm" showWordmark />
            </Link>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                <ShieldAlert className="h-3.5 w-3.5" />
                Fictional Drill
              </span>
              <ThemeToggle />
            </div>
          </div>
        </header>
      )}

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
    <ThemeProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
