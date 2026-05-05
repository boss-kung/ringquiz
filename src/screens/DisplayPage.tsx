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

interface DisplayQuestion {
  id: string;
  text: string;
  image_url: string;
  reveal_image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  order_index: number;
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  circle_radius_ratio: number;
  play_order: number;
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
          offset.current = d.server_time_ms + (t1 - t0) / 2 - t1;
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

// ── QR code ───────────────────────────────────────────────────────────────────

function QRCode({ url }: { url: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const encoded = encodeURIComponent(url);
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encoded}&bgcolor=050810&color=F5C74A&margin=12&qzone=1`;

  return (
    <div className="ds-qr-wrap">
      {!imgFailed ? (
        <img src={src} alt="QR Code" className="ds-qr-img-lg" onError={() => setImgFailed(true)} />
      ) : (
        <div className="ds-qr-fallback">
          <div className="ds-label" style={{ marginBottom: 8 }}>สแกนหรือพิมพ์ URL</div>
          <div className="ds-join-url ds-join-url-lg">{url}</div>
        </div>
      )}
    </div>
  );
}

// ── DisplayImageStage — reusable golden-ring image container ─────────────────

function DisplayImageStage({
  imageUrl,
  maskUrl,
  revealImageUrl,
  showReveal = false,
  aspectRatio,
  fullWidth = false,
}: {
  imageUrl: string | null;
  maskUrl?: string | null;
  revealImageUrl?: string | null;
  showReveal?: boolean;
  aspectRatio?: number | null;
  fullWidth?: boolean;
}) {
  const ar = aspectRatio ?? (4 / 3);

  if (!imageUrl) {
    return (
      <div className={`ds-img-stage${fullWidth ? ' ds-img-stage-full' : ''}`}>
        <div className="ds-img-stage-inner" style={{ aspectRatio: String(ar) }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="ds-muted" style={{ textAlign: 'center', padding: 24 }}>ไม่มีภาพสำหรับคำถามนี้</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`ds-img-stage${fullWidth ? ' ds-img-stage-full' : ''}`}>
      <div className="ds-img-stage-inner" style={{ aspectRatio: String(ar) }}>
        <img src={imageUrl} alt="" className="ds-img-base" />
        {revealImageUrl && (
          <img
            src={revealImageUrl}
            alt=""
            className={`ds-img-reveal${showReveal ? ' ds-img-reveal-visible' : ''}`}
          />
        )}
        {maskUrl && (
          <img
            src={maskUrl}
            alt=""
            aria-hidden
            className={`ds-img-mask reveal-mask-pulse${showReveal ? ' ds-img-mask-hidden' : ''}`}
          />
        )}
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

const MAX_VISIBLE_PLAYERS = 24;

export function DisplayPage() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [question, setQuestion] = useState<DisplayQuestion | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [stats, setStats] = useState<DisplayStatsResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [wsConnected, setWsConnected] = useState<boolean | null>(null);
  const [newPlayerIds, setNewPlayerIds] = useState<Set<string>>(new Set());
  const newPlayerTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const getServerTime = useDisplayServerTime();
  const prevQuestionKeyRef = useRef<string | null>(null);

  // Clean up timeout refs on unmount
  useEffect(() => {
    return () => {
      newPlayerTimeouts.current.forEach((tid) => clearTimeout(tid));
    };
  }, []);

  // ── 1. Anonymous auth ───────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAuthReady(true);
      } else {
        supabase.auth.signInAnonymously()
          .then(() => setAuthReady(true))
          .catch(() => setAuthReady(true));
      }
    });
  }, []);

  // ── 2. Fetch display stats ──────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${FUNCTIONS_URL}/get-display-stats`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      });
      if (!res.ok) return;
      const data = await res.json() as DisplayStatsResponse;
      setStats(data);
    } catch { /* non-critical */ }
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
      .subscribe((status) => {
        console.log('[Display] display-game:', status);
        setWsConnected(status === 'SUBSCRIBED');
      });

    return () => { supabase.removeChannel(ch); };
  }, [fetchStats]);

  // ── 4. Players subscription ─────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('players').select('id, display_name, total_score, joined_at')
      .then(({ data }) => { if (data) setPlayers(sortNewest(data as Player[])); });

    const ch = supabase.channel('display-players')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const p = payload.new as Player;
          setPlayers((cur) => sortNewest([...cur.filter((x) => x.id !== p.id), p]));

          // Highlight new player for 2.5s
          setNewPlayerIds((prev) => new Set([...prev, p.id]));
          const existing = newPlayerTimeouts.current.get(p.id);
          if (existing) clearTimeout(existing);
          const tid = setTimeout(() => {
            setNewPlayerIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; });
            newPlayerTimeouts.current.delete(p.id);
          }, 2500);
          newPlayerTimeouts.current.set(p.id, tid);
        } else if (payload.eventType === 'UPDATE') {
          const p = payload.new as Player;
          setPlayers((cur) => sortNewest(cur.map((x) => x.id === p.id ? p : x)));
        } else if (payload.eventType === 'DELETE') {
          const p = payload.old as Player;
          setPlayers((cur) => cur.filter((x) => x.id !== p.id));
        }
      })
      .subscribe((status) => {
        console.log('[Display] display-players:', status);
      });

    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── 5. Answers subscription → stat refresh ──────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel('display-answers')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers' }, () => {
        void fetchStats();
      })
      .subscribe((status) => {
        console.log('[Display] display-answers:', status);
      });
    return () => { supabase.removeChannel(ch); };
  }, [fetchStats]);

  // ── 6. Fallback polling — players during lobby ──────────────────────────────
  const currentStatus = gameState?.status ?? 'waiting';
  useEffect(() => {
    if (currentStatus !== 'waiting') return;
    const id = setInterval(() => {
      supabase.from('players').select('id, display_name, total_score, joined_at')
        .then(({ data }) => { if (data) setPlayers(sortNewest(data as Player[])); });
    }, 4000);
    return () => clearInterval(id);
  }, [currentStatus]);

  // ── 7. Fallback polling — stats during question phases ──────────────────────
  useEffect(() => {
    if (!['question_open', 'question_closed', 'reveal'].includes(currentStatus)) return;
    const id = setInterval(() => { void fetchStats(); }, 2000);
    return () => clearInterval(id);
  }, [currentStatus, fetchStats]);

  // ── 8. Fetch question with game_set_questions snapshot overlay ───────────────
  useEffect(() => {
    if (!authReady) return;
    const qId = gameState?.current_question_id ?? null;
    const gsqId = gameState?.current_game_set_question_id ?? null;

    if (!qId) { prevQuestionKeyRef.current = null; setQuestion(null); return; }

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
        play_order: qData.order_index,
      };

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

  // ── 9. Leaderboard — fetch + retry + subscription ───────────────────────────
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

    void fetchLb();
    const retryTimer = setTimeout(() => void fetchLb(), 400);

    const ch = supabase.channel('display-leaderboard')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'leaderboard_snapshot',
        filter: `question_id=eq.${qId}`,
      }, () => void fetchLb())
      .subscribe((status) => {
        console.log('[Display] display-leaderboard:', status);
      });

    return () => { clearTimeout(retryTimer); supabase.removeChannel(ch); };
  }, [gameState?.status, gameState?.current_question_id]);

  // ── Route to phase component ────────────────────────────────────────────────
  const status = gameState?.status ?? 'waiting';
  const totalQs = stats?.total_questions ?? 0;

  if (!gameState || status === 'waiting') {
    return <DsLobby players={players} newPlayerIds={newPlayerIds} wsConnected={wsConnected} />;
  }
  if (status === 'countdown') {
    return <DsCountdown gameState={gameState} question={question} totalQs={totalQs} getServerTime={getServerTime} />;
  }
  if (status === 'question_open') {
    return <DsQuestion gameState={gameState} question={question} stats={stats} totalQs={totalQs} getServerTime={getServerTime} />;
  }
  if (status === 'question_closed') {
    return <DsClosed question={question} stats={stats} totalQs={totalQs} />;
  }
  if (status === 'reveal') {
    return <DsReveal gameState={gameState} question={question} stats={stats} totalQs={totalQs} getServerTime={getServerTime} />;
  }
  if (status === 'leaderboard') {
    return <DsLeaderboard leaderboard={leaderboard} question={question} totalQs={totalQs} isFinal={false} />;
  }
  if (status === 'ended') {
    return <DsLeaderboard leaderboard={leaderboard} question={question} totalQs={totalQs} isFinal />;
  }
  return <DsLobby players={players} newPlayerIds={newPlayerIds} wsConnected={wsConnected} />;
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

function DsLobby({
  players,
  newPlayerIds,
  wsConnected,
}: {
  players: Player[];
  newPlayerIds: Set<string>;
  wsConnected: boolean | null;
}) {
  const joinUrl = window.location.origin + (import.meta.env.BASE_URL || '/');
  const visible = players.slice(0, MAX_VISIBLE_PLAYERS);
  const overflow = players.length - MAX_VISIBLE_PLAYERS;

  return (
    <DsShell>
      <div className="ds-lobby-header">
        <div>
          <div className="ds-label">Golden Ring · Lobby</div>
          <div className="ds-title">เกมวงแหวนปริศนา</div>
        </div>
        <div className="ds-lobby-badges">
          <div className="ds-live-badge">
            <span className="ds-live-dot" />LIVE
          </div>
          {wsConnected === false && (
            <div className="ds-conn-badge ds-conn-warn">
              <span className="ds-conn-dot" />Reconnecting
            </div>
          )}
          {wsConnected === true && (
            <div className="ds-conn-badge ds-conn-ok">
              <span className="ds-conn-dot" />Connected
            </div>
          )}
        </div>
      </div>

      <div className="ds-lobby-body">
        {/* Left: QR + join URL + hero player count */}
        <div className="ds-lobby-left">
          <div className="ds-label" style={{ marginBottom: 12, textAlign: 'center' }}>สแกนเพื่อเข้าร่วม</div>
          <QRCode url={joinUrl} />
          <div className="ds-join-url">{joinUrl}</div>
          <div className="ds-player-count">
            <div className="ds-lobby-player-count-hero">{players.length}</div>
            <div className="ds-lobby-player-count-label">ผู้เล่น</div>
          </div>
        </div>

        {/* Right: player wall — newest first, highlight new joiners */}
        <div className="ds-lobby-right">
          <div className="ds-label" style={{ marginBottom: 14 }}>ผู้เล่นในห้อง</div>
          {players.length === 0 ? (
            <p className="ds-muted">รอผู้เล่นเข้าร่วม...</p>
          ) : (
            <div className="ds-player-wall">
              {visible.map((p, i) => (
                <div
                  key={p.id}
                  className={`ds-player-chip${newPlayerIds.has(p.id) ? ' ds-player-new' : ''}`}
                  style={{ animationDelay: `${Math.min(i * 25, 350)}ms` }}
                >
                  <div className="ds-chip-av" style={{ background: avGrad(i) }}>{initials(p.display_name)}</div>
                  <span className="ds-chip-name">{p.display_name}</span>
                </div>
              ))}
              {overflow > 0 && (
                <div className="ds-overflow-chip">+{overflow} more</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="ds-lobby-footer">กำลังรอพิธีกรเริ่มเกม...</div>
    </DsShell>
  );
}

// ── 2. COUNTDOWN ──────────────────────────────────────────────────────────────

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
    const startMs = new Date(startedAt).getTime();
    const alreadyElapsedMs = Math.max(0, getServerTime() - startMs);
    const initialRemaining = Math.max(0, totalMs - alreadyElapsedMs);

    if (initialRemaining === 0) { setShowClue(true); return; }

    setRemainingMs(initialRemaining);
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
  const ar = question?.image_width && question?.image_height
    ? question.image_width / question.image_height
    : null;

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
          <DisplayImageStage
            imageUrl={clueUrl}
            aspectRatio={ar}
          />
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
  const ar = question?.image_width && question?.image_height
    ? question.image_width / question.image_height
    : null;

  const submittedCount = stats?.submitted_count ?? null;
  const playerCount = stats?.player_count ?? null;

  return (
    <DsShell>
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

      <div className="ds-q-body">
        <div className="ds-q-left">
          <div className="ds-q-text">{question?.text ?? 'กำลังโหลด...'}</div>
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
          <div className="ds-muted" style={{ marginTop: 8 }}>กำลังรับคำตอบ...</div>
        </div>

        <div className="ds-q-right">
          <DisplayImageStage imageUrl={imgUrl} aspectRatio={ar} />
        </div>
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
  const revealImg = resolveRevealImageUrl(question.reveal_image_url);
  const maskUrl = `${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(question.id)}&updatedAt=${encodeURIComponent(gameState.updated_at ?? '')}`;
  const ar = question.image_width && question.image_height
    ? question.image_width / question.image_height
    : null;

  const submittedCount = stats?.submitted_count ?? 0;
  const correctCount = stats?.correct_count ?? 0;
  const accuracy = stats?.accuracy ?? 0;

  return (
    <DsShell>
      <div className="ds-reveal-header">
        <QPos question={question} totalQs={totalQs} small />
        <div className="ds-label ds-gold" style={{ letterSpacing: '.2em' }}>เฉลย</div>
      </div>

      <div className="ds-reveal-layout">
        <div className="ds-reveal-left">
          <div className="ds-reveal-text">{question.text}</div>

          {/* Stats — revealed after 5s */}
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
            <div className="ds-muted">กำลังแสดงเฉลย...</div>
          )}
        </div>

        <div className="ds-reveal-right">
          <DisplayImageStage
            imageUrl={baseImg}
            maskUrl={maskUrl}
            revealImageUrl={revealImg ?? baseImg}
            showReveal={showReveal}
            aspectRatio={ar}
            fullWidth
          />
        </div>
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

  // Podium order: silver (idx 1) left, gold (idx 0) center, bronze (idx 2) right
  const podiumSlots = [1, 0, 2].filter((i) => top[i]);

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

      {isFinal && top.length > 0 && (
        <div className="ds-podium">
          {podiumSlots.map((i) => (
            <div
              key={top[i].player_id}
              className="ds-podium-slot"
              style={{
                order: i === 0 ? 1 : i === 1 ? 0 : 2,
                animationDelay: i === 0 ? '.3s' : i === 1 ? '.1s' : '.2s',
              }}
            >
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
          const isGold = entry.rank === 1;
          return (
            <div
              key={entry.player_id}
              className={`ds-lb-row${isGold ? ' ds-lb-row-gold' : ''}`}
              style={{ animationDelay: `${Math.min(idx * 45, 320)}ms` }}
            >
              <span className="ds-lb-rank ds-mono">#{entry.rank}</span>
              <div className="ds-lb-av" style={{ background: avGrad(entry.rank - 1) }}>{initials(entry.display_name)}</div>
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
