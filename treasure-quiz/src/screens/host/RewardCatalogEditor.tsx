import type { RewardDraft } from '../../domain/types';

interface RewardCatalogEditorProps { rewards?: RewardDraft[]; }

export default function RewardCatalogEditor({ rewards = [] }: RewardCatalogEditorProps) {
  return <section className="setup-section" aria-labelledby="rewards-title"><div className="section-heading"><div><p className="eyebrow">03 · REWARD SHOP</p><h2 id="rewards-title">รางวัลแลกจริง</h2></div><span className="count-pill">{rewards.length} รายการ</span></div><div className="reward-list">{rewards.length ? rewards.map((reward) => <div className="reward-row" key={reward.id ?? reward.title}><strong>{reward.title}</strong><span>{(reward.costSatang / 100).toLocaleString()} บาท</span></div>) : <p className="muted">เพิ่มรางวัลหลังจบเกมได้จากหน้า Host</p>}</div></section>;
}
