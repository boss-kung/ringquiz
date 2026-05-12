import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { LeaderboardTable } from '../components/LeaderboardTable';
import type { LeaderboardEntry } from '../lib/types';
import { triggerFeedbackFx } from '../lib/feedbackFx';

export function LeaderboardScreen() {
  useLeaderboard();

  const leaderboard = useGameStore((s) => s.leaderboard);
  const playerEntry = useGameStore((s) => s.playerLeaderboardEntry);
  const playerId = useGameStore((s) => s.playerId);
  const question = useGameStore((s) => s.question);
  const gameState = useGameStore((s) => s.gameState);
  const displayOrder = question?.play_order ?? question?.order_index ?? gameState?.current_question_index ?? null;

  // Sound: fire once when leaderboard first populates
  const lbSoundFiredRef = useRef(false);
  useEffect(() => {
    if (leaderboard.length > 0 && !lbSoundFiredRef.current) {
      lbSoundFiredRef.current = true;
      triggerFeedbackFx('leaderboardShow');
    }
  }, [leaderboard.length]);

  // Overtake detection: compare previous leaderboard rank vs current
  const prevLeaderboardRef = useRef<LeaderboardEntry[]>([]);
  const prevPlayerRankRef = useRef<number | null>(null);
  const [overtakeMsg, setOvertakeMsg] = useState<string | null>(null);
  const overtakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playerEntry || !playerId) {
      prevLeaderboardRef.current = leaderboard;
      prevPlayerRankRef.current = playerEntry?.rank ?? null;
      return;
    }

    const prevRank = prevPlayerRankRef.current;
    const currentRank = playerEntry.rank;

    if (prevRank !== null && currentRank < prevRank && prevLeaderboardRef.current.length > 0) {
      const overtaken = prevLeaderboardRef.current.find(
        (e) => e.rank === currentRank && e.player_id !== playerId,
      );
      if (overtaken) {
        setOvertakeMsg(`คุณแซง ${overtaken.display_name}! ⬆️`);
        if (overtakeTimerRef.current) clearTimeout(overtakeTimerRef.current);
        overtakeTimerRef.current = setTimeout(() => {
          setOvertakeMsg(null);
          overtakeTimerRef.current = null;
        }, 3500);
      }
    }

    prevPlayerRankRef.current = currentRank;
    prevLeaderboardRef.current = [...leaderboard];
  }, [leaderboard, playerEntry, playerId]);

  useEffect(() => {
    return () => { if (overtakeTimerRef.current) clearTimeout(overtakeTimerRef.current); };
  }, []);

  return (
    <div style={{ display: 'flex', minHeight: '100%', flexDirection: 'column', background: 'var(--navy)', position: 'relative' }}>
      {overtakeMsg && (
        <div key={overtakeMsg} className="gr-overtake-toast" role="status" aria-live="polite">
          {overtakeMsg}
        </div>
      )}
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
