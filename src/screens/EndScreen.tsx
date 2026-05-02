import { useGameStore } from '../store/gameStore';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { LeaderboardTable } from '../components/LeaderboardTable';

export function EndScreen() {
  useLeaderboard();

  const leaderboard = useGameStore((s) => s.leaderboard);
  const playerEntry = useGameStore((s) => s.playerLeaderboardEntry);
  const playerId = useGameStore((s) => s.playerId);
  const displayName = useGameStore((s) => s.displayName);

  return (
    <div className="relative flex min-h-full flex-col overflow-hidden bg-slate-900">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="waiting-glow waiting-glow-a" />
        <div className="waiting-glow waiting-glow-b" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center gap-4 px-6 pt-8">
        {Array.from({ length: 7 }).map((_, index) => (
          <span
            key={`spark-${index}`}
            className="celebration-spark"
            style={{
              animationDelay: `${index * 0.22}s`,
            }}
          />
        ))}
      </div>

      <div className="relative shrink-0 border-b border-white/10 px-4 py-8 text-center">
        <div className="mb-3 text-5xl waiting-float">🏆</div>
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-amber-300/80">Final Leaderboard</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight text-white">จบเกม</h2>
        {playerEntry && (
          <p className="mt-3 text-sm text-slate-300">
            {displayName} — Rank #{playerEntry.rank} · {playerEntry.cumulative_score.toLocaleString()} คะแนน
          </p>
        )}
      </div>

      <div className="relative flex-1 overflow-y-auto px-4 py-5">
        <p className="mb-4 text-center text-xs uppercase tracking-[0.28em] text-slate-400">Final Rankings</p>
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
