import type { GameSnapshot } from '../../domain/types';

interface HostChestScreenProps { game: GameSnapshot; }

export default function HostChestScreen({ game }: HostChestScreenProps) {
  return <main className="host-screen event-screen"><p className="eyebrow">HOST · PRIZE SHOP</p><h1>ดูผลการเปิดหีบ</h1><p className="lead">เกม {game.id} · เงิน/เพชรของ Player ถูกล็อกโดย server</p><p className="muted">ผลเงินรางวัลจะเพิ่มเข้า Wallet และเห็นพร้อมกันผ่าน Realtime</p></main>;
}
