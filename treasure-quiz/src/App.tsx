import { useCallback, useEffect, useState } from 'react';
import { getAppPath } from './lib/routing';
import { getStoredHostPin, hostAction, playerAction } from './lib/api';
import HostLoginScreen from './screens/host/HostLoginScreen';
import HostSetupScreen from './screens/host/HostSetupScreen';
import HostLobbyScreen from './screens/host/HostLobbyScreen';
import type { ChestDraft, GameSnapshot, QuestionDraft } from './domain/types';
import PlayerLoginScreen from './screens/player/PlayerLoginScreen';
import PlayerBriefingScreen from './screens/player/PlayerBriefingScreen';
import PlayerQuestionScreen from './screens/player/PlayerQuestionScreen';
import PlayerEventScreen from './screens/player/PlayerEventScreen';
import PlayerPrizeShopScreen from './screens/player/PlayerPrizeShopScreen';
import PlayerChestOpeningScreen from './screens/player/PlayerChestOpeningScreen';
import PlayerRoundResultScreen from './screens/player/PlayerRoundResultScreen';
import PlayerWalletScreen from './screens/player/PlayerWalletScreen';
import PlayerRewardsScreen from './screens/player/PlayerRewardsScreen';
import HostGameScreen from './screens/host/HostGameScreen';
import HostEventScreen from './screens/host/HostEventScreen';
import HostRedemptionsScreen from './screens/host/HostRedemptionsScreen';
import { useGameRealtime } from './hooks/useGameRealtime';

const starterChests: ChestDraft[] = [
  { key: 'copper', name: 'หีบทองแดง', goldCost: 100, gemCost: 0, rewardTable: [{ amountSatang: 1, weight: 60 }, { amountSatang: 10, weight: 30 }, { amountSatang: 50, weight: 10 }] },
  { key: 'silver', name: 'หีบเงิน', goldCost: 300, gemCost: 0, rewardTable: [{ amountSatang: 50, weight: 55 }, { amountSatang: 100, weight: 35 }, { amountSatang: 200, weight: 10 }] },
  { key: 'gold', name: 'หีบทอง', goldCost: 700, gemCost: 1, rewardTable: [{ amountSatang: 100, weight: 50 }, { amountSatang: 200, weight: 30 }, { amountSatang: 500, weight: 18 }, { amountSatang: 1000, weight: 2 }] },
  { key: 'diamond', name: 'หีบเพชร', goldCost: 1500, gemCost: 3, rewardTable: [{ amountSatang: 500, weight: 50 }, { amountSatang: 1000, weight: 30 }, { amountSatang: 2000, weight: 17 }, { amountSatang: 5000, weight: 2 }, { amountSatang: 10000, weight: 1 }] },
  { key: 'crystal', name: 'หีบคริสตัล', goldCost: 0, gemCost: 1, rewardTable: [{ amountSatang: 10, weight: 60 }, { amountSatang: 50, weight: 30 }, { amountSatang: 100, weight: 10 }] },
  { key: 'consolation', name: 'หีบปลอบใจ', goldCost: 0, gemCost: 0, rewardTable: [{ amountSatang: 1, weight: 100 }] },
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
  if (!game) return <HostSetupScreen initialQuestions={starterQuestions} initialChests={starterChests} action={hostAction} onCreated={(created) => setGame({ phase: 'waiting', ...created })} />;
  if (game.phase === 'waiting') {
    return <HostLobbyScreen game={game} action={hostAction} onStarted={setGame} />;
  }
  if (game.phase === 'event') {
    return <HostEventScreen game={game} onContinue={() => { void hostAction<{ game?: GameSnapshot }>('advance_phase', { gameId: game.id, phase: 'briefing' }).then((response) => { if (response.game) setGame(response.game); }); }} />;
  }
  if (game.phase === 'finished') return <HostFinishedScreen action={hostAction} />;
  return <HostGameScreen game={game} action={hostAction} onGameChange={setGame} />;
}

interface PlayerRestore {
  game: GameSnapshot;
  round?: { deadline?: string | null; [key: string]: unknown } | null;
  question?: { id: string; prompt: string; choices: string[]; [key: string]: unknown } | null;
  questions?: Array<{ id: string; prompt: string; keyword?: string; choices: string[]; [key: string]: unknown }>;
  opens?: Array<{ id: string; chest_key?: string; result_satang?: number | null; status?: string }>;
  wallet?: { balanceSatang: number; entries: Array<Record<string, unknown>> } | null;
  rewards?: Array<{ id: string; title: string; cost_satang: number }>;
}

function PlayerShell() {
  const [authenticated, setAuthenticated] = useState(false);
  const [restore, setRestore] = useState<PlayerRestore | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await playerAction<PlayerRestore>('restore_game');
      if (response.game) setRestore(response);
    } catch {
      setRestore(null);
    }
  }, []);
  useGameRealtime(restore?.game.id ?? null, () => { void refresh(); });
  useEffect(() => { if (authenticated) void refresh(); }, [authenticated, refresh]);
  if (!authenticated) return <PlayerLoginScreen action={playerAction} onSuccess={() => setAuthenticated(true)} />;
  if (!restore?.game) return <PlayerWaitingScreen onRestore={setRestore} />;
  const { game, round, question, questions = [] } = restore;
  const roundNo = game.current_round || 1;
  const common = { gameId: game.id, roundNo, gold: game.gold ?? 0, gems: game.gems ?? 0, action: playerAction };
  if (game.phase === 'waiting') return <main className="player-screen auth-screen"><p className="eyebrow">PLAYER · READY</p><h1>เข้าห้องแล้ว</h1><p className="lead">รอ Host กดเริ่มเกม แล้วคีย์เวิร์ดเดิมพันจะปรากฏที่นี่</p></main>;
  if (game.phase === 'briefing') return <PlayerBriefingScreen {...common} questions={questions} onPlacedBet={refresh} />;
  if (game.phase === 'playing' && round?.deadline && (question || questions[0])) {
    const currentQuestion = question ?? questions[0];
    return <PlayerQuestionScreen gameId={game.id} roundNo={roundNo} question={{ ...currentQuestion, questions }} deadline={round.deadline} action={playerAction} onComplete={refresh} />;
  }
  if (game.phase === 'round_result') return <PlayerRoundResultScreen roundNo={roundNo} gold={game.gold ?? 0} gems={game.gems ?? 0} onContinue={refresh} />;
  if (game.phase === 'event') return <PlayerEventScreen {...common} onComplete={refresh} />;
  if (game.phase === 'prize_shop') return <PlayerPrizeShopScreen gameId={game.id} gold={game.gold ?? 0} gems={game.gems ?? 0} chests={starterChests} action={playerAction} onConfirmed={() => void refresh()} />;
  if (game.phase === 'chest_opening') return <PlayerChestOpeningScreen gameId={game.id} opens={restore.opens ?? []} action={playerAction} />;
  return <PlayerEndScreen restore={restore} />;
}

function PlayerEndScreen({ restore }: { restore: PlayerRestore }) {
  return <>
    <PlayerWalletScreen action={playerAction} />
    <PlayerRewardsScreen rewards={restore.rewards ?? []} balanceSatang={restore.wallet?.balanceSatang ?? 0} action={playerAction} />
  </>;
}

function HostFinishedScreen({ action }: { action: typeof hostAction }) {
  const [redemptions, setRedemptions] = useState<Array<{ id: string; title?: string; cost_satang: number; status: 'pending' | 'completed' | 'cancelled' }>>([]);
  useEffect(() => {
    void action<{ redemptions?: typeof redemptions }>('get_redemptions')
      .then((response) => setRedemptions(response.redemptions ?? []))
      .catch(() => setRedemptions([]));
  }, [action]);
  return <HostRedemptionsScreen redemptions={redemptions} action={action} />;
}

function PlayerWaitingScreen({ onRestore }: { onRestore: (restore: PlayerRestore) => void }) {
  const [message, setMessage] = useState('กำลังตามหาเกมปัจจุบัน…');
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await playerAction<PlayerRestore>('restore_game');
        if (active && response.game) onRestore(response);
        else if (active) setMessage('รอ Host สร้างเกม แล้วหน้านี้จะอัปเดตเอง');
      } catch { if (active) setMessage('เชื่อมต่อแล้ว แต่ยังไม่มีเกมที่กำลังเล่น'); }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 1800);
    return () => { active = false; window.clearInterval(timer); };
  }, [onRestore]);
  return <main className="player-screen auth-screen"><p className="eyebrow">PLAYER · LOBBY</p><h1>รอ Host เปิดโต๊ะ</h1><p className="lead">{message}</p></main>;
}

export default function App() {
  return getAppPath() === '/host' ? <HostShell /> : <PlayerShell />;
}
