import { useGameStore } from '../store/gameStore';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { LeaderboardTable } from '../components/LeaderboardTable';

const SPARKS = Array.from({ length: 8 }, (_, i) => ({
  i,
  left: `${8 + i * 12}%`,
  delay: `${i * 0.28}s`,
  sx: `${(i % 2 ? 1 : -1) * (8 + i * 4)}px`,
}));

export function EndScreen() {
  useLeaderboard();

  const leaderboard = useGameStore((s) => s.leaderboard);
  const playerEntry = useGameStore((s) => s.playerLeaderboardEntry);
  const playerId = useGameStore((s) => s.playerId);
  const displayName = useGameStore((s) => s.displayName);

  const winner = leaderboard[0];

  return (
    <div style={{ position: 'relative', display: 'flex', minHeight: '100%', flexDirection: 'column', overflow: 'hidden', background: 'var(--navy)' }}>
      {/* Background glows */}
      <div className="gr-glow gr-glow-a" />
      <div className="gr-glow gr-glow-b" />

      {/* Celebration sparks */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
        {SPARKS.map((s) => (
          <div
            key={s.i}
            className="gr-spark"
            style={{
              top: '3%',
              left: s.left,
              animationDelay: s.delay,
              '--sx': s.sx,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Winner hero */}
      <div
        style={{
          flexShrink: 0,
          padding: '42px 22px 18px',
          textAlign: 'center',
          borderBottom: '1px solid var(--border)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Trophy with concentric rings */}
        <div
          style={{
            position: 'relative',
            width: 90, height: 90,
            margin: '0 auto 14px',
            animation: 'grFloat 3.5s ease-in-out infinite',
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                inset: i * -9,
                borderRadius: '50%',
                border: `1px solid rgba(245,199,74,${.35 - i * .1})`,
              }}
            />
          ))}
          <div
            style={{
              width: 90, height: 90,
              borderRadius: '50%',
              background: 'radial-gradient(circle,rgba(245,199,74,.18),rgba(245,199,74,.04))',
              border: '2px solid rgba(245,199,74,.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 36,
              boxShadow: '0 0 36px rgba(245,199,74,.18)',
            }}
          >
            🏆
          </div>
        </div>

        <div className="gr-label-sm gr-gold" style={{ marginBottom: 7, letterSpacing: '.18em' }}>
          Final Leaderboard
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 900, marginBottom: 5, color: 'var(--text)' }}>จบเกม!</h2>

        {winner && (
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
            ผู้ชนะคือ — <strong style={{ color: 'var(--gold)' }}>{winner.display_name}</strong>
          </p>
        )}

        {playerEntry && (
          <>
            <div className="gr-label-xs" style={{ marginBottom: 6 }}>สถิติของ {displayName}</div>
            <div
              className="gr-card-gold"
              style={{ display: 'inline-flex', gap: 18, padding: '11px 20px', borderRadius: 14 }}
            >
              <div style={{ textAlign: 'center' }}>
                <div className="gr-label-xs" style={{ marginBottom: 4 }}>อันดับ</div>
                <div className="gr-mono" style={{ fontSize: 20, fontWeight: 900, color: 'var(--gold)' }}>
                  #{playerEntry.rank}
                </div>
              </div>
              <div style={{ width: 1, background: 'rgba(245,199,74,.18)' }} />
              <div style={{ textAlign: 'center' }}>
                <div className="gr-label-xs" style={{ marginBottom: 4 }}>คะแนนรวม</div>
                <div className="gr-mono" style={{ fontSize: 20, fontWeight: 900, color: 'var(--gold)' }}>
                  {playerEntry.cumulative_score.toLocaleString()}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Rankings */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 20px', position: 'relative', zIndex: 1 }}>
        <div className="gr-label-xs" style={{ textAlign: 'center', marginBottom: 10 }}>Final Rankings</div>
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
