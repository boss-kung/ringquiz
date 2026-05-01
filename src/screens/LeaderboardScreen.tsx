import { useGameStore } from '../store/gameStore';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { LeaderboardTable } from '../components/LeaderboardTable';

export function LeaderboardScreen() {
  useLeaderboard();

  const leaderboard = useGameStore((s) => s.leaderboard);
  const playerEntry = useGameStore((s) => s.playerLeaderboardEntry);
  const playerId = useGameStore((s) => s.playerId);
  const question = useGameStore((s) => s.question);

  return (
    <div className="flex min-h-full flex-col bg-slate-900">
      <div className="shrink-0 border-b border-white/10 px-4 py-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Standings</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">Leaderboard</h2>
        {question && (
          <p className="mt-2 text-sm text-slate-400">After Question {question.order_index}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {leaderboard.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <div className="text-3xl animate-spin inline-block">⏳</div>
              <p className="text-slate-400 text-sm">Loading leaderboard…</p>
            </div>
          </div>
        ) : (
          <LeaderboardTable
            entries={leaderboard}
            playerId={playerId}
            playerEntry={playerEntry}
          />
        )}
      </div>
    </div>
  );
}
