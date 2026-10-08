import { useState } from 'react';
import type { PlayerActionCaller } from '../../domain/types';

interface ChestOpen { id: string; chest_key?: string; result_satang?: number | null; status?: string; }
interface PlayerChestOpeningScreenProps { gameId: string; opens: ChestOpen[]; action: PlayerActionCaller; }

function baht(satang: number | null | undefined): string { const value = Math.max(0, Math.trunc(satang ?? 0)); return `฿${Math.floor(value / 100).toLocaleString()}.${String(value % 100).padStart(2, '0')}`; }

export default function PlayerChestOpeningScreen({ gameId, opens, action }: PlayerChestOpeningScreenProps) {
  const [results, setResults] = useState<ChestOpen[]>(opens);
  const [busy, setBusy] = useState(false);
  const openAll = async () => { if (busy) return; setBusy(true); try { const response = await action<{ opens?: ChestOpen[] }>('open_all_chests', { gameId }); setResults(response.opens ?? results); } finally { setBusy(false); } };
  const openOne = async (id: string) => { const response = await action<{ chest: ChestOpen }>('open_chest', { gameId, chestOpenId: id }); setResults((current) => current.map((item) => item.id === id ? response.chest : item)); };
  return <main className="player-screen opening-screen"><p className="eyebrow">CHEST OPENING</p><h1>เปิดทีละใบ หรือเปิดทั้งหมด</h1><div className="open-list">{results.map((open) => <article className="open-row" key={open.id}><span>{open.chest_key ?? 'หีบสมบัติ'}</span>{open.status === 'opened' ? <strong>{baht(open.result_satang)}</strong> : <button className="secondary-button" onClick={() => openOne(open.id)}>เปิด</button>}</article>)}</div><button className="primary-button" disabled={busy || results.every((open) => open.status === 'opened')} onClick={openAll}>{busy ? 'กำลังเปิด…' : 'เปิดทั้งหมด'}</button></main>;
}

export { baht };
