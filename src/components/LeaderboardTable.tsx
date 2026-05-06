import type { LeaderboardEntry } from '../lib/types';
import { LEADERBOARD_VISIBLE_ROWS } from '../lib/constants';

interface Props {
  entries: LeaderboardEntry[];
  playerId: string | null;
  playerEntry: LeaderboardEntry | null;
  showPodium?: boolean;
  compactTopSpacing?: boolean;
}

const AV_GRADS = [
  ['#6366F1','#818CF8'],['#8B5CF6','#A78BFA'],['#14B8A6','#34D399'],
  ['#EC4899','#F472B6'],['#F59E0B','#F5C74A'],['#3B82F6','#60A5FA'],['#10B981','#6EE7B7'],
];
const avGrad = (i: number) =>
  `linear-gradient(135deg,${AV_GRADS[i % AV_GRADS.length][0]},${AV_GRADS[i % AV_GRADS.length][1]})`;

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

const PODIUM_GRADS = [
    'linear-gradient(180deg,rgba(180,190,200,.45),rgba(140,155,170,.28))',
      'linear-gradient(180deg,rgba(245,199,74,.55),rgba(180,140,10,.38))',
  'linear-gradient(180deg,rgba(195,140,70,.45),rgba(145,95,35,.28))',
];
const PODIUM_H  = [86, 108, 70];
const MEDALS    = ['🥈', '🥇', '🥉'];
const PODIUM_ORDER_3 = [1, 0, 2]; // 2nd, 1st, 3rd visual order

export function LeaderboardTable({
  entries,
  playerId,
  playerEntry,
  showPodium = false,
  compactTopSpacing = false,
}: Props) {
  const top = entries.slice(0, LEADERBOARD_VISIBLE_ROWS);
  const podiumEntries = showPodium ? entries.slice(0, 3) : [];
  const listEntries = showPodium ? top.slice(Math.min(podiumEntries.length, 3)) : top;
  const playerInTop = top.some((e) => e.player_id === playerId);

  const podiumOrder =
    podiumEntries.length <= 1 ? [0] :
    podiumEntries.length === 2 ? [0, 1] :
    PODIUM_ORDER_3;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 480,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: compactTopSpacing ? 10 : 14,
      }}
    >
      {/* Podium */}
      {showPodium && podiumEntries.length > 0 && (
        <div className="gr-card" style={{ padding: '16px 12px 14px', textAlign: 'center' }}>
          <div className="gr-label-xs" style={{ marginBottom: 14 , fontSize: 22 }}>
            Top 3
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 8 }}>
            {podiumOrder
              .filter((idx) => podiumEntries[idx])
              .map((idx) => {
                const entry = podiumEntries[idx];
                const isMe = entry.player_id === playerId;
                const rank = idx === 1 ? 1 : idx === 0 ? 2 : 3;
                return (
                  <div
                    key={`podium-${entry.player_id}`}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      flex: 1, maxWidth: podiumEntries.length === 1 ? 180 : 96,
                    }}
                  >
                    <div style={{ fontSize: 18 }}>{MEDALS[idx]}</div>
                    <div
                      style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: avGrad(rank - 1),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 800, color: 'white',
                        border: isMe ? '2px solid var(--gold)' : '2px solid transparent',
                        boxShadow: isMe ? '0 0 10px rgba(245,199,74,.4)' : 'none',
                      }}
                    >
                      {initials(entry.display_name)}
                    </div>
                    <div
                      style={{
                        fontSize: 10, fontWeight: 700, lineHeight: 1.3,
                        textAlign: 'center', maxWidth: 64,
                        color: isMe ? 'var(--gold)' : 'var(--text-2)',
                      }}
                    >
                      {entry.display_name.split(' ')[0]}
                      {isMe && <span style={{ marginLeft: 3, color: 'var(--gold)' }}>(you)</span>}
                    </div>
                    <div
                      className="gr-pod-bar"
                      style={{
                        height: PODIUM_H[idx],
                        background: PODIUM_GRADS[idx],
                        border: isMe ? '1px solid rgba(245,199,74,.25)' : '1px solid rgba(255,255,255,.07)',
                      }}
                    >
                      <span className="gr-mono" style={{ fontSize: 16, fontWeight: 800, color: idx === 1 ? '#0C1228' : 'var(--text)' }}>
                        {entry.cumulative_score.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* List rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {listEntries.map((entry, i) => {
          const isMe = entry.player_id === playerId;
          const rank = showPodium ? podiumEntries.length + i + 1 : i + 1;
          return (
            <div
              key={`${entry.player_id}-${i}`}
              className={`gr-lb-row ${isMe ? 'gr-lb-row-me' : ''}`}
              style={{ animationDelay: `${Math.min(i * 50, 300)}ms` }}
            >
              <div className="gr-lb-avatar" style={{ background: avGrad(rank - 1) }}>
                {initials(entry.display_name)}
              </div>
              <span
                className="gr-mono"
                style={{ width: 28, textAlign: 'center', fontSize: 18, fontWeight: 700, color: 'var(--text-3)', flexShrink: 0 }}
              >
                #{entry.rank}
              </span>
              <span style={{ flex: 1, fontSize: 18, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                {entry.display_name}
                {isMe && <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--gold)' }}>(you)</span>}
              </span>
              <div style={{ textAlign: 'right' }}>
                <div className="gr-mono" style={{ fontSize: 18, fontWeight: 800, color: isMe ? 'var(--gold)' : 'var(--text)' }}>
                  {entry.cumulative_score.toLocaleString()}
                </div>
                <div className="gr-label-xs" style={{ marginTop: 2 }}>คะแนน</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Player's own entry if outside top N */}
      {!playerInTop && playerEntry && (
        <>
          <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 11, padding: '2px 0' }}>···</div>
          <div className="gr-lb-row gr-lb-row-me">
            <div className="gr-lb-avatar" style={{ background: avGrad(0) }}>
              {initials(playerEntry.display_name)}
            </div>
            <span className="gr-mono" style={{ width: 28, textAlign: 'center', fontSize: 18, fontWeight: 700, color: 'var(--text-3)', flexShrink: 0 }}>
              #{playerEntry.rank}
            </span>
            <span style={{ flex: 1, fontSize: 18, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
              {playerEntry.display_name}
              <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--gold)' }}>(you)</span>
            </span>
            <div style={{ textAlign: 'right' }}>
              <div className="gr-mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--gold)' }}>
                {playerEntry.cumulative_score.toLocaleString()}
              </div>
              <div className="gr-label-xs" style={{ marginTop: 2 }}>คะแนน</div>
            </div>
          </div>
        </>
      )}

      {top.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-2)', fontSize: 13, padding: '32px 0' }}>ยังไม่มีผลลัพธ์</p>
      )}
    </div>
  );
}
