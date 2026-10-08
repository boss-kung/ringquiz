import { useMemo, useState } from 'react';
import ResourceBar from '../../components/ResourceBar';
import type { PlayerActionCaller } from '../../domain/types';

interface BriefingQuestion { id: string; keyword?: string; prompt: string; choices?: string[]; }
interface PlayerBriefingScreenProps { gameId: string; roundNo: number; gold: number; gems: number; questions: BriefingQuestion[]; action: PlayerActionCaller; onPlacedBet?: () => void; }

export default function PlayerBriefingScreen({ gameId, roundNo, gold, gems, questions, action, onPlacedBet }: PlayerBriefingScreenProps) {
  const [busy, setBusy] = useState(false);
  const keywords = useMemo(() => questions.map((question) => question.keyword ?? '').filter((keyword) => keyword.length > 0).sort((a, b) => a.localeCompare(b)), [questions]);
  const target = roundNo <= 2 ? 'ถูกอย่างน้อย 8/10' : roundNo <= 6 ? 'ถูกอย่างน้อย 4/5' : 'ถูกครบ 5/5';
  const placeBet = async (betType: 'safe' | 'gold' | 'diamond') => {
    if (busy) return;
    setBusy(true);
    try { await action('place_bet', { gameId, roundNo, betType }); onPlacedBet?.(); } finally { setBusy(false); }
  };
  return <main className="player-screen briefing-screen"><header className="screen-header"><div><p className="eyebrow">ROUND {roundNo} · BRIEFING</p><h1>อ่านคีย์เวิร์ด แล้วเลือกเดิมพัน</h1><p className="lead">เป้าหมายรอบนี้: {target}</p></div><ResourceBar gold={gold} gems={gems} /></header><section className="keyword-card"><p className="eyebrow">KEYWORDS</p><div className="keyword-cloud">{keywords.length ? keywords.map((keyword) => <span key={keyword}>{keyword}</span>) : <span>ยังไม่มี keyword</span>}</div><p className="muted">จะยังไม่เห็นโจทย์จริงจนกว่า Host จะเริ่มรอบ</p></section><div className="bet-grid"><button className="bet-button safe" disabled={busy} onClick={() => placeBet('safe')}><strong>เดิมพัน Safe</strong><small>ไม่เสียทรัพยากร</small></button><button className="bet-button gold" disabled={busy || gold < 100} onClick={() => placeBet('gold')}><strong>เดิมพัน Gold</strong><small>ใช้ 100 ทอง · โบนัส 50%</small></button><button className="bet-button diamond" disabled={busy || gems < 1} onClick={() => placeBet('diamond')}><strong>เดิมพัน Diamond</strong><small>ใช้ 1 เพชร · โบนัส 100%</small></button></div></main>;
}
