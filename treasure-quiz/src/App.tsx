import { useEffect, useState } from 'react';
import { getAppPath } from './lib/routing';
import { getStoredHostPin, hostAction, playerAction } from './lib/api';
import HostLoginScreen from './screens/host/HostLoginScreen';
import HostSetupScreen from './screens/host/HostSetupScreen';
import HostLobbyScreen from './screens/host/HostLobbyScreen';
import type { ChestDraft, GameSnapshot, QuestionDraft } from './domain/types';
import PlayerLoginScreen from './screens/player/PlayerLoginScreen';
import PlayerBriefingScreen from './screens/player/PlayerBriefingScreen';

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
  const [authenticated, setAuthenticated] = useState(false);
  const [game, setGame] = useState<GameSnapshot | null>(null);
  if (!authenticated) return <PlayerLoginScreen action={playerAction} onSuccess={() => setAuthenticated(true)} />;
  if (!game) return <PlayerWaitingScreen onGame={setGame} />;
  return <PlayerBriefingScreen gameId={game.id} roundNo={game.current_round ?? 1} gold={game.gold ?? 200} gems={game.gems ?? 0} questions={[]} action={playerAction} />;
}

function PlayerWaitingScreen({ onGame }: { onGame: (game: GameSnapshot) => void }) {
  const [message, setMessage] = useState('กำลังตามหาเกมปัจจุบัน…');
  useEffect(() => {
    void playerAction<{ game?: GameSnapshot }>('restore_game').then((response) => {
      if (response.game) onGame(response.game);
      else setMessage('รอ Host สร้างเกม แล้วหน้านี้จะอัปเดตเอง');
    }).catch(() => setMessage('เชื่อมต่อแล้ว แต่ยังไม่มีเกมที่กำลังเล่น'));
  }, [onGame]);
  return <main className="player-screen auth-screen"><p className="eyebrow">PLAYER · LOBBY</p><h1>รอ Host เปิดโต๊ะ</h1><p className="lead">{message}</p></main>;
}

export default function App() {
  return getAppPath() === '/host' ? <HostShell /> : <PlayerShell />;
}
