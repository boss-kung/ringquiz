import { useGameStore } from './store/gameStore';
import { useGameState } from './hooks/useGameState';
import { useServerTime } from './hooks/useServerTime';
import { useQuestion } from './hooks/useQuestion';

import { useExistingAnswer } from './hooks/useExistingAnswer';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useSessionVersionCheck } from './hooks/useSessionVersionCheck';
import { useSaveSessionVersion } from './hooks/useSaveSessionVersion';
import { usePlayerFeedbackFx } from './hooks/usePlayerFeedbackFx';
import { getAppPath, isDisplayPath, isHostPath } from './lib/routing';
import { FeedbackFxLayer } from './components/FeedbackFxLayer';
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
  usePlayerFeedbackFx();

  const isJoined = useGameStore((s) => s.isJoined);
  const gameState = useGameStore((s) => s.gameState);
  const submitted = useGameStore((s) => s.submitted);
  const submitPending = useGameStore((s) => s.submitPending);

  if (restoring) {
    return (
      <div className="flex items-center justify-center min-h-full bg-slate-900">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  let screen: JSX.Element;

  if (!isJoined) {
    screen = <JoinScreen />;
  } else {
    const status = gameState?.status;

    if (!status || status === 'waiting') {
      screen = <WaitingScreen />;
    } else if (status === 'countdown') {
      screen = <CountdownScreen />;
    } else if (status === 'question_open') {
      screen = submitted || submitPending ? <LockedScreen /> : <QuestionScreen />;
    } else if (status === 'question_closed') {
      screen = <LockedScreen />;
    } else if (status === 'reveal') {
      screen = <RevealScreen />;
    } else if (status === 'leaderboard') {
      screen = <LeaderboardScreen />;
    } else if (status === 'ended') {
      screen = <EndScreen />;
    } else {
      screen = <WaitingScreen />;
    }
  }

  return (
    <>
      <FeedbackFxLayer />
      {screen}
    </>
  );
}
