import type { ChestDraft } from '../../domain/types';

interface ChestSettingsEditorProps { chests: ChestDraft[]; onChange?: (chests: ChestDraft[]) => void; }

export default function ChestSettingsEditor({ chests }: ChestSettingsEditorProps) {
  return <section className="setup-section" aria-labelledby="chests-title">
    <div className="section-heading"><div><p className="eyebrow">02 · CHEST ROOM</p><h2 id="chests-title">ตั้งค่าหีบ</h2></div><span className="count-pill">{chests.length} แบบ</span></div>
    <div className="chest-list">{chests.map((chest) => {
      const total = chest.rewardTable.reduce((sum, reward) => sum + reward.weight, 0);
      return <article className="chest-row" key={chest.key}><div><strong>{chest.name}</strong><small>{chest.goldCost ? `${chest.goldCost} ทอง` : 'ใช้เพชร'}{chest.gemCost ? ` + ${chest.gemCost} เพชร` : ''}</small></div><span className={total === 100 ? 'weight-ok' : 'weight-bad'}>{total}%</span>{total !== 100 ? <p className="inline-error">น้ำหนักรางวัลต้องรวม 100%</p> : null}</article>;
    })}</div>
  </section>;
}
