import type { LeaderboardEntry } from '../lib/types';
import { LEADERBOARD_VISIBLE_ROWS } from '../lib/constants';

interface Props {
  entries: LeaderboardEntry[];
  playerId: string | null;
  playerEntry: LeaderboardEntry | null;
  showPodium?: boolean;
  compactTopSpacing?: boolean;
}

const PODIUM_STYLES = [
  { label: '1st', height: 'h-28', tone: 'from-amber-300/90 to-yellow-500/80', accent: 'text-amber-200', emoji: '🥇' },
  { label: '2nd', height: 'h-24', tone: 'from-slate-200/80 to-slate-400/70', accent: 'text-slate-200', emoji: '🥈' },
  { label: '3rd', height: 'h-20', tone: 'from-orange-300/80 to-amber-700/70', accent: 'text-orange-200', emoji: '🥉' },
];

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
    podiumEntries.length <= 1
      ? [0]
      : podiumEntries.length === 2
        ? [0, 1]
        : [1, 0, 2];

  return (
    <div className={`w-full max-w-md mx-auto ${compactTopSpacing ? 'space-y-3' : 'space-y-5'}`}>
      {showPodium && podiumEntries.length > 0 && (
        <div className="rounded-[28px] border border-white/10 bg-white/[0.04] px-4 py-5 shadow-xl shadow-slate-950/30">
          <p className="text-center text-xs uppercase tracking-[0.28em] text-slate-400">Top 3</p>
          <div className="mt-4 flex items-end justify-center gap-2 sm:gap-3">
            {podiumOrder
              .filter((index) => podiumEntries[index])
              .map((index) => {
                const entry = podiumEntries[index];
                const isMe = entry.player_id === playerId;
                const style = PODIUM_STYLES[index];
                return (
                  <div
                    key={`podium-${entry.player_id}`}
                    className={`flex flex-1 flex-col items-center gap-2 waiting-chip ${
                      podiumEntries.length === 1 ? 'max-w-[180px]' : 'max-w-[120px]'
                    }`}
                  >
                    <div className="text-2xl">{style.emoji}</div>
                    <div className="text-center">
                      <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${style.accent}`}>{style.label}</p>
                      <p className="mt-1 max-w-[90px] truncate text-sm font-bold text-white">
                        {entry.display_name}
                        {isMe && <span className="ml-1 text-[10px] text-yellow-300">(you)</span>}
                      </p>
                    </div>
                    <div className={`flex w-full flex-col items-center justify-end rounded-2xl bg-gradient-to-b ${style.tone} ${style.height} px-2 pb-3 pt-4 text-slate-950 shadow-lg`}>
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">#{entry.rank}</span>
                      <span className="mt-2 text-lg font-black tabular-nums">{entry.cumulative_score.toLocaleString()}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {listEntries.map((entry, i) => {
          const isMe = entry.player_id === playerId;
          return (
            <div
              key={`${entry.player_id}-${i}`}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium waiting-chip
                ${isMe ? 'bg-yellow-400/20 ring-1 ring-yellow-400 shadow-[0_0_0_1px_rgba(250,204,21,0.18)]' : 'bg-white/10'}`}
              style={{ animationDelay: `${Math.min(i * 50, 300)}ms` }}
            >
              <span className="w-9 text-center text-white/60 font-bold tabular-nums">#{entry.rank}</span>
              <span className="flex-1 truncate text-white">
                {entry.display_name}
                {isMe && <span className="ml-2 text-yellow-300 text-xs">(you)</span>}
              </span>
              <div className="text-right">
                <span className="text-[16px] block text-white font-bold tabular-nums">{entry.cumulative_score.toLocaleString()}</span>
                <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">คะแนน</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Show player's own entry if outside top N */}
      {!playerInTop && playerEntry && (
        <>
          <div className="text-center text-white/40 text-xs py-1">···</div>
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium bg-yellow-400/20 ring-1 ring-yellow-400 waiting-chip">
            <span className="w-9 text-center text-white/60 font-bold tabular-nums">#{playerEntry.rank}</span>
            <span className="flex-1 truncate text-white">
              {playerEntry.display_name}
              <span className="ml-2 text-yellow-300 text-xs">(you)</span>
            </span>
            <div className="text-right">
              <span className="block text-white font-bold tabular-nums">{playerEntry.cumulative_score.toLocaleString()}</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">คะแนน</span>
            </div>
          </div>
        </>
      )}

      {top.length === 0 && (
        <p className="text-center text-white/50 text-sm py-8">ยังไม่มีผลลัพธ์</p>
      )}
    </div>
  );
}
