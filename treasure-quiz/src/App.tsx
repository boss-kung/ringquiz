import { useState } from 'react';
import { getAppPath } from './lib/routing';
import { getStoredHostPin, hostAction } from './lib/api';
import HostLoginScreen from './screens/host/HostLoginScreen';
import HostSetupScreen from './screens/host/HostSetupScreen';
import HostLobbyScreen from './screens/host/HostLobbyScreen';
import type { ChestDraft, GameSnapshot, QuestionDraft } from './domain/types';

const starterChests: ChestDraft[] = [
  { key: 'copper', name: 'หีบทองแดง', goldCost: 100, gemCost: 0, rewardTable: [{ amountSatang: 1, weight: 60 }, { amountSatang: 10, weight: 30 }, { amountSatang: 50, weight: 10 }] },
  { key: 'silver', name: 'หีบเงิน', goldCost: 300, gemCost: 0, rewardTable: [{ amountSatang: 50, weight: 55 }, { amountSatang: 100, weight: 35 }, { amountSatang: 200, weight: 10 }] },
];

const starterQuestions: QuestionDraft[] = Array.from({ length: 50 }, (_, index) => {
  const roundNo = index < 20 ? Math.floor(index / 10) + 1 : Math.floor((index - 20) / 5) + 3;
  return {
    id: `starter-${index + 1}`,
    roundNo,
    position: index < 20 ? (index % 10) + 1 : (index % 5) + 1,
    questionType: roundNo <= 2 ? 'true_false' : roundNo >= 7 ? 'no_mistake' : roundNo >= 5 ? 'time_bank' : 'multiple_choice',
    prompt: `คำถามตัวอย่างข้อ ${index + 1}`,
    keyword: `หัวข้อ ${index + 1}`,
    choices: roundNo <= 2 ? ['ใช่', 'ไม่ใช่'] : ['ตัวเลือก A', 'ตัวเลือก B', 'ตัวเลือก C', 'ตัวเลือก D'],
    correctAnswer: roundNo <= 2 ? 'ใช่' : 'ตัวเลือก A',
    difficulty: 1,
  };
});

function HostShell() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(getStoredHostPin()));
  const [game, setGame] = useState<GameSnapshot | null>(null);
  if (!authenticated) return <HostLoginScreen onSuccess={() => setAuthenticated(true)} />;
  if (game) return <HostLobbyScreen game={game} action={hostAction} />;
  return <HostSetupScreen initialQuestions={starterQuestions} initialChests={starterChests} action={hostAction} onCreated={(created) => setGame({ phase: 'waiting', ...created })} />;
}

function PlayerShell() {
  return (
    <main className="app-shell app-shell-player">
      <p className="eyebrow">TREASURE QUIZ</p>
      <h1>Treasure Quiz</h1>
      <p className="shell-copy">ตอบให้ดี เก็บทองให้พอ แล้วไปเปิดหีบด้วยกัน</p>
    </main>
  );
}

export default function App() {
  return getAppPath() === '/host' ? <HostShell /> : <PlayerShell />;
}
