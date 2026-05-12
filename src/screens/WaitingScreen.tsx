import type { CSSProperties } from 'react';
import { useGameStore } from '../store/gameStore';
import { PlayerPracticeCard } from '../components/PlayerPracticeCard';
import { SoundFxToggle } from '../components/SoundFxToggle';
import { getAvatarGrad, getInitials, readStoredColorIndex, readStoredEmoji } from '../lib/avatarColor';

const PARTICLES = [
  { w: 6, h: 6, top: '18%', left: '12%', bg: 'rgba(245,199,74,.5)', dur: '5.2s', delay: '0s' },
  { w: 4, h: 4, top: '72%', left: '8%', bg: 'rgba(245,199,74,.35)', dur: '6.8s', delay: '1.1s' },
  { w: 5, h: 5, top: '45%', left: '88%', bg: 'rgba(129,140,248,.5)', dur: '4.9s', delay: '0.6s' },
  { w: 3, h: 3, top: '82%', left: '80%', bg: 'rgba(245,199,74,.4)', dur: '7.2s', delay: '2s' },
  { w: 4, h: 4, top: '25%', left: '78%', bg: 'rgba(167,139,250,.45)', dur: '5.8s', delay: '0.3s' },
];

export function WaitingScreen() {
  const displayName = useGameStore((s) => s.displayName);
  const colorIdx = readStoredColorIndex();
  const emoji    = readStoredEmoji();

  return (
    <div className="pw-screen">
      <div className="gr-glow gr-glow-a" />
      <div className="gr-glow gr-glow-b" />

      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="gr-wait-particle"
          style={{
            width: p.w,
            height: p.h,
            top: p.top,
            left: p.left,
            background: p.bg,
            boxShadow: `0 0 ${p.w * 2}px ${p.bg}`,
            '--dur': p.dur,
            '--delay': p.delay,
          } as CSSProperties}
        />
      ))}

      <div className="gr-header pw-header">
        <div className="pw-header-copy">
          <div className="gr-label-xs">Golden Ring · Lobby</div>
          <div className="pw-header-title" style={{ fontSize: 24, fontWeight: 800 }}>
            รอเริ่มเกม
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SoundFxToggle />
          <div className="gr-badge gr-badge-live">Live</div>
        </div>
      </div>

      <div className="pw-body">
        <div className="gr-card-gold pw-status-bar">
          <div className="pw-status-line" style={{ fontSize: 20, alignItems: 'center' }}>
            <span className="pw-status-dot" />
            <div
              style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: getAvatarGrad(colorIdx),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: emoji ? 20 : 13, fontWeight: 900, color: 'white',
                boxShadow: '0 0 10px rgba(0,0,0,.3)',
              }}
            >
              {emoji || getInitials(displayName ?? '') || '?'}
            </div>
            ยินดีต้อนรับ!<strong>{displayName}</strong>
          </div>
        </div>

        <PlayerPracticeCard />
      </div>
    </div>
  );
}
