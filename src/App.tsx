import { useGameStore } from './store/gameStore';
import { useGameState } from './hooks/useGameState';
import { useServerTime } from './hooks/useServerTime';
import { useQuestion } from './hooks/useQuestion';

import { useExistingAnswer } from './hooks/useExistingAnswer';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useSessionVersionCheck } from './hooks/useSessionVersionCheck';
import { useSaveSessionVersion } from './hooks/useSaveSessionVersion';
import { getAppPath, isDisplayPath, isHostPath } from './lib/routing';
import { JoinScreen } from './screens/JoinScreen';
import { WaitingScreen } from './screens/WaitingScreen';
import { CountdownScreen } from './screens/CountdownScreen';
import { QuestionScreen } from './screens/QuestionScreen';
import { LockedScreen } from './screens/LockedScreen';
import { RevealScreen } from './screens/RevealScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { EndScreen } from './screens/EndScreen';
import { HostPage } from './screens/host/HostPage';
import { DisplayPage } from './screens/DisplayPage';

// Simple URL-based routing: /host → Host UI, /display → Display UI, else → Player UI.
// On GitHub Pages the app lives under /ringquiz/, so we strip BASE_URL first.
const appPath = getAppPath();
const isHost = isHostPath(appPath);
const isDisplay = isDisplayPath(appPath);

export default function App() {
  // Display page is fully standalone — no shared hooks, no player state
  if (isDisplay) return <DisplayPage />;

  // Host + player share game state hooks
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
