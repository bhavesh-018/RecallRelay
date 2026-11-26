import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { OperatorConsole } from './pages/operator/OperatorConsole';
import { JoinDrillPage } from './pages/participant/JoinDrillPage';
import { ParticipantTaskPage } from './pages/participant/ParticipantTaskPage';

export function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#09090B] text-[#EDEDED]">
        <header className="border-b border-[#27272A] bg-[#09090B]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-[#3B82F6] text-xs font-bold text-white">
                R
              </div>
              <span className="text-sm font-semibold tracking-tight text-[#EDEDED]">RecallRelay</span>
            </Link>
            <div className="flex items-center gap-3 text-xs font-mono text-[#A1A1AA]">
              <span>Fictional Drill Platform</span>
            </div>
          </div>
        </header>
        <Routes>
          <Route path="/" element={<OperatorConsole />} />
          <Route path="/t/:token" element={<ParticipantTaskPage />} />
          <Route path="/join" element={<JoinDrillPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
