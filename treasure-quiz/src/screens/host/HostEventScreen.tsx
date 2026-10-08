import type { GameSnapshot } from '../../domain/types';

interface HostEventScreenProps { game: GameSnapshot; event?: { code: string; durationRounds?: number } | null; }

export default function HostEventScreen({ game, event }: HostEventScreenProps) {
  return <main className="host-screen event-screen"><p className="eyebrow">HOST · EVENT CHECKPOINT</p><h1>รอ Player เลือกการ์ด</h1><p className="lead">เกม {game.id} · รอบ {game.current_round}</p>{event ? <div className="event-reveal"><strong>{event.code}</strong><span>{event.durationRounds ? `ใช้ได้ ${event.durationRounds} รอบ` : 'ไม่มีผลต่อเนื่อง'}</span></div> : <p className="muted">เมื่อ Player เลือกแล้ว ผลจะขึ้นที่หน้านี้ผ่าน Realtime</p>}</main>;
}
