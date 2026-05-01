import { useGameStore } from './store/gameStore';
import { useGameState } from './hooks/useGameState';
import { useServerTime } from './hooks/useServerTime';
import { useQuestion } from './hooks/useQuestion';

import { useExistingAnswer } from './hooks/useExistingAnswer';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useSessionVersionCheck } from './hooks/useSessionVersionCheck';
import { useSaveSessionVersion } from './hooks/useSaveSessionVersion';
import { JoinScreen } from './screens/JoinScreen';
import { WaitingScreen } from './screens/WaitingScreen';
import { CountdownScreen } from './screens/CountdownScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { LockedScreen } from './screens/LockedScreen';
import { RevealScreen } from './screens/RevealScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { EndScreen } from './screens/EndScreen';
import { HostPage } from './screens/host/HostPage';

function getAppPath() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const pathname = window.location.pathname;

  if (basePath && basePath !== '/' && pathname.startsWith(basePath)) {
    const stripped = pathname.slice(basePath.length);
    return stripped.startsWith('/') ? stripped : `/${stripped || ''}`;
  }

  return pathname;
}

// Simple URL-based routing: /host → Host UI, everything else → Player UI.
// On GitHub Pages the app lives under /ringquiz/, so we strip BASE_URL first.
const appPath = getAppPath();
const isHost = appPath === '/host' || appPath.startsWith('/host/');

export default function App() {
  // These hooks run for both player and host; host-specific data (question stats) is polled inside HostPage
  useServerTime();
  useGameState();
  useQuestion();

  if (isHost) return <HostPage />;
  return <PlayerApp />;
}

function PlayerApp() {
  const { restoring } = useSessionRestore();
  useExistingAnswer();
  useSessionVersionCheck();
  useSaveSessionVersion();

  const isJoined = useGameStore((s) => s.isJoined);
  const gameState = useGameStore((s) => s.gameState);
  const submitted = useGameStore((s) => s.submitted);

  if (restoring) {
    return (
      <div className="flex items-center justify-center min-h-full bg-slate-900">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isJoined) return <JoinScreen />;

  // Game state drives which screen to show
  const status = gameState?.status;

  if (!status || status === 'waiting') return <WaitingScreen />;
  if (status === 'countdown') return <CountdownScreen />;

  if (status === 'question_open') {
    // Show locked screen if player already submitted this question
    return submitted ? <LockedScreen /> : <QuestionScreen />;
  }

  if (status === 'question_closed') return <LockedScreen />;
  if (status === 'reveal') return <RevealScreen />;
  if (status === 'leaderboard') return <LeaderboardScreen />;
  if (status === 'ended') return <EndScreen />;

  // Fallback — unknown status
  return <WaitingScreen />;
}
