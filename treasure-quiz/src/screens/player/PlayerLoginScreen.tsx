import { useState } from 'react';
import type { PlayerActionCaller } from '../../domain/types';

interface PlayerLoginScreenProps { action: PlayerActionCaller; onSuccess: () => void; }

export default function PlayerLoginScreen({ action, onSuccess }: PlayerLoginScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pin.trim()) return;
    try { await action('link_profile', { displayName: 'Player' }, pin.trim()); onSuccess(); } catch { setError('Player PIN ไม่ถูกต้อง หรือเชื่อมต่อไม่ได้'); }
  };
  return <main className="player-screen auth-screen"><p className="eyebrow">TREASURE QUIZ · PLAYER</p><h1>Treasure Quiz</h1><p className="lead">เข้าห้องของเรา แล้วสะสมทองกับเพชรไปเปิดหีบ</p><form className="auth-card" onSubmit={submit}><label htmlFor="player-pin">Player PIN</label><input id="player-pin" value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" placeholder="ใส่ PIN ของคุณ" />{error ? <p role="alert" className="inline-error">{error}</p> : null}<button className="primary-button" type="submit" disabled={!pin.trim()}>เข้าร่วมเกม</button></form></main>;
}
