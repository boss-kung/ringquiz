interface ChestCardProps { chest: { key: string; name: string; goldCost: number; gemCost: number }; quantity: number; onAdd: () => void; onRemove: () => void; }

export default function ChestCard({ chest, quantity, onAdd, onRemove }: ChestCardProps) {
  return <article className="chest-card"><div><p className="eyebrow">{chest.key.toUpperCase()}</p><h2>{chest.name}</h2><p className="muted">{chest.goldCost ? `${chest.goldCost} ทอง` : 'ไม่ใช้ทอง'}{chest.gemCost ? ` · ${chest.gemCost} เพชร` : ''}</p></div><div className="quantity-controls"><button type="button" aria-label={`ลด ${chest.name}`} onClick={onRemove} disabled={quantity === 0}>−</button><strong>{quantity}</strong><button type="button" aria-label={`เพิ่ม ${chest.name}`} onClick={onAdd}>+</button></div></article>;
}
