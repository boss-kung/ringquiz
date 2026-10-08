import { useState } from 'react';
import ResourceBar from '../../components/ResourceBar';
import type { PlayerActionCaller } from '../../domain/types';

interface PlayerEventScreenProps { gameId: string; roundNo: number; gold: number; gems: number; action: PlayerActionCaller; onComplete?: () => void; }

export default function PlayerEventScreen({ gameId, roundNo, gold, gems, action, onComplete }: PlayerEventScreenProps) {
  const [busy, setBusy] = useState(false);
  const [event, setEvent] = useState<{ code: string; durationRounds?: number } | null>(null);
  const choose = async (choice: 'skip' | 'gold' | 'diamond') => {
    if (busy) return;
    setBusy(true);
    try { const response = await action<{ event?: { code: string; durationRounds?: number } }>('buy_event', { gameId, choice }); setEvent(response.event ?? null); onComplete?.(); } finally { setBusy(false); }
  };
  if (event) return <main className="player-screen event-screen"><p className="eyebrow">EVENT · ROUND {roundNo}</p><h1>การ์ดที่ได้</h1><div className="event-reveal"><strong>{event.code}</strong><span>{event.durationRounds ? `ใช้ได้ ${event.durationRounds} รอบ` : 'ไม่มีผลต่อเนื่อง'}</span></div></main>;
  return <main className="player-screen event-screen"><header className="screen-header"><div><p className="eyebrow">EVENT CHECKPOINT · ROUND {roundNo}</p><h1>เลือกการ์ดอีเวนต์</h1><p className="lead">เลือกได้หนึ่งใบ แล้ว Host จะเปิดผลพร้อมกัน</p></div><ResourceBar gold={gold} gems={gems} /></header><div className="event-grid"><button className="event-choice skip" disabled={busy} onClick={() => choose('skip')}><strong>Skip</strong><small>ไม่เสียทรัพยากร</small></button><button className="event-choice gold" disabled={busy || gold < 150} onClick={() => choose('gold')}><strong>Gold Event</strong><small>ใช้ 150 ทอง</small></button><button className="event-choice diamond" disabled={busy || gems < 1} onClick={() => choose('diamond')}><strong>Diamond Event</strong><small>ใช้ 1 เพชร</small></button></div></main>;
}
