/**
 * DisplayPage — read-only big-screen / TV / projector view.
 * Fully standalone: no player state, no host controls, no answer submission.
 * Manages its own Supabase subscriptions with distinct channel names.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, GAME_STATE_ID, FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../lib/supabase';
import { resolveQuestionImageUrl, resolveRevealImageUrl } from '../lib/questionAssets';
import { COUNTDOWN_DISPLAY_SECONDS, SERVER_TIME_RESYNC_INTERVAL_MS } from '../lib/constants';
import type { GameState, Player, LeaderboardEntry, DisplayStatsResponse } from '../lib/types';

// ── Local types ───────────────────────────────────────────────────────────────

// Merged question: base data from `questions` + runtime snapshot from `game_set_questions`
interface DisplayQuestion {
  id: string;
  text: string;
  image_url: string;
  reveal_image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  order_index: number;           // bank order — used as fallback only
  // runtime values (game_set_questions snapshot when available, else questions defaults)
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  circle_radius_ratio: number;
  play_order: number;            // visible position (game set play_order, or order_index)
}

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

function DsImageFallback({ message }: { message: string }) {
  return (
    <div className="ds-clue-img-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="ds-muted" style={{ textAlign: 'center', maxWidth: 260 }}>{message}</div>
    </div>
  );
}

function sortNewest(players: Player[]): Player[] {
  return [...players].sort((a, b) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime());
}

function useDisplayServerTime() {
  const offset = useRef(0);
  const sync = useCallback(() => {
    const t0 = Date.now();
    fetch(`${FUNCTIONS_URL}/server-time`, { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.server_time_ms) {
          const t1 = Date.now();
          const rtt = t1 - t0;
          offset.current = d.server_time_ms + rtt / 2 - t1;
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    sync();
    const id = setInterval(sync, SERVER_TIME_RESYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sync]);

  return useCallback(() => Date.now() + offset.current, []);
}

// ── QR code with fallback ─────────────────────────────────────────────────────
function QRCode({ url }: { url: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const encoded = encodeURIComponent(url);
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}&bgcolor=050810&color=F5C74A&margin=12&qzone=1`;

  return (
    <div className="ds-qr-wrap">
      {!imgFailed ? (
        <img
          src={src}
          alt="QR Code"
          className="ds-qr-img"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="ds-qr-fallback">
          <div className="ds-label" style={{ marginBottom: 8 }}>สแกนหรือพิมพ์ URL</div>
          <div className="ds-join-url ds-join-url-lg">{url}</div>
        </div>
      )}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
export function DisplayPage() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [question, setQuestion] = useState<DisplayQuestion | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [stats, setStats] = useState<DisplayStatsResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const getServerTime = useDisplayServerTime();
  const prevQuestionKeyRef = useRef<string | null>(null);

  // ── 1. Anonymous auth — needed so questions RLS allows reading ──────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAuthReady(true);
      } else {
        supabase.auth.signInAnonymously()
          .then(() => setAuthReady(true))
          .catch(() => setAuthReady(true)); // proceed anyway; stats still work
      }
    });
  }, []);

  // ── 2. Fetch display stats (aggregate only, no raw answer data) ─────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${FUNCTIONS_URL}/get-display-stats`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      });
      if (!res.ok) return;
      const data = await res.json() as DisplayStatsResponse;
      setStats(data);
    } catch { /* non-critical — display still works without stats */ }
  }, []);

  // ── 3. Game state subscription ──────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from('game_state').select('*').eq('id', GAME_STATE_ID).single()
      .then(({ data }) => {
        if (data) { setGameState(data as GameState); void fetchStats(); }
      });

    const ch = supabase.channel('display-game')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'game_state',
        filter: `id=eq.${GAME_STATE_ID}`,
      }, (payload) => {
        setGameState(payload.new as GameState);
        void fetchStats();
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [fetchStats]);

  // ── 4. Players subscription (for lobby wall) ────────────────────────────────
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

  // ── 5. Subscribe to answers to trigger stat refresh (no payload read) ───────
  useEffect(() => {
    const ch = supabase.channel('display-answers')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers' }, () => {
        void fetchStats();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchStats]);

  // ── 6. Fetch question with game_set_questions snapshot overlay ──────────────
  useEffect(() => {
    if (!authReady) return;
    const qId = gameState?.current_question_id ?? null;
    const gsqId = gameState?.current_game_set_question_id ?? null;

    if (!qId) {
      prevQuestionKeyRef.current = null;
      setQuestion(null);
      return;
    }

    const key = `${qId}::${gsqId}`;
    if (key === prevQuestionKeyRef.current) return;
    prevQuestionKeyRef.current = key;

    const fetch_ = async () => {
      const { data: qData } = await supabase
        .from('questions')
        .select('id, order_index, text, image_url, circle_radius_ratio, time_limit_seconds, max_score, min_correct_score, image_width, image_height, reveal_image_url')
        .eq('id', qId)
        .single();

      if (!qData) return;

      let dq: DisplayQuestion = {
        id: qData.id,
        text: qData.text,
        image_url: qData.image_url,
        reveal_image_url: qData.reveal_image_url,
        image_width: qData.image_width,
        image_height: qData.image_height,
        order_index: qData.order_index,
        time_limit_seconds: qData.time_limit_seconds,
        max_score: qData.max_score,
        min_correct_score: qData.min_correct_score,
        circle_radius_ratio: qData.circle_radius_ratio,
        play_order: qData.order_index, // fallback: use bank order
      };

      // Overlay game_set_questions snapshot when available
      if (gsqId) {
        const { data: gsqData } = await supabase
          .from('game_set_questions')
          .select('play_order, time_limit_seconds, max_score, min_correct_score, circle_radius_ratio')
          .eq('id', gsqId)
          .single();

        if (gsqData) {
          dq = {
            ...dq,
            play_order: gsqData.play_order,
            time_limit_seconds: gsqData.time_limit_seconds,
            max_score: gsqData.max_score,
            min_correct_score: gsqData.min_correct_score,
            circle_radius_ratio: gsqData.circle_radius_ratio,
          };
        }
      }

      setQuestion(dq);
    };

    void fetch_();
  }, [authReady, gameState?.current_question_id, gameState?.current_game_set_question_id]);

  // ── 7. Leaderboard — fetch + retry + realtime subscription ─────────────────
  useEffect(() => {
    const status = gameState?.status;
    const qId = gameState?.current_question_id;
    if ((status !== 'leaderboard' && status !== 'ended') || !qId) return;

    const fetchLb = async () => {
      const { data } = await supabase
        .from('leaderboard_snapshot')
        .select('question_id, player_id, rank, display_name, question_score, cumulative_score')
        .eq('question_id', qId)
        .order('rank', { ascending: true })
        .limit(10);
      setLeaderboard((data ?? []) as LeaderboardEntry[]);
    };

    // Fetch immediately, then again after 400 ms in case snapshot was written
    // just after the phase change (avoiding stale "กำลังโหลด..." state)
    void fetchLb();
    const retryTimer = setTimeout(() => void fetchLb(), 400);

    const ch = supabase.channel('display-leaderboard')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'leaderboard_snapshot',
        filter: `question_id=eq.${qId}`,
      }, () => void fetchLb())
      .subscribe();

    return () => { clearTimeout(retryTimer); supabase.removeChannel(ch); };
  }, [gameState?.status, gameState?.current_question_id]);

  // ── Route to phase component ────────────────────────────────────────────────
  const status = gameState?.status ?? 'waiting';
  const totalQs = stats?.total_questions ?? 0;

  if (!gameState || status === 'waiting') {
    return <DsLobby players={players} />;
  }
  if (status === 'countdown') {
    return (
      <DsCountdown
        gameState={gameState}
        question={question}
        totalQs={totalQs}
        getServerTime={getServerTime}
      />
    );
  }
  if (status === 'question_open') {
    return (
      <DsQuestion
        gameState={gameState}
        question={question}
        stats={stats}
        totalQs={totalQs}
        getServerTime={getServerTime}
      />
    );
  }
  if (status === 'question_closed') {
    return <DsClosed question={question} stats={stats} totalQs={totalQs} />;
  }
  if (status === 'reveal') {
    return (
      <DsReveal
        gameState={gameState}
        question={question}
        stats={stats}
        totalQs={totalQs}
        getServerTime={getServerTime}
      />
    );
  }
  if (status === 'leaderboard') {
    return (
      <DsLeaderboard
        leaderboard={leaderboard}
        question={question}
        totalQs={totalQs}
        isFinal={false}
      />
    );
  }
  if (status === 'ended') {
    return (
      <DsLeaderboard
        leaderboard={leaderboard}
        question={question}
        totalQs={totalQs}
        isFinal
      />
    );
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

// ── Position label helper ─────────────────────────────────────────────────────
function QPos({ question, totalQs, small }: { question: DisplayQuestion | null; totalQs: number; small?: boolean }) {
  if (!question) return null;
  const pos = `Question ${question.play_order}${totalQs > 0 ? ` / ${totalQs}` : ''}`;
  return small
    ? <div className="ds-q-pos-sm">{pos}</div>
    : <div className="ds-q-pos">{pos}</div>;
}

// ── 1. LOBBY ──────────────────────────────────────────────────────────────────
function DsLobby({ players }: { players: Player[] }) {
  const joinUrl = window.location.origin + (import.meta.env.BASE_URL || '/');

  return (
    <DsShell>
      <div className="ds-lobby-header">
        <div>
          <div className="ds-label">Golden Ring · Lobby</div>
          <div className="ds-title">เกมวงแหวนปริศนา</div>
        </div>
        <div className="ds-live-badge">
          <span className="ds-live-dot" />LIVE
        </div>
      </div>

      <div className="ds-lobby-body">
        {/* Left: QR + join URL + player count */}
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

      <div className="ds-lobby-footer">กำลังรอพิธีกรเริ่มเกม...</div>
    </DsShell>
  );
}

// ── 2. COUNTDOWN ─────────────────────────────────────────────────────────────
function DsCountdown({
  gameState, question, totalQs, getServerTime,
}: {
  gameState: GameState;
  question: DisplayQuestion | null;
  totalQs: number;
  getServerTime: () => number;
}) {
  const totalMs = COUNTDOWN_DISPLAY_SECONDS * 1000;
  const [remainingMs, setRemainingMs] = useState(totalMs);
  const [showClue, setShowClue] = useState(false);
  const startedAt = gameState.updated_at;

  useEffect(() => {
    setShowClue(false);

    // Calculate how much time has already elapsed since the host triggered countdown.
    // This syncs the display to server time instead of restarting from 0 on mount.
    const startMs = new Date(startedAt).getTime();
    const alreadyElapsedMs = Math.max(0, getServerTime() - startMs);
    const initialRemaining = Math.max(0, totalMs - alreadyElapsedMs);

    if (initialRemaining === 0) {
      setShowClue(true);
      return;
    }

    setRemainingMs(initialRemaining);

    // Offset t0 so performance.now() arithmetic gives the correct remaining time
    const t0 = performance.now() - alreadyElapsedMs;
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
  }, [startedAt, question?.id, totalMs, getServerTime]);

  const count = Math.ceil(remainingMs / 1000);
  const progress = Math.max(0, Math.min(1, (totalMs - remainingMs) / totalMs));
  const circ = 2 * Math.PI * 110;
  const offset = progress >= 1 ? 0 : circ * (1 - progress);
  const clueUrl = question ? resolveQuestionImageUrl(question.image_url) : null;

  return (
    <DsShell centered>
      <QPos question={question} totalQs={totalQs} />

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
          {clueUrl ? (
            <div className="ds-clue-img-wrap">
              <img src={clueUrl} alt="Clue" className="ds-clue-img" />
            </div>
          ) : (
            <DsImageFallback message="ไม่มีภาพปริศนาสำหรับคำถามนี้" />
          )}
          <div className="ds-muted" style={{ marginTop: 16 }}>ดูภาพให้ดีก่อนตอบ</div>
        </div>
      )}
    </DsShell>
  );
}

// ── 3. QUESTION OPEN ──────────────────────────────────────────────────────────
function DsQuestion({
  gameState, question, stats, totalQs, getServerTime,
}: {
  gameState: GameState;
  question: DisplayQuestion | null;
  stats: DisplayStatsResponse | null;
  totalQs: number;
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

  const submittedCount = stats?.submitted_count ?? null;
  const playerCount = stats?.player_count ?? null;

  return (
    <DsShell>
      {/* Top bar */}
      <div className="ds-q-bar">
        <QPos question={question} totalQs={totalQs} small />
        <div className="ds-q-meta">
          {submittedCount !== null && playerCount !== null && (
            <span className="ds-stat-pill">
              ตอบแล้ว {submittedCount} / {playerCount}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="ds-q-body">
        <div className="ds-q-left">
          <div className="ds-q-text">{question?.text ?? 'กำลังโหลด...'}</div>

          {/* Timer */}
          <div className={`ds-big-timer ${urgent ? 'ds-timer-urgent' : ''}`}>
            {timeLeft != null ? timeLeft.toFixed(1) : '—'}
            <span className="ds-timer-unit">s</span>
          </div>

          <div className="ds-timer-bar-track">
            <div
              className={`ds-timer-bar-fill ${urgent ? 'ds-timer-bar-urgent' : ''}`}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>

          <div className="ds-muted" style={{ marginTop: 16 }}>กำลังรับคำตอบ...</div>
        </div>

        {imgUrl ? (
          <div className="ds-q-right">
            <div className="ds-q-img-wrap">
              <img src={imgUrl} alt="Question" className="ds-q-img" />
            </div>
          </div>
        ) : (
          <div className="ds-q-right">
            <DsImageFallback message="ไม่มีภาพคำถามสำหรับข้อนี้" />
          </div>
        )}
      </div>
    </DsShell>
  );
}

// ── 4. QUESTION CLOSED ────────────────────────────────────────────────────────
function DsClosed({
  question, stats, totalQs,
}: {
  question: DisplayQuestion | null;
  stats: DisplayStatsResponse | null;
  totalQs: number;
}) {
  const submittedCount = stats?.submitted_count ?? null;
  const playerCount = stats?.player_count ?? null;

  return (
    <DsShell centered>
      <QPos question={question} totalQs={totalQs} />
      <div className="ds-closed-icon">🔒</div>
      <div className="ds-huge-text">หมดเวลา!</div>
      {submittedCount !== null && playerCount !== null && (
        <div className="ds-stat-line">
          ตอบแล้ว <strong>{submittedCount}</strong> / {playerCount} คน
        </div>
      )}
      <div className="ds-sub-text">รอการเฉลยจากพิธีกร...</div>
    </DsShell>
  );
}

// ── 5. REVEAL ─────────────────────────────────────────────────────────────────
function DsReveal({
  gameState, question, stats, totalQs, getServerTime,
}: {
  gameState: GameState;
  question: DisplayQuestion | null;
  stats: DisplayStatsResponse | null;
  totalQs: number;
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
  const activeRevealImage = showReveal ? revealImg : baseImg;
  const maskUrl = `${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(question.id)}&updatedAt=${encodeURIComponent(gameState.updated_at ?? '')}`;

  const submittedCount = stats?.submitted_count ?? 0;
  const correctCount = stats?.correct_count ?? 0;
  const accuracy = stats?.accuracy ?? 0;

  return (
    <DsShell>
      <div className="ds-reveal-header">
        <QPos question={question} totalQs={totalQs} small />
        <div className="ds-label ds-gold" style={{ letterSpacing: '.2em' }}>เฉลย</div>
      </div>

      <div className="ds-reveal-body">
        <div className="ds-reveal-text">{question.text}</div>
        {activeRevealImage ? (
          <div className="ds-reveal-img-wrap">
            <img
              src={activeRevealImage}
              alt="Reveal"
              className="ds-reveal-img"
            />
            <img src={maskUrl} alt="" aria-hidden className="ds-reveal-mask reveal-mask-pulse" />
          </div>
        ) : (
          <DsImageFallback message="ไม่มีภาพสำหรับเฉลยของคำถามนี้" />
        )}

        {/* Answer stats — shown once reveal is up */}
        {showReveal && submittedCount > 0 && (
          <div className="ds-reveal-stats">
            <div className="ds-reveal-stat-item">
              <span className="ds-label">ตอบถูก</span>
              <span className="ds-reveal-stat-val ds-gold">{correctCount} / {submittedCount}</span>
            </div>
            <div className="ds-reveal-stat-sep" />
            <div className="ds-reveal-stat-item">
              <span className="ds-label">ความแม่นยำ</span>
              <span className="ds-reveal-stat-val">{accuracy.toFixed(1)}%</span>
            </div>
          </div>
        )}

        {!showReveal && (
          <div className="ds-muted" style={{ marginTop: 12 }}>กำลังแสดงเฉลย...</div>
        )}
      </div>
    </DsShell>
  );
}

// ── 6 + 7. LEADERBOARD / FINAL ────────────────────────────────────────────────
function DsLeaderboard({
  leaderboard, question, totalQs, isFinal,
}: {
  leaderboard: LeaderboardEntry[];
  question: DisplayQuestion | null;
  totalQs: number;
  isFinal: boolean;
}) {
  const winner = leaderboard[0];
  const top = leaderboard.slice(0, 10);
  const MEDALS = ['🥇', '🥈', '🥉'];

  return (
    <DsShell>
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
              {question
                ? `หลังจบ Question ${question.play_order}${totalQs > 0 ? ` / ${totalQs}` : ''}`
                : 'Leaderboard'}
            </div>
            <div className="ds-title" style={{ fontSize: 32 }}>ตารางคะแนน</div>
          </>
        )}
      </div>

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
