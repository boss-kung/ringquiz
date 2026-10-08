import { useState } from 'react';
import type { HostActionCaller } from '../../domain/types';

interface Redemption { id: string; title?: string; cost_satang: number; status: 'pending' | 'completed' | 'cancelled'; }
interface HostRedemptionsScreenProps { redemptions: Redemption[]; action: HostActionCaller; }

export default function HostRedemptionsScreen({ redemptions, action }: HostRedemptionsScreenProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const update = async (id: string, actionName: 'complete_redemption' | 'cancel_redemption') => { setBusy(id); try { await action(actionName, { redemptionId: id }); } finally { setBusy(null); } };
  return <main className="host-screen rewards-screen"><p className="eyebrow">HOST · REDEMPTIONS</p><h1>คำขอแลกรางวัล</h1><div className="redemption-list">{redemptions.map((redemption) => <article className="redemption-row" key={redemption.id}><div><strong>{redemption.title ?? 'Reward request'}</strong><span>{(redemption.cost_satang / 100).toLocaleString()} บาท · {redemption.status}</span></div>{redemption.status === 'pending' ? <div className="host-controls"><button className="primary-button" disabled={busy === redemption.id} onClick={() => update(redemption.id, 'complete_redemption')}>มอบแล้ว</button><button className="secondary-button" disabled={busy === redemption.id} onClick={() => update(redemption.id, 'cancel_redemption')}>ยกเลิก</button></div> : null}</article>)}</div></main>;
}
