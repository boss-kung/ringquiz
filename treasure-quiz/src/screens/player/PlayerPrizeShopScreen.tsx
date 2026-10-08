import { useMemo, useState } from 'react';
import ChestCard from '../../components/ChestCard';
import ResourceBar from '../../components/ResourceBar';
import type { PlayerActionCaller } from '../../domain/types';

interface ShopChest { key: string; name: string; goldCost: number; gemCost: number; }
interface PlayerPrizeShopScreenProps { gameId: string; gold: number; gems: number; chests: ShopChest[]; action: PlayerActionCaller; suggestion?: { key: string; quantity: number } | null; onConfirmed?: (opens: unknown[]) => void; }

export default function PlayerPrizeShopScreen({ gameId, gold, gems, chests, action, suggestion, onConfirmed }: PlayerPrizeShopScreenProps) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const byKey = useMemo(() => new Map(chests.map((chest) => [chest.key, chest])), [chests]);
  const remaining = useMemo(() => chests.reduce((result, chest) => ({ gold: result.gold - chest.goldCost * (cart[chest.key] ?? 0), gems: result.gems - chest.gemCost * (cart[chest.key] ?? 0) }), { gold, gems }), [cart, chests, gold, gems]);
  const update = (key: string, delta: number) => setCart((current) => ({ ...current, [key]: Math.max(0, (current[key] ?? 0) + delta) }));
  const applySuggestion = () => { if (!suggestion || !byKey.has(suggestion.key)) return; setCart((current) => ({ ...current, [suggestion.key]: (current[suggestion.key] ?? 0) + suggestion.quantity })); };
  const confirm = async () => {
    if (busy || remaining.gold !== 0 || remaining.gems !== 0) return;
    setBusy(true);
    try { const response = await action<{ opens?: unknown[] }>('submit_chest_cart', { gameId, cart: Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([key, quantity]) => ({ key, quantity })) }); onConfirmed?.(response.opens ?? []); } finally { setBusy(false); }
  };
  return <main className="player-screen shop-screen"><header className="screen-header"><div><p className="eyebrow">PRIZE SHOP</p><h1>เลือกหีบจนใช้หมด</h1><p className="lead">ยิ่งหรู รางวัลยิ่งสูง เปิดได้หลายใบ</p></div><ResourceBar gold={gold} gems={gems} /></header><div className="shop-remaining"><strong>เหลือ {Math.max(0, remaining.gold).toLocaleString()} ทอง</strong><strong>เหลือ {Math.max(0, remaining.gems).toLocaleString()} เพชร</strong></div><div className="chest-grid">{chests.map((chest) => <ChestCard key={chest.key} chest={chest} quantity={cart[chest.key] ?? 0} onAdd={() => update(chest.key, 1)} onRemove={() => update(chest.key, -1)} />)}</div>{suggestion ? <button className="secondary-button suggestion-button" onClick={applySuggestion}>เติมให้หมด · {suggestion.key} × {suggestion.quantity}</button> : null}<button className="primary-button confirm-shop" disabled={busy || remaining.gold !== 0 || remaining.gems !== 0} onClick={confirm}>{busy ? 'กำลังยืนยัน…' : 'ยืนยันการเปิดหีบ'}</button></main>;
}
