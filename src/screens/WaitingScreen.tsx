import { useGameStore } from '../store/gameStore';
import { useWaitingPlayers } from '../hooks/useWaitingPlayers';

const AV_GRADS = [
  ['#6366F1','#818CF8'],['#8B5CF6','#A78BFA'],['#14B8A6','#34D399'],
  ['#EC4899','#F472B6'],['#F59E0B','#F5C74A'],['#3B82F6','#60A5FA'],['#10B981','#6EE7B7'],
];
const avGrad = (i: number) =>
  `linear-gradient(135deg,${AV_GRADS[i % AV_GRADS.length][0]},${AV_GRADS[i % AV_GRADS.length][1]})`;

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

const PARTICLES = [
  { w: 6, h: 6, top: '18%', left: '12%', bg: 'rgba(245,199,74,.5)',   dur: '5.2s', delay: '0s' },
  { w: 4, h: 4, top: '72%', left: '8%',  bg: 'rgba(245,199,74,.35)',  dur: '6.8s', delay: '1.1s' },
  { w: 5, h: 5, top: '45%', left: '88%', bg: 'rgba(129,140,248,.5)',  dur: '4.9s', delay: '0.6s' },
  { w: 3, h: 3, top: '82%', left: '80%', bg: 'rgba(245,199,74,.4)',   dur: '7.2s', delay: '2s' },
  { w: 4, h: 4, top: '25%', left: '78%', bg: 'rgba(167,139,250,.45)', dur: '5.8s', delay: '0.3s' },
  { w: 6, h: 6, top: '60%', left: '5%',  bg: 'rgba(52,211,153,.35)',  dur: '6.1s', delay: '1.5s' },
];

const RINGS = [
  { w: 220, h: 220, dur: '7s',  delay: '0s' },
  { w: 300, h: 300, dur: '9s',  delay: '1.2s' },
  { w: 380, h: 380, dur: '11s', delay: '2.5s' },
];

export function WaitingScreen() {
  const displayName = useGameStore((s) => s.displayName);
  const { players, loading } = useWaitingPlayers(true);

  return (
    <div style={{ minHeight: '100%', background: 'var(--navy)', color: 'var(--text)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Background glows */}
      <div className="gr-glow gr-glow-a" />
      <div className="gr-glow gr-glow-b" />

      {/* Floating particles */}
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="gr-wait-particle"
          style={{
            width: p.w, height: p.h,
            top: p.top, left: p.left,
            background: p.bg,
            boxShadow: `0 0 ${p.w * 2}px ${p.bg}`,
            '--dur': p.dur, '--delay': p.delay,
          } as React.CSSProperties}
        />
      ))}

      {/* Pulsing rings */}
      {RINGS.map((r, i) => (
        <div
          key={i}
          className="gr-wait-ring"
          style={{
            width: r.w, height: r.h,
            marginLeft: -r.w / 2, marginTop: -r.h / 2,
            borderColor: `rgba(245,199,74,${.18 - i * .05})`,
            '--dur': r.dur, '--delay': r.delay,
          } as React.CSSProperties}
        />
      ))}

      {/* Header */}
      <div className="gr-header">
        <div>
          <div className="gr-label-xs" style={{ marginBottom: 4 }}>Golden Ring · Lobby</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>สวัสดี, {displayName}! 👋</div>
        </div>
        <div className="gr-badge gr-badge-live">Live</div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 24px', display: 'flex', flexDirection: 'column', gap: 14, position: 'relative', zIndex: 1 }}>
        {/* Player count card */}
        <div className="gr-card-gold gr-wait-card-1" style={{ padding: '18px 20px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginBottom: 14 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--gold)',
                  animation: `grBlink 1.3s ${i * 0.22}s ease-in-out infinite`,
                }}
              />
            ))}
          </div>
          <div className="gr-mono gr-wait-count" style={{ fontSize: 38, fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>
            {players.length}
          </div>
          <div className="gr-label-xs" style={{ marginTop: 5 }}>ผู้เล่นในห้อง</div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-2)' }}>กำลังรอพิธีกรเริ่มเกม</div>
        </div>

        {/* Player list card */}
        <div className="gr-card gr-wait-card-2" style={{ padding: '14px 16px' }}>
          <div className="gr-label-xs" style={{ marginBottom: 11 }}>ผู้เล่นในห้อง</div>

          {players.length === 0 && loading ? (
            <p style={{ fontSize: 13, color: 'var(--text-2)' }}>กำลังโหลดรายชื่อผู้เล่น...</p>
          ) : players.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-2)' }}>คุณเป็นผู้เล่นคนแรกในห้องเลยนะ ว้าว!</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {players.map((player, index) => {
                const isMe = player.display_name === displayName;
                return (
                  <div
                    key={player.id}
                    className={`gr-chip ${isMe ? 'gr-chip-me' : ''}`}
                    style={{ animationDelay: `${Math.min(index * 60, 360)}ms` }}
                  >
                    <div className="gr-chip-avatar" style={{ background: avGrad(index) }}>
                      {initials(player.display_name)}
                    </div>
                    <span>{player.display_name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="gr-label-xs" style={{ textAlign: 'center' }}>กำลังรอพิธีกร…</p>
      </div>
    </div>
  );
}
