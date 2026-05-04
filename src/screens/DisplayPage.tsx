/**
 * DisplayPage — read-only big-screen / TV / projector view.
 * Fully standalone: no player state, no host controls, no answer submission.
 * Manages its own Supabase subscriptions with distinct channel names.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, GAME_STATE_ID, FUNCTIONS_URL } from '../lib/supabase';
import { resolveQuestionImageUrl, resolveRevealImageUrl } from '../lib/questionAssets';
import { COUNTDOWN_DISPLAY_SECONDS } from '../lib/constants';
import type { GameState, Question, Player, LeaderboardEntry } from '../lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const AV_GRADS = [
  ['#6366F1','#818CF8'],['#8B5CF6','#A78BFA'],['#14B8A6','#34D399'],
  ['#EC4899','#F472B6'],['#F59E0B','#F5C74A'],['#3B82F6','#60A5FA'],['#10B981','#6EE7B7'],
];
const avGrad = (i: number) =>
  `linear-gradient(135deg,${AV_GRADS[i % AV_GRADS.length][0]},${AV_GRADS[i % AV_GRADS.length][1]})`;

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function sortNewest(players: Player[]): Player[] {
  return [...players].sort((a, b) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime());
}

function useDisplayServerTime() {
  const offset = useRef(0);
  useEffect(() => {
    fetch(`${FUNCTIONS_URL}/server-time`)
      .then((r) => r.json())
      .then((d) => { if (d.server_time_ms) offset.current = d.server_time_ms - Date.now(); })
      .catch(() => {});
  }, []);
  return useCallback(() => Date.now() + offset.current, []);
}

// ── QR code via public API ────────────────────────────────────────────────────
function QRCode({ url }: { url: string }) {
  const encoded = encodeURIComponent(url);
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}&bgcolor=050810&color=F5C74A&margin=12&qzone=1`;
  return (
    <div className="ds-qr-wrap">
      <img src={src} alt="QR Code" className="ds-qr-img" />
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
export function DisplayPage() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const getServerTime = useDisplayServerTime();
  const prevQId = useRef<string | null>(null);

  // ── Game state subscription ─────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('game_state').select('*').eq('id', GAME_STATE_ID).single()
      .then(({ data }) => { if (data) setGameState(data as GameState); });

    const ch = supabase.channel('display-game')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'game_state',
        filter: `id=eq.${GAME_STATE_ID}`,
      }, (payload) => setGameState(payload.new as GameState))
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── Players subscription (for lobby wall) ──────────────────────────────────
  useEffect(() => {
    supabase.from('players').select('id, display_name, total_score, joined_at')
      .then(({ data }) => { if (data) setPlayers(sortNewest(data as Player[])); });

    const ch = supabase.channel('display-players')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const p = payload.new as Player;
          setPlayers((cur) => sortNewest([...cur.filter((x) => x.id !== p.id), p]));
        } else if (payload.eventType === 'UPDATE') {
          const p = payload.new as Player;
          setPlayers((cur) => sortNewest(cur.map((x) => x.id === p.id ? p : x)));
        } else if (payload.eventType === 'DELETE') {
          const p = payload.old as Player;
          setPlayers((cur) => cur.filter((x) => x.id !== p.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── Fetch question when question_id changes ─────────────────────────────────
  useEffect(() => {
    const qId = gameState?.current_question_id ?? null;
    if (!qId) { setQuestion(null); prevQId.current = null; return; }
    if (qId === prevQId.current) return;
    prevQId.current = qId;

    supabase.from('questions')
      .select('id, order_index, text, image_url, circle_radius_ratio, time_limit_seconds, max_score, min_correct_score, image_width, image_height, reveal_image_url, is_published, created_at')
      .eq('id', qId).single()
      .then(({ data }) => { if (data) setQuestion(data as Question); });
  }, [gameState?.current_question_id]);

  // ── Leaderboard fetch when phase changes to leaderboard/ended ──────────────
  useEffect(() => {
    const status = gameState?.status;
    const qId = gameState?.current_question_id;
    if ((status !== 'leaderboard' && status !== 'ended') || !qId) return;

    supabase.from('leaderboard_snapshot')
      .select('question_id, player_id, rank, display_name, question_score, cumulative_score')
      .eq('question_id', qId).order('rank', { ascending: true }).limit(10)
      .then(({ data }) => { if (data) setLeaderboard(data as LeaderboardEntry[]); });
  }, [gameState?.status, gameState?.current_question_id]);

  // ── Route to phase component ────────────────────────────────────────────────
  const status = gameState?.status ?? 'waiting';

  if (!gameState || status === 'waiting') {
    return <DsLobby players={players} />;
  }
  if (status === 'countdown') {
    return <DsCountdown gameState={gameState} question={question} />;
  }
  if (status === 'question_open') {
    return <DsQuestion gameState={gameState} question={question} playerCount={players.length} getServerTime={getServerTime} />;
  }
  if (status === 'question_closed') {
    return <DsClosed question={question} />;
  }
  if (status === 'reveal') {
    return <DsReveal gameState={gameState} question={question} getServerTime={getServerTime} />;
  }
  if (status === 'leaderboard') {
    return <DsLeaderboard leaderboard={leaderboard} question={question} isFinal={false} />;
  }
  if (status === 'ended') {
    return <DsLeaderboard leaderboard={leaderboard} question={question} isFinal />;
  }
  return <DsLobby players={players} />;
}

// ── Shell wrapper ─────────────────────────────────────────────────────────────
function DsShell({ children, centered = false }: { children: React.ReactNode; centered?: boolean }) {
  return (
    <div className="ds-page">
      <div className="ds-glow-a" /><div className="ds-glow-b" />
      <div className={centered ? 'ds-centered' : 'ds-content'} style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}

// ── 1. LOBBY ──────────────────────────────────────────────────────────────────
function DsLobby({ players }: { players: Player[] }) {
  const joinUrl = window.location.origin + (import.meta.env.BASE_URL || '/');

  return (
    <DsShell>
      {/* Header row */}
      <div className="ds-lobby-header">
        <div>
          <div className="ds-label">Golden Ring · Lobby</div>
          <div className="ds-title">เกมวงแหวนปริศนา</div>
        </div>
        <div className="ds-live-badge">
          <span className="ds-live-dot" />LIVE
        </div>
      </div>

      {/* Main row: QR + stats + player wall */}
      <div className="ds-lobby-body">
        {/* Left: QR */}
        <div className="ds-lobby-left">
          <div className="ds-label" style={{ marginBottom: 12, textAlign: 'center' }}>สแกนเพื่อเข้าร่วม</div>
          <QRCode url={joinUrl} />
          <div className="ds-join-url">{joinUrl}</div>
          <div className="ds-player-count">
            <span className="ds-count-num">{players.length}</span>
            <span className="ds-count-label">ผู้เล่น</span>
          </div>
        </div>

        {/* Right: player wall */}
        <div className="ds-lobby-right">
          <div className="ds-label" style={{ marginBottom: 14 }}>ผู้เล่นในห้อง</div>
          {players.length === 0 ? (
            <p className="ds-muted">รอผู้เล่นเข้าร่วม...</p>
          ) : (
            <div className="ds-player-wall">
              {players.map((p, i) => (
                <div key={p.id} className="ds-player-chip" style={{ animationDelay: `${Math.min(i * 30, 400)}ms` }}>
                  <div className="ds-chip-av" style={{ background: avGrad(i) }}>{initials(p.display_name)}</div>
                  <span className="ds-chip-name">{p.display_name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="ds-lobby-footer">กำลังรอพิธีกรเริ่มเกม...</div>
    </DsShell>
  );
}

// ── 2. COUNTDOWN ─────────────────────────────────────────────────────────────
function DsCountdown({ gameState, question }: { gameState: GameState; question: Question | null }) {
  const totalMs = COUNTDOWN_DISPLAY_SECONDS * 1000;
  const [remainingMs, setRemainingMs] = useState(totalMs);
  const [showClue, setShowClue] = useState(false);
  const startedAt = gameState.updated_at;

  useEffect(() => {
    setShowClue(false);
    setRemainingMs(totalMs);
    const t0 = performance.now();
    let raf = 0;
    let clueTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const elapsed = performance.now() - t0;
      const rem = Math.max(0, totalMs - elapsed);
      setRemainingMs(rem);
      if (rem <= 0) {
        if (!clueTimer) clueTimer = setTimeout(() => setShowClue(true), 300);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); if (clueTimer) clearTimeout(clueTimer); };
  }, [startedAt, question?.id, totalMs]);

  const count = Math.ceil(remainingMs / 1000);
  const progress = Math.max(0, Math.min(1, (totalMs - remainingMs) / totalMs));
  const circ = 2 * Math.PI * 110;
  const offset = progress >= 1 ? 0 : circ * (1 - progress);
  const clueUrl = question ? resolveQuestionImageUrl(question.image_url) : null;

  return (
    <DsShell centered>
      {question && (
        <div className="ds-q-pos">Question {question.order_index}</div>
      )}

      {!showClue ? (
        <div className="ds-countdown-wrap">
          <svg className="ds-ring-svg" viewBox="0 0 260 260" aria-hidden>
            <defs>
              <linearGradient id="dsRingGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#C49A1A" />
                <stop offset="100%" stopColor="#F5C74A" />
              </linearGradient>
            </defs>
            <circle cx="130" cy="130" r="110" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="12" />
            <circle cx="130" cy="130" r="110" fill="none" stroke="url(#dsRingGrad)" strokeWidth="12"
              strokeLinecap="round" transform="rotate(-90 130 130)"
              strokeDasharray={circ} strokeDashoffset={offset} style={{ transition: 'none' }} />
          </svg>
          <div className="ds-countdown-inner">
            <div className="ds-label" style={{ marginBottom: 8 }}>เตรียมพร้อม!</div>
            <div key={count} className="ds-big-num">{count > 0 ? count : '●'}</div>
          </div>
        </div>
      ) : (
        <div className="ds-clue-wrap">
          <div className="ds-label ds-gold" style={{ marginBottom: 16, letterSpacing: '.2em' }}>ภาพปริศนา</div>
          {clueUrl && (
            <div className="ds-clue-img-wrap">
              <img src={clueUrl} alt="Clue" className="ds-clue-img" />
            </div>
          )}
          <div className="ds-muted" style={{ marginTop: 16 }}>ดูภาพให้ดีก่อนตอบ</div>
        </div>
      )}
    </DsShell>
  );
}

// ── 3. QUESTION OPEN ──────────────────────────────────────────────────────────
function DsQuestion({
  gameState, question, playerCount, getServerTime,
}: {
  gameState: GameState;
  question: Question | null;
  playerCount: number;
  getServerTime: () => number;
}) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    const endsAt = gameState.question_ends_at;
    if (!endsAt) { setTimeLeft(null); return; }
    const endMs = new Date(endsAt).getTime();
    const tick = () => setTimeLeft(Math.max(0, (endMs - getServerTime()) / 1000));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [gameState.question_ends_at, getServerTime]);

  const totalSec = question?.time_limit_seconds ?? 30;
  const ratio = timeLeft != null ? Math.max(0, Math.min(1, timeLeft / totalSec)) : 1;
  const urgent = timeLeft != null && timeLeft <= 5;
  const imgUrl = question ? resolveQuestionImageUrl(question.image_url) : null;

  return (
    <DsShell>
      {/* Top bar */}
      <div className="ds-q-bar">
        <div className="ds-q-pos-sm">
          {question ? `Question ${question.order_index}` : '—'}
        </div>
        <div className="ds-q-meta">
          <span className="ds-muted">{playerCount} ผู้เล่น</span>
        </div>
      </div>

      {/* Content */}
      <div className="ds-q-body">
        {/* Left: question info */}
        <div className="ds-q-left">
          <div className="ds-q-text">{question?.text ?? 'กำลังโหลด...'}</div>

          {/* Timer */}
          <div className={`ds-big-timer ${urgent ? 'ds-timer-urgent' : ''}`}>
            {timeLeft != null ? timeLeft.toFixed(1) : '—'}
            <span className="ds-timer-unit">s</span>
          </div>

          {/* Timer bar */}
          <div className="ds-timer-bar-track">
            <div
              className={`ds-timer-bar-fill ${urgent ? 'ds-timer-bar-urgent' : ''}`}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>

          <div className="ds-muted" style={{ marginTop: 16 }}>กำลังรับคำตอบ...</div>
        </div>

        {/* Right: image */}
        {imgUrl && (
          <div className="ds-q-right">
            <div className="ds-q-img-wrap">
              <img src={imgUrl} alt="Question" className="ds-q-img" />
            </div>
          </div>
        )}
      </div>
    </DsShell>
  );
}

// ── 4. QUESTION CLOSED ────────────────────────────────────────────────────────
function DsClosed({ question }: { question: Question | null }) {
  return (
    <DsShell centered>
      {question && <div className="ds-q-pos">Question {question.order_index}</div>}
      <div className="ds-closed-icon">🔒</div>
      <div className="ds-huge-text">หมดเวลา!</div>
      <div className="ds-sub-text">รอการเฉลยจากพิธีกร...</div>
    </DsShell>
  );
}

// ── 5. REVEAL ─────────────────────────────────────────────────────────────────
function DsReveal({
  gameState, question, getServerTime,
}: {
  gameState: GameState;
  question: Question | null;
  getServerTime: () => number;
}) {
  const [showReveal, setShowReveal] = useState(false);

  useEffect(() => {
    setShowReveal(false);
    const revealAt = gameState.updated_at;
    if (!revealAt) return;
    const revealMs = new Date(revealAt).getTime() + 5000;
    const tick = () => setShowReveal(getServerTime() >= revealMs);
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [gameState.updated_at, question?.id, getServerTime]);

  if (!question) {
    return (
      <DsShell centered>
        <div className="ds-muted">กำลังโหลด...</div>
      </DsShell>
    );
  }

  const baseImg = resolveQuestionImageUrl(question.image_url);
  const revealImg = resolveRevealImageUrl(question.reveal_image_url) ?? baseImg;
  const maskUrl = `${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(question.id)}&updatedAt=${encodeURIComponent(gameState.updated_at ?? '')}`;

  return (
    <DsShell>
      <div className="ds-reveal-header">
        <div className="ds-q-pos-sm">Question {question.order_index}</div>
        <div className="ds-label ds-gold" style={{ letterSpacing: '.2em' }}>เฉลย</div>
      </div>

      <div className="ds-reveal-body">
        <div className="ds-reveal-text">{question.text}</div>
        <div className="ds-reveal-img-wrap">
          <img
            src={showReveal ? revealImg : baseImg}
            alt="Reveal"
            className="ds-reveal-img"
          />
          {/* Mask overlay — same endpoint as player */}
          <img
            src={maskUrl}
            alt=""
            aria-hidden
            className="ds-reveal-mask reveal-mask-pulse"
          />
        </div>
        {!showReveal && (
          <div className="ds-muted" style={{ marginTop: 12 }}>กำลังแสดงเฉลย...</div>
        )}
      </div>
    </DsShell>
  );
}

// ── 6 + 7. LEADERBOARD / FINAL ────────────────────────────────────────────────
function DsLeaderboard({
  leaderboard, question, isFinal,
}: {
  leaderboard: LeaderboardEntry[];
  question: Question | null;
  isFinal: boolean;
}) {
  const winner = leaderboard[0];
  const top = leaderboard.slice(0, 10);
  const MEDALS = ['🥇', '🥈', '🥉'];

  return (
    <DsShell>
      {/* Header */}
      <div className="ds-lb-header">
        {isFinal ? (
          <>
            <div className="ds-label ds-gold" style={{ letterSpacing: '.2em' }}>Final Leaderboard</div>
            <div className="ds-title" style={{ fontSize: 36 }}>จบเกม! 🏆</div>
            {winner && (
              <div className="ds-winner-line">
                ผู้ชนะ — <strong className="ds-gold">{winner.display_name}</strong>
                &nbsp;<span className="ds-mono ds-gold">({winner.cumulative_score.toLocaleString()} คะแนน)</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="ds-label ds-gold" style={{ letterSpacing: '.2em' }}>
              {question ? `หลังจบ Question ${question.order_index}` : 'Leaderboard'}
            </div>
            <div className="ds-title" style={{ fontSize: 32 }}>ตารางคะแนน</div>
          </>
        )}
      </div>

      {/* Podium (top 3) */}
      {top.length > 0 && isFinal && (
        <div className="ds-podium">
          {[1, 0, 2].filter((i) => top[i]).map((i) => (
            <div key={top[i].player_id} className="ds-podium-slot" style={{ order: i === 0 ? 1 : i === 1 ? 0 : 2 }}>
              <div className="ds-pod-medal">{MEDALS[i]}</div>
              <div className="ds-pod-av" style={{ background: avGrad(i) }}>{initials(top[i].display_name)}</div>
              <div className="ds-pod-name">{top[i].display_name}</div>
              <div className={`ds-pod-bar ds-pod-bar-${i}`}>
                <span className="ds-mono ds-pod-score">{top[i].cumulative_score.toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      <div className="ds-lb-list">
        {(isFinal ? top.slice(3) : top).map((entry, idx) => {
          const listRank = isFinal ? idx + 4 : idx + 1;
          return (
            <div key={entry.player_id} className="ds-lb-row" style={{ animationDelay: `${Math.min(idx * 40, 300)}ms` }}>
              <span className="ds-lb-rank ds-mono">#{entry.rank}</span>
              <div className="ds-lb-av" style={{ background: avGrad(listRank - 1) }}>{initials(entry.display_name)}</div>
              <span className="ds-lb-name">{entry.display_name}</span>
              <span className="ds-lb-score ds-mono">{entry.cumulative_score.toLocaleString()}</span>
            </div>
          );
        })}
        {top.length === 0 && (
          <div className="ds-muted" style={{ textAlign: 'center', padding: '40px 0' }}>กำลังโหลด...</div>
        )}
      </div>
    </DsShell>
  );
}
