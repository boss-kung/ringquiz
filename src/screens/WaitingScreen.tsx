import { useGameStore } from '../store/gameStore';
import { useWaitingPlayers } from '../hooks/useWaitingPlayers';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function WaitingScreen() {
  const displayName = useGameStore((s) => s.displayName);
  const { players, loading } = useWaitingPlayers(true);

  return (
    <div className="min-h-full bg-slate-900 text-center overflow-hidden">
      <div className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center px-5 py-10">
        <div className="absolute inset-0 pointer-events-none opacity-60">
          <div className="waiting-glow waiting-glow-a" />
          <div className="waiting-glow waiting-glow-b" />
        </div>

        <div className="relative space-y-6">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-indigo-400/20 bg-indigo-500/10 shadow-[0_0_60px_rgba(99,102,241,0.18)] waiting-float">
            <span className="text-4xl">🎮</span>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-indigo-300/80">
              Lobby พร้อมแล้ว
            </p>
            <h2 className="text-3xl font-black tracking-tight text-white">
              สวัสดี, {displayName}!
            </h2>
            <p className="mx-auto max-w-sm text-sm leading-6 text-slate-300">
              กำลังรอพิธีกรเริ่มเกม โปรดเตรียมพร้อมและเปิดหน้านี้ไว้
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-5 shadow-2xl shadow-slate-950/30 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-left">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">จำนวนผู้เล่นปัจจุบัน</p>
                <p className="mt-2 text-3xl font-black text-white tabular-nums">
                  {players.length}
                </p>
              </div>
              <div className="flex gap-1 justify-center">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-2.5 w-2.5 rounded-full bg-indigo-400 waiting-dot"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-5 text-left">
              <p className="mb-3 text-xs uppercase tracking-[0.28em] text-slate-500">ผู้เล่นในห้อง</p>
              {players.length === 0 && loading ? (
                <p className="text-sm text-slate-400">กำลังโหลดรายชื่อผู้เล่น...</p>
              ) : players.length === 0 ? (
                <p className="text-sm text-slate-400">คุณเป็นผู้เล่นคนแรกในห้องเลยนะ ว้าว!</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {players.map((player, index) => (
                    <div
                      key={player.id}
                      className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-left waiting-chip ${
                        player.display_name === displayName
                          ? 'border-indigo-400/40 bg-indigo-500/15 text-white'
                          : 'border-white/10 bg-white/[0.04] text-slate-200'
                      }`}
                      style={{ animationDelay: `${Math.min(index * 60, 360)}ms` }}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-xs font-bold text-white">
                        {initials(player.display_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {player.display_name}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
            กำลังรอพิธีกรเริ่มเกม...
          </p>
        </div>
      </div>
    </div>
  );
}
