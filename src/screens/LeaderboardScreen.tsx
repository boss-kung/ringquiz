import { useGameStore } from '../store/gameStore';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { LeaderboardTable } from '../components/LeaderboardTable';

export function LeaderboardScreen() {
  useLeaderboard();

  const leaderboard = useGameStore((s) => s.leaderboard);
  const playerEntry = useGameStore((s) => s.playerLeaderboardEntry);
  const playerId = useGameStore((s) => s.playerId);
  const question = useGameStore((s) => s.question);
  const gameState = useGameStore((s) => s.gameState);
  const displayOrder = question?.play_order ?? question?.order_index ?? gameState?.current_question_index ?? null;

  return (
    <div style={{ display: 'flex', minHeight: '100%', flexDirection: 'column', background: 'var(--navy)' }}>
      {/* Header */}
      <div className="gr-header" style={{ borderBottom: '1px solid var(--border)', padding: '14px 20px 12px' }}>
        <div>
          <div className="gr-label-xs" style={{ marginBottom: 4 , fontSize: 16}}>
            {displayOrder != null ? `หลังจบ Question ${displayOrder}` : 'ผู้นำในเกมนี้'}
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 900, color: 'var(--text)' }}>Leaderboard</h2>
        </div>
        <div className="gr-badge gr-badge-gold" style={{ fontSize: 16, fontWeight: 700 }}>
          Top {leaderboard.length || '—'}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 20px' }}>
        {leaderboard.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 8, animation: 'grFloat 3.5s ease-in-out infinite' }}>⏳</div>
              <p style={{ fontSize: 18, color: 'var(--text-2)' }}>กำลังโหลดตารางคะแนน...</p>
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
