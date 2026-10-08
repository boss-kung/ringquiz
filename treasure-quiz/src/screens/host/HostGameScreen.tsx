import { useState } from 'react';
import { useGameRealtime } from '../../hooks/useGameRealtime';
import type { GameSnapshot, HostActionCaller } from '../../domain/types';

interface HostGameScreenProps { game: GameSnapshot; action: HostActionCaller; submittedCount?: number; totalQuestions?: number; }

export default function HostGameScreen({ game, action, submittedCount = 0, totalQuestions = 0 }: HostGameScreenProps) {
  useGameRealtime(game.id);
  const [busy, setBusy] = useState(false);
  const run = async (name: 'start_round' | 'reveal_round' | 'advance_phase') => { if (busy) return; setBusy(true); try { await action(name, { gameId: game.id, roundNo: game.current_round }); } finally { setBusy(false); } };
  return <main className="host-screen game-screen"><header className="screen-header"><div><p className="eyebrow">HOST · ROUND {game.current_round ?? 0}</p><h1>คุมจังหวะเกม</h1><p className="lead">สถานะ: {game.phase}</p></div><span className="live-badge">{submittedCount}/{totalQuestions} ANSWERS</span></header><div className="host-controls"><button className="primary-button" onClick={() => run('start_round')} disabled={busy}>เริ่มรอบ</button><button className="secondary-button" onClick={() => run('reveal_round')} disabled={busy}>เปิดผล</button><button className="secondary-button" onClick={() => run('advance_phase')} disabled={busy}>ไปรอบถัดไป</button></div><p className="muted">Host เห็นจำนวนคำตอบ แต่เฉลยและยอดรางวัลจะเปิดเมื่อกดเปิดผล</p></main>;
}
