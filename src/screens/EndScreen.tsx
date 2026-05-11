import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGameStore } from '../store/gameStore';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { LeaderboardTable } from '../components/LeaderboardTable';

// ── Confetti helpers ──────────────────────────────────────────────────────────

interface ConfettiPiece {
  id: number;
  left: string;
  delay: string;
  duration: string;
  drift: string;
  rotate: string;
  color: string;
  size: number;
}

function makeConfetti(count = 30): ConfettiPiece[] {
  const colors = ['#F5C74A', '#FFF8E7', '#34D399', '#818CF8', '#FB7185', '#FBBF24', '#A78BFA'];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${2 + i * 3.2}%`,
    delay: `${(i % 6) * 0.15}s`,
    duration: `${2.4 + (i % 5) * 0.32}s`,
    drift: `${((i % 2 === 0 ? 1 : -1) * (22 + (i % 5) * 10))}px`,
    rotate: `${(i % 2 === 0 ? 1 : -1) * (120 + (i % 7) * 30)}deg`,
    color: colors[i % colors.length],
    size: 5 + (i % 4) * 2,
  }));
}

const SPARKS = Array.from({ length: 10 }, (_, i) => ({
  i,
  left: `${5 + i * 10}%`,
  delay: `${i * 0.22}s`,
  sx: `${(i % 2 ? 1 : -1) * (10 + i * 4)}px`,
}));

// ── Main component ────────────────────────────────────────────────────────────

export function EndScreen() {
  useLeaderboard();

  const leaderboard = useGameStore((s) => s.leaderboard);
  const playerEntry = useGameStore((s) => s.playerLeaderboardEntry);
  const playerId = useGameStore((s) => s.playerId);
  const displayName = useGameStore((s) => s.displayName);

  const winner = leaderboard[0];

  // Ceremony phases: 0 = trophy zoom-in, 1 = name reveal, 2 = show leaderboard
  const [phase, setPhase] = useState(0);
  const phaseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!winner) return;
    phaseTimersRef.current.forEach(clearTimeout);
    phaseTimersRef.current = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 2200),
    ];
    return () => phaseTimersRef.current.forEach(clearTimeout);
  }, [winner?.player_id]);

  const confetti = useMemo(() => makeConfetti(30), [winner?.player_id]);

  const isWinner = winner?.player_id === playerId;

  return (
    <div style={{ position: 'relative', display: 'flex', minHeight: '100%', flexDirection: 'column', overflow: 'hidden', background: 'var(--navy)' }}>
      {/* Background glows */}
      <div className="gr-glow gr-glow-a" />
      <div className="gr-glow gr-glow-b" />

      {/* Confetti burst */}
      {winner && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }} aria-hidden>
          {confetti.map((c) => (
            <span
              key={c.id}
              className="gr-reveal-confetti-piece"
              style={{
                position: 'absolute',
                top: 0,
                left: c.left,
                width: c.size,
                height: c.size,
                borderRadius: c.id % 3 === 0 ? '50%' : 2,
                animationDelay: c.delay,
                animationDuration: c.duration,
                '--gr-confetti-drift': c.drift,
                '--gr-confetti-rotate': c.rotate,
                background: c.color,
                willChange: 'transform, opacity',
              } as CSSProperties}
            />
          ))}
        </div>
      )}

      {/* Celebration sparks */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }} aria-hidden>
        {SPARKS.map((s) => (
          <div
            key={s.i}
            className="gr-spark"
            style={{
              top: '3%',
              left: s.left,
              animationDelay: s.delay,
              '--sx': s.sx,
            } as CSSProperties}
          />
        ))}
      </div>

      {/* Winner hero */}
      <div
        style={{
          flexShrink: 0,
          padding: '36px 22px 18px',
          textAlign: 'center',
          borderBottom: '1px solid var(--border)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Trophy with zoom-in animation */}
        <div
          style={{
            position: 'relative',
            width: 90, height: 90,
            margin: '0 auto 14px',
            animation: 'grFloat 3.5s ease-in-out infinite',
            transform: phase >= 1 ? 'scale(1)' : 'scale(0.4)',
            opacity: phase >= 1 ? 1 : 0,
            transition: 'transform .6s cubic-bezier(.34,1.56,.64,1), opacity .4s ease',
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                inset: i * -9,
                borderRadius: '50%',
                border: `1px solid rgba(245,199,74,${.38 - i * .1})`,
                animation: `grGlowPulse ${7 + i}s ease-in-out infinite`,
              }}
            />
          ))}
          <div
            style={{
              width: 90, height: 90,
              borderRadius: '50%',
              background: 'radial-gradient(circle,rgba(245,199,74,.22),rgba(245,199,74,.06))',
              border: '2px solid rgba(245,199,74,.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 38,
              boxShadow: '0 0 48px rgba(245,199,74,.25), 0 0 16px rgba(245,199,74,.15)',
            }}
          >
            🏆
          </div>
        </div>

        <div
          className="gr-label-sm gr-gold"
          style={{
            marginBottom: 7, letterSpacing: '.18em', fontSize: 14,
            opacity: phase >= 1 ? 1 : 0,
            transform: phase >= 1 ? 'none' : 'translateY(8px)',
            transition: 'opacity .4s .2s ease, transform .4s .2s ease',
          }}
        >
          Final Result
        </div>

        <h2
          style={{
            fontSize: 28, fontWeight: 900, marginBottom: 5, color: 'var(--text)',
            opacity: phase >= 1 ? 1 : 0,
            transform: phase >= 1 ? 'none' : 'translateY(10px)',
            transition: 'opacity .4s .3s ease, transform .4s .3s ease',
          }}
        >
          จบเกม! 🎉
        </h2>

        {winner && (
          <div
            style={{
              opacity: phase >= 1 ? 1 : 0,
              transform: phase >= 1 ? 'none' : 'scale(0.85)',
              transition: 'opacity .5s .5s ease, transform .5s .5s cubic-bezier(.34,1.56,.64,1)',
            }}
          >
            <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 10 }}>
              ผู้ชนะคือ
            </p>
            <div
              style={{
                display: 'inline-block',
                padding: '10px 24px',
                borderRadius: 16,
                background: 'rgba(245,199,74,.1)',
                border: '1.5px solid rgba(245,199,74,.4)',
                boxShadow: '0 0 32px rgba(245,199,74,.12)',
                marginBottom: 14,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--gold)' }}>
                {winner.display_name}
              </span>
              <span
                className="gr-mono"
                style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--text-2)', marginTop: 3 }}
              >
                {winner.cumulative_score.toLocaleString()} คะแนน
              </span>
            </div>
            {isWinner && (
              <div
                style={{
                  fontSize: 15, fontWeight: 800, color: 'var(--gold)',
                  marginBottom: 10,
                  animation: 'grGlowPulse 2s ease-in-out infinite',
                }}
              >
                🎊 คุณคือผู้ชนะ! 🎊
              </div>
            )}
          </div>
        )}

        {playerEntry && (
          <div
            style={{
              opacity: phase >= 2 ? 1 : 0,
              transition: 'opacity .5s ease',
            }}
          >
            <div className="gr-label-xs" style={{ marginBottom: 6, fontSize: 11 }}>
              สถิติของ {displayName}
            </div>
            <div
              className="gr-card-gold"
              style={{ display: 'inline-flex', gap: 18, padding: '11px 20px', borderRadius: 14 }}
            >
              <div style={{ textAlign: 'center' }}>
                <div className="gr-label-xs" style={{ marginBottom: 4, fontSize: 10 }}>อันดับ</div>
                <div className="gr-mono" style={{ fontSize: 22, fontWeight: 900, color: 'var(--gold)' }}>
                  #{playerEntry.rank}
                </div>
              </div>
              <div style={{ width: 1, background: 'rgba(245,199,74,.18)' }} />
              <div style={{ textAlign: 'center' }}>
                <div className="gr-label-xs" style={{ marginBottom: 4, fontSize: 10 }}>คะแนนรวม</div>
                <div className="gr-mono" style={{ fontSize: 22, fontWeight: 900, color: 'var(--gold)' }}>
                  {playerEntry.cumulative_score.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Rankings — fade in after phase 2 */}
      <div
        style={{
          flex: 1, overflowY: 'auto', padding: '14px 16px 20px',
          position: 'relative', zIndex: 1,
          opacity: phase >= 2 ? 1 : 0,
          transition: 'opacity .5s .2s ease',
        }}
      >
        <div className="gr-label-xs" style={{ textAlign: 'center', marginBottom: 10 }}>
          Final Rankings
        </div>
        <LeaderboardTable
          entries={leaderboard}
          playerId={playerId}
          playerEntry={playerEntry}
          showPodium
        />
      </div>
    </div>
  );
}
