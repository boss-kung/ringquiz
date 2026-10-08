import { useState } from 'react';
import { setStoredHostPin } from '../../lib/api';

interface HostLoginScreenProps {
  onSuccess: () => void;
  error?: string;
}

export default function HostLoginScreen({ onSuccess, error }: HostLoginScreenProps) {
  const [pin, setPin] = useState('');
  return (
    <main className="host-screen auth-screen">
      <p className="eyebrow">TREASURE QUIZ · HOST</p>
      <h1>Treasure Quiz Host</h1>
      <h2>เปิดโต๊ะสมบัติ</h2>
      <p className="lead">ตั้งคำถาม คุมจังหวะ แล้วพา Player ไปเปิดหีบ</p>
      <form onSubmit={(event) => { event.preventDefault(); if (!pin.trim()) return; setStoredHostPin(pin.trim()); onSuccess(); }} className="auth-card">
        <label htmlFor="host-pin">Host PIN</label>
        <input id="host-pin" value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="ใส่ PIN ส่วนตัว" />
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={!pin.trim()}>เข้าหน้า Host</button>
      </form>
    </main>
  );
}
