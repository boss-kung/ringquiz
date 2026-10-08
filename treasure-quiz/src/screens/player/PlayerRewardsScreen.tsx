import { useState } from 'react';
import type { PlayerActionCaller } from '../../domain/types';
import { baht } from './PlayerChestOpeningScreen';

interface RewardItem { id: string; title: string; cost_satang: number; }
interface PlayerRewardsScreenProps { rewards: RewardItem[]; balanceSatang: number; action: PlayerActionCaller; }

export default function PlayerRewardsScreen({ rewards, balanceSatang, action }: PlayerRewardsScreenProps) {
  const [requested, setRequested] = useState<string | null>(null);
  const request = async (rewardCatalogId: string) => { await action('request_redemption', { rewardCatalogId }); setRequested(rewardCatalogId); };
  return <main className="player-screen rewards-screen"><p className="eyebrow">REWARD CATALOG</p><h1>แลกเงินรางวัล</h1><p className="lead">ยอดสะสมปัจจุบัน {baht(balanceSatang)} · Host จะมอบรางวัลจริงนอกระบบ</p><div className="reward-catalog-list">{rewards.map((reward) => <article className="reward-catalog-card" key={reward.id}><div><strong>{reward.title}</strong><span>{baht(reward.cost_satang)}</span></div><button className="secondary-button" disabled={requested === reward.id || balanceSatang < reward.cost_satang} onClick={() => request(reward.id)}>{requested === reward.id ? 'ส่งคำขอแล้ว' : 'ขอแลก'}</button></article>)}</div></main>;
}
