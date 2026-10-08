import { getAppPath } from './lib/routing';

function HostShell() {
  return (
    <main className="app-shell app-shell-host">
      <p className="eyebrow">TREASURE QUIZ</p>
      <h1>Treasure Quiz Host</h1>
      <p className="shell-copy">ตั้งโจทย์ คุมจังหวะ และพาเกมไปถึงห้องสมบัติ</p>
    </main>
  );
}

function PlayerShell() {
  return (
    <main className="app-shell app-shell-player">
      <p className="eyebrow">TREASURE QUIZ</p>
      <h1>Treasure Quiz</h1>
      <p className="shell-copy">ตอบให้ดี เก็บทองให้พอ แล้วไปเปิดหีบด้วยกัน</p>
    </main>
  );
}

export default function App() {
  return getAppPath() === '/host' ? <HostShell /> : <PlayerShell />;
}
