/**
 * DisplayPage — read-only big-screen / TV / projector view.
 * Fully standalone: no player state, no host controls, no answer submission.
 *
 * Reliability notes (P0):
 * - Realtime subscription status is tracked per-channel; badge derives from
 *   game + players channels, not just game.
 * - Fallback polling for players (4s during lobby) and stats (2s during active
 *   phases) is the source of truth — realtime is an accelerant only.
 * - Answers realtime subscription is BEST-EFFORT. Anonymous/display clients may
 *   not receive all answer INSERTs due to RLS. Stats correctness relies on the
 *   get-display-stats edge function via polling, not raw answers realtime.
 * - New player highlighting works for both realtime INSERT and polling detection.
 * - Images are preloaded when the current question is known.
 * - All image/mask layers use object-fit:cover (same as player view).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { supabase, GAME_STATE_ID, FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../lib/supabase';
import { resolveQuestionImageUrl, resolveRevealImageUrl } from '../lib/questionAssets';
import { COUNTDOWN_DISPLAY_SECONDS, SERVER_TIME_RESYNC_INTERVAL_MS } from '../lib/constants';
import type { GameState, Player, LeaderboardEntry, DisplayStatsResponse, DisplayEvent, DisplayEventType, DisplayTheme, SpecialRoundType } from '../lib/types';
import { QuestionImage } from '../components/QuestionImage';

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
  special_round_type: SpecialRoundType;
}

interface LeaderboardFxMeta {
  previousRank: number | null;
  rankDelta: number | null;
  scoreDelta: number;
  previousScore: number;
  isNew: boolean;
}

interface LeaderChangeState {
  playerId: string;
  displayName: string;
  at: number;
}

type LeaderboardAnimationStage = 'steady' | 'counting' | 'reordering';

// P0.1 — per-channel realtime status
type ChannelStatus = 'idle' | 'connecting' | 'subscribed' | 'error' | 'timeout';
interface RealtimeStatus {
  game: ChannelStatus;
  players: ChannelStatus;
  answers: ChannelStatus;
  leaderboard: ChannelStatus;
}

let gameSetSpecialRoundTypeSupported: boolean | null = null;

function toChannelStatus(supabaseStatus: string): ChannelStatus {
  switch (supabaseStatus) {
    case 'SUBSCRIBED':    return 'subscribed';
    case 'CHANNEL_ERROR': return 'error';
    case 'TIMED_OUT':     return 'timeout';
    case 'CLOSED':        return 'idle';
    default:              return 'connecting';
  }
}

type ConnBadgeCls = 'ds-conn-ok' | 'ds-conn-fallback' | 'ds-conn-warn' | 'ds-conn-neutral';
const DISPLAY_RT_DEBUG = import.meta.env.DEV;

function logDisplayRt(channel: string, status: string) {
  if (!DISPLAY_RT_DEBUG) return;
  console.log(`[Display] ${channel} channel:`, status);
}

function getSpecialRoundIntro(type: SpecialRoundType) {
  switch (type) {
    case 'double_score':
      return {
        kicker: 'Special Round',
        title: 'Double Score Round',
        subtitle: 'ข้อนี้ตอบถูกแล้วได้คะแนนคูณ 2',
        badge: 'DOUBLE SCORE ×2',
      };
    case 'speed_bonus':
      return {
        kicker: 'Special Round',
        title: 'Speed Bonus Round',
        subtitle: 'ยิ่งตอบเร็ว ยิ่งได้โบนัสเพิ่ม',
        badge: 'SPEED BONUS ⚡',
      };
    case 'mystery_round':
      return {
        kicker: 'Special Round',
        title: 'Mystery Round',
        subtitle: 'รอบพิเศษที่มีเซอร์ไพรส์รออยู่',
        badge: 'MYSTERY ROUND 🎭',
      };
    default:
      return null;
  }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  return reduced;
}

function deriveConnBadge(
  rt: RealtimeStatus,
  playersError: boolean,
  gameStateError: boolean,
  statsError: boolean,
): { label: string; cls: ConnBadgeCls } {
  const gameOk = rt.game === 'subscribed';
  const playersOk = rt.players === 'subscribed';
  const answersOk = rt.answers === 'subscribed' || rt.answers === 'idle';
  const leaderboardOk = rt.leaderboard === 'subscribed' || rt.leaderboard === 'idle';
  if (rt.game === 'idle' && rt.players === 'idle') return { label: 'Connecting...', cls: 'ds-conn-neutral' };
  if (gameOk && playersOk && answersOk && leaderboardOk && !gameStateError && !statsError && !playersError) {
    return { label: 'Realtime OK', cls: 'ds-conn-ok' };
  }
  if (gameStateError || playersError || statsError) return { label: 'Sync Issue', cls: 'ds-conn-warn' };
  if (gameOk && !playersOk) return { label: 'Fallback Sync', cls: 'ds-conn-fallback' };
  return { label: 'Connecting...', cls: 'ds-conn-neutral' };
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

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function sortNewest(players: Player[]): Player[] {
  return [...players].sort((a, b) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime());
}

// ── P0.6 — image preload hook ─────────────────────────────────────────────────

function usePreloadImages(...urls: (string | null | undefined)[]) {
  const urlKey = urls.filter((u): u is string => !!u).join('\0');
  useEffect(() => {
    if (!urlKey) return;
    const imgs = urlKey.split('\0').map((url) => {
      const img = new Image();
      img.src = url;
      img.onerror = () => console.warn('[Display] preload failed:', url.split('?')[0]);
      return img;
    });
    return () => { imgs.forEach((img) => { img.src = ''; }); };
  // urlKey is a derived stable string — intentional dep instead of the raw array
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);
}

// ── Server-time sync hook ─────────────────────────────────────────────────────

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

// ── P0.5 — DisplayImageStage ─────────────────────────────────────────────────
// All layers use object-fit:contain so image and mask share the same coordinate
// space. If aspectRatio metadata is available, use it; otherwise detect from the
// base image's naturalWidth/naturalHeight after it loads.

function DisplayImageStage({
  imageUrl,
  maskUrl,
  revealImageUrl,
  showReveal = false,
  revealReady = true,
  fullWidth = false,
  variant = 'question',
}: {
  imageUrl: string | null;
  maskUrl?: string | null;
  revealImageUrl?: string | null;
  showReveal?: boolean;
  revealReady?: boolean;
  fullWidth?: boolean;
  variant?: 'clue' | 'question' | 'reveal';
}) {
  const shellVariant =
    variant === 'clue' ? 'quiz-image-shell--display-clue' :
    variant === 'reveal' ? 'quiz-image-shell--display-reveal' :
    'quiz-image-shell--display-question';

  const displayImageUrl = showReveal && revealReady ? (revealImageUrl ?? imageUrl) : imageUrl;
  const shellClassName = `ds-display-shell ${shellVariant}${fullWidth ? ' ds-display-shell-full' : ''}${showReveal && revealReady ? ' quiz-image-shell--reveal-active' : ''}`;

  return (
    <div className="ds-display-image-wrap">
      <QuestionImage
        imageUrl={displayImageUrl}
        circleRadiusRatio={0}
        circle={null}
        onCircleChange={() => {}}
        locked
        maskOverlayUrl={maskUrl ?? undefined}
        maskOverlayClassName="reveal-mask-pulse"
        shellClassName={shellClassName}
      />
    </div>
  );
}

function DisplayTransition({
  phase,
  reducedMotion,
  children,
}: {
  phase: string;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const prevPhaseRef = useRef(phase);
  const [transitionKey, setTransitionKey] = useState(0);

  useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      prevPhaseRef.current = phase;
      setTransitionKey((n) => n + 1);
    }
  }, [phase]);

  return (
    <div
      key={`${phase}-${transitionKey}`}
      className={`ds-phase-transition${reducedMotion ? ' ds-phase-transition-reduced' : ''}`}
    >
      {children}
    </div>
  );
}

function RankDeltaBadge({ meta }: { meta: LeaderboardFxMeta | undefined }) {
  if (!meta) return null;
  if (meta.isNew) return <span className="ds-rank-delta ds-rank-delta-new">NEW</span>;
  if (!meta.rankDelta) return null;
  if (meta.rankDelta > 0) {
    return <span className="ds-rank-delta ds-rank-delta-up">▲ +{meta.rankDelta}</span>;
  }
  return <span className="ds-rank-delta ds-rank-delta-down">▼ -{Math.abs(meta.rankDelta)}</span>;
}

function AnimatedScore({
  value,
  from,
  durationMs = 1600,
  reducedMotion,
}: {
  value: number;
  from: number;
  durationMs?: number;
  reducedMotion: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    if (reducedMotion || from === value) {
      setDisplayValue(value);
      return;
    }

    const start = performance.now();
    const duration = durationMs;
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayValue(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, from, reducedMotion, value]);

  return <>{displayValue.toLocaleString()}</>;
}

// ── ConfettiBurst (Phase 2 — audience-safe, CSS-only, max 32 particles) ──────

const CONFETTI_COLORS_DS = ['#F5C74A','#FFF8E7','#34D399','#818CF8','#FB7185','#FBBF24'];

function ConfettiBurst({
  active,
  mode = 'gold',
  count = 28,
}: {
  active: boolean;
  mode?: 'gold' | 'success';
  count?: number;
}) {
  if (!active) return null;
  const colors = mode === 'success'
    ? ['#34D399','#6EE7B7','#F5C74A','#818CF8','#FFF8E7']
    : CONFETTI_COLORS_DS;
  return (
    <div className="ds-confetti-burst" aria-hidden>
      {Array.from({ length: Math.min(count, 32) }, (_, i) => (
        <span
          key={i}
          className="ds-confetti-piece"
          style={{
            '--x': `${(Math.random() * 2 - 1) * 120}px`,
            '--delay': `${(i / count) * 0.6}s`,
            '--rot': `${Math.random() * 720 - 360}deg`,
            '--dur': `${0.9 + Math.random() * 0.7}s`,
            background: colors[i % colors.length],
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

// ── Special round badge (shared across question phases) ───────────────────────

function SpecialRoundBadge({ type, large = false }: { type: SpecialRoundType; large?: boolean }) {
  if (type === 'normal') return null;
  const intro = getSpecialRoundIntro(type);
  if (!intro) return null;
  const cfg = {
    double_score: { color: 'var(--gold)', bg: 'rgba(245,199,74,.18)' },
    speed_bonus:  { color: 'var(--emerald)', bg: 'rgba(52,211,153,.15)' },
    mystery_round:{ color: 'var(--indigo)', bg: 'rgba(129,140,248,.18)' },
  }[type];
  return (
    <div
      className={`ds-special-badge${large ? ' ds-special-badge-lg' : ''}${type === 'mystery_round' ? ' ds-special-badge-mystery' : ''}`}
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {intro.badge}
    </div>
  );
}

function SpecialRoundIntroBanner({ type }: { type: SpecialRoundType }) {
  const intro = getSpecialRoundIntro(type);
  if (!intro) return null;

  return (
    <div className="ds-special-round-intro" aria-live="polite">
      <div className={`ds-special-round-intro-card ds-special-round-intro-${type}`}>
        <div className="ds-special-round-intro-kicker">{intro.kicker}</div>
        <div className="ds-special-round-intro-title">{intro.title}</div>
        <div className="ds-special-round-intro-subtitle">{intro.subtitle}</div>
      </div>
    </div>
  );
}

// ── DisplayStageFxOverlay — host-triggered visual events ──────────────────────

interface ActiveDisplayFx {
  type: DisplayEventType;
  id: string;
  startedAt: number;
  payload: Record<string, unknown>;
}

function DisplayStageFxOverlay({ fx }: { fx: ActiveDisplayFx | null }) {
  if (!fx) return null;

  if (fx.type === 'hype_cheer') {
    return (
      <div className="ds-fx-overlay ds-fx-cheer" aria-hidden>
        <div className="ds-fx-cheer-banner">
          <span className="ds-fx-cheer-emoji">🎉</span>
          <span className="ds-fx-cheer-text">เชียร์!</span>
          <span className="ds-fx-cheer-emoji">🎉</span>
        </div>
        <div className="ds-fx-sparkle-ring" aria-hidden>
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="ds-fx-sparkle" style={{ '--ds-sp-angle': `${i * 30}deg` } as CSSProperties} />
          ))}
        </div>
      </div>
    );
  }

  if (fx.type === 'spotlight_leaderboard') {
    return (
      <div className="ds-fx-overlay ds-fx-spotlight" aria-hidden>
        <div className="ds-fx-spotlight-beam" />
        <div className="ds-fx-spotlight-text">🏆 Leaderboard Spotlight</div>
      </div>
    );
  }

  if (fx.type === 'final_drumroll') {
    return (
      <div className="ds-fx-overlay ds-fx-drumroll" aria-hidden>
        <div className="ds-fx-drumroll-text">🥁 Final Drumroll!</div>
        <div className="ds-fx-drumroll-ring" />
      </div>
    );
  }

  return null;
}

// ── Root component ────────────────────────────────────────────────────────────

const MAX_VISIBLE_PLAYERS = 24;
const LEADERBOARD_PRE_COUNT_HOLD_MS = 350;
const LEADERBOARD_SCORE_ANIMATION_MS = 1900;
const LEADERBOARD_REORDER_MOVE_MS = 1200;
const LEADERBOARD_REORDER_SETTLE_MS = 1250;
const LEADERBOARD_LEADER_BANNER_MS = 2600;

export function DisplayPage() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [question, setQuestion] = useState<DisplayQuestion | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [stats, setStats] = useState<DisplayStatsResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // P0.1 — truthful per-channel status
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>({
    game: 'idle', players: 'idle', answers: 'idle', leaderboard: 'idle',
  });

  // P0.2 — new player highlight (works for both realtime and polling)
  const [newPlayerIds, setNewPlayerIds] = useState<Set<string>>(new Set());
  const [latestJoined, setLatestJoined] = useState<Player | null>(null);
  const knownPlayerIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);
  const newPlayerTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const latestJoinedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P0.4 — fetch error states
  const [playersFetchError, setPlayersFetchError] = useState(false);
  const [statsFetchError, setStatsFetchError] = useState(false);
  const [questionFetchError, setQuestionFetchError] = useState(false);
  const [gameStateFetchError, setGameStateFetchError] = useState(false);
  const [leaderboardFx, setLeaderboardFx] = useState<Record<string, LeaderboardFxMeta>>({});
  const [leaderChange, setLeaderChange] = useState<LeaderChangeState | null>(null);
  const [leaderboardAnimationStage, setLeaderboardAnimationStage] = useState<LeaderboardAnimationStage>('steady');

  // P0.4 — throttle repeated error logs
  const lastPlayersErrLogRef = useRef(0);
  const lastStatsErrLogRef = useRef(0);
  const lastGameStateErrLogRef = useRef(0);

  const [activeDisplayFx, setActiveDisplayFx] = useState<ActiveDisplayFx | null>(null);
  const [specialRoundIntroType, setSpecialRoundIntroType] = useState<SpecialRoundType | null>(null);
  const displayFxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const specialRoundIntroTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const specialRoundIntroQuestionIdRef = useRef<string | null>(null);

  const getServerTime = useDisplayServerTime();
  const reducedMotion = useReducedMotion();
  const prevQuestionKeyRef = useRef<string | null>(null);
  const previousLeaderboardRef = useRef<Map<string, LeaderboardEntry>>(new Map());
  const previousLeaderIdRef = useRef<string | null>(null);
  const leaderChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaderboardStageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaderboardSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaderboardSignatureRef = useRef<string | null>(null);

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      newPlayerTimeoutsRef.current.forEach((t) => clearTimeout(t));
      if (latestJoinedTimerRef.current) clearTimeout(latestJoinedTimerRef.current);
      if (leaderChangeTimerRef.current) clearTimeout(leaderChangeTimerRef.current);
      if (leaderboardStageTimerRef.current) clearTimeout(leaderboardStageTimerRef.current);
      if (leaderboardSettleTimerRef.current) clearTimeout(leaderboardSettleTimerRef.current);
      if (displayFxTimerRef.current) clearTimeout(displayFxTimerRef.current);
      if (specialRoundIntroTimerRef.current) clearTimeout(specialRoundIntroTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if ((gameState?.status ?? 'waiting') === 'waiting' && !gameState?.current_question_id) {
      previousLeaderboardRef.current = new Map();
      previousLeaderIdRef.current = null;
      leaderboardSignatureRef.current = null;
      setLeaderboardFx({});
      setLeaderChange(null);
      setLeaderboardAnimationStage('steady');
      setSpecialRoundIntroType(null);
      specialRoundIntroQuestionIdRef.current = null;
    }
  }, [gameState?.current_question_id, gameState?.status]);

  useEffect(() => {
    const status = gameState?.status;
    const questionId = question?.id ?? null;
    const specialType = question?.special_round_type ?? 'normal';
    const shouldShowForPhase = status === 'countdown' || status === 'question_open';

    if (!shouldShowForPhase || !questionId || specialType === 'normal') return;
    if (specialRoundIntroQuestionIdRef.current === questionId) return;

    specialRoundIntroQuestionIdRef.current = questionId;
    setSpecialRoundIntroType(specialType);
    if (specialRoundIntroTimerRef.current) clearTimeout(specialRoundIntroTimerRef.current);
    specialRoundIntroTimerRef.current = setTimeout(() => {
      setSpecialRoundIntroType(null);
      specialRoundIntroTimerRef.current = null;
    }, 2600);
  }, [gameState?.status, question?.id, question?.special_round_type]);

  // ── P0.2 — unified highlight helper ─────────────────────────────────────────
  // Called from both realtime INSERT callback and polling reconcile.
  // Immediately updates knownPlayerIds to prevent double-highlight from the
  // other path that may run shortly after.
  const highlightPlayer = useCallback((p: Player) => {
    knownPlayerIdsRef.current.add(p.id);

    setNewPlayerIds((prev) => new Set([...prev, p.id]));

    setLatestJoined(p);
    if (latestJoinedTimerRef.current) clearTimeout(latestJoinedTimerRef.current);
    latestJoinedTimerRef.current = setTimeout(() => {
      setLatestJoined(null);
      latestJoinedTimerRef.current = null;
    }, 3000);

    const existing = newPlayerTimeoutsRef.current.get(p.id);
    if (existing) clearTimeout(existing);
    const tid = setTimeout(() => {
      setNewPlayerIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; });
      newPlayerTimeoutsRef.current.delete(p.id);
    }, 2500);
    newPlayerTimeoutsRef.current.set(p.id, tid);
  }, []);

  // ── P0.2 — polling reconcile: compares against knownPlayerIds ───────────────
  // First load skips highlighting (players were already in the room before we loaded).
  const reconcilePlayers = useCallback((sorted: Player[]) => {
    if (isFirstLoadRef.current) {
      knownPlayerIdsRef.current = new Set(sorted.map((p) => p.id));
      isFirstLoadRef.current = false;
      setPlayers(sorted);
      return;
    }
    // Detect newcomers — sorted newest-first so we find the most recently joined first
    for (const p of sorted) {
      if (!knownPlayerIdsRef.current.has(p.id)) {
        highlightPlayer(p);
      }
    }
    knownPlayerIdsRef.current = new Set(sorted.map((p) => p.id));
    setPlayers(sorted);
  }, [highlightPlayer]);

  const fetchGameState = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('game_state')
        .select('*')
        .eq('id', GAME_STATE_ID)
        .single();

      if (error) throw error;
      if (data) {
        setGameState(data as GameState);
        setGameStateFetchError(false);
      }
    } catch (err) {
      const now = Date.now();
      if (now - lastGameStateErrLogRef.current > 10_000) {
        console.error('[DisplayPage] game_state fetch failed:', err);
        lastGameStateErrLogRef.current = now;
      }
      setGameStateFetchError(true);
    }
  }, []);

  // ── P0.4 — players fetch with error tracking ─────────────────────────────────
  const fetchPlayers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('players').select('id, display_name, total_score, joined_at');
      if (error) throw error;
      reconcilePlayers(sortNewest((data ?? []) as Player[]));
      setPlayersFetchError(false);
    } catch (err) {
      const now = Date.now();
      if (now - lastPlayersErrLogRef.current > 10_000) {
        console.error('[DisplayPage] players fetch failed:', err);
        lastPlayersErrLogRef.current = now;
      }
      setPlayersFetchError(true);
    }
  }, [reconcilePlayers]);

  const applyLeaderboardSnapshot = useCallback((entries: LeaderboardEntry[]) => {
    const signature = entries
      .map((entry) => `${entry.question_id}:${entry.player_id}:${entry.rank}:${entry.cumulative_score}:${entry.question_score}`)
      .join('|');
    if (signature === leaderboardSignatureRef.current) return;
    leaderboardSignatureRef.current = signature;

    if (leaderboardStageTimerRef.current) {
      clearTimeout(leaderboardStageTimerRef.current);
      leaderboardStageTimerRef.current = null;
    }
    if (leaderboardSettleTimerRef.current) {
      clearTimeout(leaderboardSettleTimerRef.current);
      leaderboardSettleTimerRef.current = null;
    }

    const prevMap = previousLeaderboardRef.current;
    const nextMeta: Record<string, LeaderboardFxMeta> = {};

    for (const entry of entries) {
      const prev = prevMap.get(entry.player_id);
      nextMeta[entry.player_id] = {
        previousRank: prev?.rank ?? null,
        rankDelta: prev ? prev.rank - entry.rank : null,
        scoreDelta: prev ? entry.cumulative_score - prev.cumulative_score : entry.cumulative_score,
        previousScore: prev?.cumulative_score ?? (entry.rank === 1 ? Math.max(0, entry.cumulative_score - entry.question_score) : 0),
        isNew: !prev,
      };
    }

    const nextLeader = entries[0] ?? null;
    const triggerLeaderChange = () => {
      if (!nextLeader || !previousLeaderIdRef.current || previousLeaderIdRef.current === nextLeader.player_id) return;
      setLeaderChange({
        playerId: nextLeader.player_id,
        displayName: nextLeader.display_name,
        at: Date.now(),
      });
      if (leaderChangeTimerRef.current) clearTimeout(leaderChangeTimerRef.current);
      leaderChangeTimerRef.current = setTimeout(() => {
        setLeaderChange(null);
        leaderChangeTimerRef.current = null;
      }, LEADERBOARD_LEADER_BANNER_MS);
    };

    previousLeaderboardRef.current = new Map(entries.map((entry) => [entry.player_id, entry]));
    previousLeaderIdRef.current = nextLeader?.player_id ?? null;
    setLeaderboardFx(nextMeta);

    const hasPreviousBoard = prevMap.size > 0;
    const shouldStageAnimation =
      !reducedMotion &&
      gameState?.status === 'leaderboard' &&
      hasPreviousBoard;

    if (!shouldStageAnimation) {
      setLeaderboard(entries);
      setLeaderboardAnimationStage('steady');
      triggerLeaderChange();
      return;
    }

    const stagedEntries = [...entries].sort((a, b) => {
      const prevA = prevMap.get(a.player_id)?.rank ?? 999 + a.rank;
      const prevB = prevMap.get(b.player_id)?.rank ?? 999 + b.rank;
      if (prevA !== prevB) return prevA - prevB;
      return a.rank - b.rank;
    });

    leaderboardStageTimerRef.current = setTimeout(() => {
      setLeaderboard(stagedEntries);
      setLeaderboardAnimationStage('counting');

      leaderboardSettleTimerRef.current = setTimeout(() => {
        setLeaderboard(entries);
        setLeaderboardAnimationStage('reordering');
        triggerLeaderChange();

        leaderboardStageTimerRef.current = setTimeout(() => {
          setLeaderboardAnimationStage('steady');
          leaderboardStageTimerRef.current = null;
        }, LEADERBOARD_REORDER_SETTLE_MS);
        leaderboardSettleTimerRef.current = null;
      }, LEADERBOARD_SCORE_ANIMATION_MS);
    }, LEADERBOARD_PRE_COUNT_HOLD_MS);
  }, [gameState?.status, reducedMotion]);

  // ── P0.3 + P0.4 — stats fetch (polling is the source of truth for answer counts)
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${FUNCTIONS_URL}/get-display-stats`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as DisplayStatsResponse;
      setStats(data);
      setStatsFetchError(false);
    } catch (err) {
      const now = Date.now();
      if (now - lastStatsErrLogRef.current > 10_000) {
        console.error('[DisplayPage] stats fetch failed:', err);
        lastStatsErrLogRef.current = now;
      }
      setStatsFetchError(true);
    }
  }, []);

  // ── 1. Anonymous auth ───────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAuthReady(true);
      } else {
        supabase.auth.signInAnonymously()
          .then(() => setAuthReady(true))
          .catch(() => setAuthReady(true)); // proceed anyway; RLS allows anon reads
      }
    });
  }, []);

  // ── 2. Game state subscription ──────────────────────────────────────────────
  useEffect(() => {
    void fetchGameState().then(() => { void fetchStats(); });

    const ch = supabase.channel('display-game')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'game_state',
        filter: `id=eq.${GAME_STATE_ID}`,
      }, (payload) => {
        setGameState(payload.new as GameState);
        setGameStateFetchError(false);
        void fetchStats();
      })
      .subscribe((s) => {
        const cs = toChannelStatus(s);
        logDisplayRt('display-game', s);
        setRealtimeStatus((prev) => ({ ...prev, game: cs }));
      });

    return () => { supabase.removeChannel(ch); };
  }, [fetchGameState, fetchStats]);

  // ── 3. Players subscription (P0.1 + P0.2) ───────────────────────────────────
  useEffect(() => {
    void fetchPlayers(); // initial load — reconcilePlayers skips highlights on first run

    const ch = supabase.channel('display-players')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const p = payload.new as Player;
          setPlayers((cur) => sortNewest([...cur.filter((x) => x.id !== p.id), p]));
          // Only highlight if not already known (polling may have detected this player first)
          if (!knownPlayerIdsRef.current.has(p.id)) {
            highlightPlayer(p);
          }
        } else if (payload.eventType === 'UPDATE') {
          const p = payload.new as Player;
          setPlayers((cur) => sortNewest(cur.map((x) => x.id === p.id ? p : x)));
        } else if (payload.eventType === 'DELETE') {
          const p = payload.old as Player;
          setPlayers((cur) => cur.filter((x) => x.id !== p.id));
          knownPlayerIdsRef.current.delete(p.id);
        }
      })
      .subscribe((s) => {
        const cs = toChannelStatus(s);
        logDisplayRt('display-players', s);
        setRealtimeStatus((prev) => ({ ...prev, players: cs }));
      });

    return () => { supabase.removeChannel(ch); };
  }, [fetchPlayers, highlightPlayer]);

  // ── 4. Answers subscription — BEST-EFFORT accelerant only (P0.3) ─────────────
  // Anonymous clients may not receive all answer INSERTs due to RLS on the answers
  // table. Do NOT rely on this for correctness. Stats accuracy comes from polling
  // get-display-stats every 2 seconds (see effect below). This subscription just
  // triggers an early stat refresh when realtime does fire — a nice-to-have.
  useEffect(() => {
    const ch = supabase.channel('display-answers')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers' }, () => {
        void fetchStats(); // best-effort acceleration — polling is the source of truth
      })
      .subscribe((s) => {
        const cs = toChannelStatus(s);
        logDisplayRt('display-answers', s);
        setRealtimeStatus((prev) => ({ ...prev, answers: cs }));
      });
    return () => {
      supabase.removeChannel(ch);
      setRealtimeStatus((prev) => ({ ...prev, answers: 'idle' }));
    };
  }, [fetchStats]);

  // ── 5. Fallback polling — players during lobby (P0.2) ───────────────────────
  const currentStatus = gameState?.status ?? 'waiting';
  useEffect(() => {
    if (currentStatus !== 'waiting') return;
    const id = setInterval(() => { void fetchPlayers(); }, 4000);
    return () => clearInterval(id);
  }, [currentStatus, fetchPlayers]);

  // ── 5.5 Game state fallback polling — keeps the stage moving if realtime blips
  useEffect(() => {
    const interval =
      currentStatus === 'waiting' ? 4000 :
      currentStatus === 'leaderboard' || currentStatus === 'ended' ? 2500 :
      1500;

    const id = setInterval(() => { void fetchGameState(); }, interval);
    return () => clearInterval(id);
  }, [currentStatus, fetchGameState]);

  // ── 6. Stats polling during active phases (P0.3) ────────────────────────────
  // Polling is the correctness path for answered/correct counts.
  // Answers realtime (effect above) is supplemental.
  useEffect(() => {
    if (!['question_open', 'question_closed', 'reveal'].includes(currentStatus)) return;
    const interval = currentStatus === 'question_open' ? 1500 : 2500;
    const id = setInterval(() => { void fetchStats(); }, interval);
    return () => clearInterval(id);
  }, [currentStatus, fetchStats]);

  // ── 7. Question fetch with error tracking (P0.4) ────────────────────────────
  useEffect(() => {
    if (!authReady) return;
    const qId = gameState?.current_question_id ?? null;
    const gsqId = gameState?.current_game_set_question_id ?? null;

    if (!qId) { prevQuestionKeyRef.current = null; setQuestion(null); return; }

    const key = `${qId}::${gsqId}`;
    if (key === prevQuestionKeyRef.current) return;
    prevQuestionKeyRef.current = key;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const fetch_ = async () => {
      try {
        const { data: qData, error } = await supabase
          .from('questions')
          .select('id, order_index, text, image_url, circle_radius_ratio, time_limit_seconds, max_score, min_correct_score, image_width, image_height, reveal_image_url')
          .eq('id', qId)
          .single();

        if (error) throw error;
        if (!qData) throw new Error('no data returned');

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
          special_round_type: 'normal',
        };

        if (gsqId) {
          const { data: gsqData } = await supabase
            .from('game_set_questions')
            .select('play_order, time_limit_seconds, max_score, min_correct_score, circle_radius_ratio')
            .eq('id', gsqId)
            .single() as { data: { play_order: number; time_limit_seconds: number; max_score: number; min_correct_score: number; circle_radius_ratio: number } | null };
          if (gsqData) {
            dq = { ...dq, play_order: gsqData.play_order, time_limit_seconds: gsqData.time_limit_seconds,
              max_score: gsqData.max_score, min_correct_score: gsqData.min_correct_score,
              circle_radius_ratio: gsqData.circle_radius_ratio,
              special_round_type: 'normal' };
          }

          if (gameSetSpecialRoundTypeSupported !== false) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: srtData, error: srtErr } = await (supabase as any)
              .from('game_set_questions')
              .select('special_round_type')
              .eq('id', gsqId)
              .single() as {
                data: { special_round_type?: string } | null;
                error: { message?: string } | null;
              };

            if (srtErr && (srtErr.message ?? '').includes('does not exist')) {
              gameSetSpecialRoundTypeSupported = false;
            } else if (!srtErr) {
              gameSetSpecialRoundTypeSupported = true;
            }

            if (srtData?.special_round_type) {
              dq = { ...dq, special_round_type: srtData.special_round_type as SpecialRoundType };
            }
          }
        }

        if (!cancelled) {
          setQuestion(dq);
          setQuestionFetchError(false);
        }
      } catch (err) {
        console.error('[DisplayPage] question fetch failed:', err);
        if (!cancelled) {
          setQuestionFetchError(true);
          prevQuestionKeyRef.current = null;
          retryTimer = setTimeout(() => {
            void fetch_();
          }, 1500);
        }
      }
    };

    void fetch_();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [authReady, gameState?.current_question_id, gameState?.current_game_set_question_id]);

  // ── P0.6 — Preload question images when question becomes known ───────────────
  const preloadImageUrl = question ? resolveQuestionImageUrl(question.image_url) : null;
  const preloadRevealUrl = question ? resolveRevealImageUrl(question.reveal_image_url) : null;
  usePreloadImages(preloadImageUrl, preloadRevealUrl);

  // ── 7.5 Display events subscription ─────────────────────────────────────────
  // Events older than 10s on initial load are ignored to prevent stale hype.
  // Same event_type restarts the animation (clear existing timer first).
  const activateFx = useCallback((event: DisplayEvent) => {
    const ageMs = Date.now() - new Date(event.created_at).getTime();
    if (ageMs > 10_000) return; // ignore stale events on page load

    if (displayFxTimerRef.current) clearTimeout(displayFxTimerRef.current);

    setActiveDisplayFx({
      type: event.event_type,
      id: event.id,
      startedAt: Date.now(),
      payload: event.payload,
    });

    const durationMs = event.event_type === 'hype_cheer' ? 2200
      : event.event_type === 'final_drumroll' ? 3000
      : 2000;

    displayFxTimerRef.current = setTimeout(() => {
      setActiveDisplayFx(null);
      displayFxTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    // Subscribe to Realtime INSERT events on display_events.
    const ch = supabase.channel('display-events')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'display_events' }, (payload) => {
        activateFx(payload.new as DisplayEvent);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activateFx]);

  // ── 8. Leaderboard fetch + subscription ─────────────────────────────────────
  useEffect(() => {
    const status = gameState?.status;
    const qId = gameState?.current_question_id;
    if ((status !== 'leaderboard' && status !== 'ended') || !qId) return;

    const fetchLb = async () => {
      try {
        const { data, error } = await supabase
          .from('leaderboard_snapshot')
          .select('question_id, player_id, rank, display_name, question_score, cumulative_score')
          .eq('question_id', qId)
          .order('rank', { ascending: true })
          .limit(10);
        if (error) throw error;
        applyLeaderboardSnapshot((data ?? []) as LeaderboardEntry[]);
      } catch (err) {
        console.error('[DisplayPage] leaderboard fetch failed:', err);
      }
    };

    void fetchLb();
    const retryTimer = setTimeout(() => void fetchLb(), 400);

    // Debounce realtime INSERT events: compute_leaderboard inserts N rows in
    // rapid succession; without debouncing every INSERT fires a fetch.
    // Coalesce the burst into a single fetch after 300 ms of silence.
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const debouncedFetchLb = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void fetchLb(), 300);
    };

    const ch = supabase.channel('display-leaderboard')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'leaderboard_snapshot',
        filter: `question_id=eq.${qId}`,
      }, debouncedFetchLb)
      .subscribe((s) => {
        const cs = toChannelStatus(s);
        logDisplayRt('display-leaderboard', s);
        setRealtimeStatus((prev) => ({ ...prev, leaderboard: cs }));
      });

    return () => {
      clearTimeout(retryTimer);
      clearTimeout(debounceTimer);
      supabase.removeChannel(ch);
      setRealtimeStatus((prev) => ({ ...prev, leaderboard: 'idle' }));
    };
  }, [gameState?.status, gameState?.current_question_id]);

  // ── Route to phase component ────────────────────────────────────────────────
  const status = gameState?.status ?? 'waiting';
  const totalQs = stats?.total_questions ?? 0;
  let screen: React.ReactNode;
  if (!gameState || status === 'waiting') {
    screen = (
      <DsLobby
        players={players}
        newPlayerIds={newPlayerIds}
        latestJoined={latestJoined}
        realtimeStatus={realtimeStatus}
        playersFetchError={playersFetchError}
        gameStateFetchError={gameStateFetchError}
        statsFetchError={statsFetchError}
        reducedMotion={reducedMotion}
      />
    );
  } else if (status === 'countdown') {
    screen = (
      <DsCountdown
        gameState={gameState}
        question={question}
        totalQs={totalQs}
        getServerTime={getServerTime}
        questionFetchError={questionFetchError}
        reducedMotion={reducedMotion}
      />
    );
  } else if (status === 'question_open') {
    screen = (
      <DsQuestion
        gameState={gameState}
        question={question}
        stats={stats}
        totalQs={totalQs}
        getServerTime={getServerTime}
        questionFetchError={questionFetchError}
        reducedMotion={reducedMotion}
      />
    );
  } else if (status === 'question_closed') {
    screen = <DsClosed question={question} stats={stats} totalQs={totalQs} />;
  } else if (status === 'reveal') {
    screen = (
      <DsReveal
        gameState={gameState}
        question={question}
        stats={stats}
        totalQs={totalQs}
        getServerTime={getServerTime}
        statsFetchError={statsFetchError}
      />
    );
    // Note: special_round_type is already in question object passed to DsReveal
  } else if (status === 'leaderboard') {
    screen = (
      <DsLeaderboard
        leaderboard={leaderboard}
        leaderboardFx={leaderboardFx}
        animationStage={leaderboardAnimationStage}
        leaderChange={leaderChange}
        question={question}
        totalQs={totalQs}
        isFinal={false}
        reducedMotion={reducedMotion}
      />
    );
  } else if (status === 'ended') {
    screen = (
      <DsLeaderboard
        leaderboard={leaderboard}
        leaderboardFx={leaderboardFx}
        animationStage={leaderboardAnimationStage}
        leaderChange={leaderChange}
        question={question}
        totalQs={totalQs}
        isFinal
        reducedMotion={reducedMotion}
      />
    );
  } else {
    screen = (
      <DsLobby
        players={players}
        newPlayerIds={newPlayerIds}
        latestJoined={latestJoined}
        realtimeStatus={realtimeStatus}
        playersFetchError={playersFetchError}
        gameStateFetchError={gameStateFetchError}
        statsFetchError={statsFetchError}
        reducedMotion={reducedMotion}
      />
    );
  }

  const theme: DisplayTheme = gameState?.display_theme ?? 'classic_gold';

  return (
    <div className={`ds-theme-${theme.replace(/_/g, '-')}`} style={{ height: '100%' }}>
      <DisplayTransition phase={status} reducedMotion={reducedMotion}>
        {screen}
      </DisplayTransition>
      {specialRoundIntroType && <SpecialRoundIntroBanner type={specialRoundIntroType} />}
      <DisplayStageFxOverlay fx={activeDisplayFx} />
    </div>
  );
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
    ? <div className="ds-q-pos-sm" style={{ fontSize: '2.5rem' }}>{pos}</div>
    : <div className="ds-q-pos" style={{ fontSize: '2.5rem' }}>{pos}</div>;
}

// ── 1. LOBBY ──────────────────────────────────────────────────────────────────

function DsLobby({
  players,
  newPlayerIds,
  latestJoined,
  realtimeStatus,
  playersFetchError,
  gameStateFetchError,
  statsFetchError,
  reducedMotion,
}: {
  players: Player[];
  newPlayerIds: Set<string>;
  latestJoined: Player | null;
  realtimeStatus: RealtimeStatus;
  playersFetchError: boolean;
  gameStateFetchError: boolean;
  statsFetchError: boolean;
  reducedMotion: boolean;
}) {
  const joinUrl = window.location.origin + (import.meta.env.BASE_URL || '/');
  const visible = players.slice(0, MAX_VISIBLE_PLAYERS);
  const overflow = players.length - MAX_VISIBLE_PLAYERS;
  const badge = deriveConnBadge(realtimeStatus, playersFetchError, gameStateFetchError, statsFetchError);

  // Hype meter (visual-only, no Supabase write)
  const hypeRatio = Math.min(players.length / 50, 1);
  const hypeLabel =
    players.length === 0 ? 'รอผู้เล่นคนแรก' :
    players.length <= 20 ? 'Warm up' :
    players.length <= 50 ? 'Getting loud' :
    'Full house';

  return (
    <DsShell>
      <div className="ds-lobby-header">
        <div>
          <div className="ds-label">Golden Ring Stage · Display Lobby</div>
          <div className="ds-title">เกมวงแหวนปริศนา</div>
          <div className="ds-lobby-subtitle">สแกนเพื่อเข้าร่วม และรอพิธีกรเปิดเวที</div>
        </div>
        <div className="ds-lobby-badges">
          <div className="ds-live-badge">
            <span className="ds-live-dot" />LIVE
          </div>
          <div className={`ds-conn-badge ${badge.cls}`}>
            <span className="ds-conn-dot" />{badge.label}
          </div>
        </div>
      </div>

      <div className="ds-lobby-body">
        <div className="ds-stage-card ds-stage-card-hero ds-lobby-left">
          <div className="ds-stage-rings" aria-hidden />
          <QRCode url={joinUrl} />
          {/* Hype meter — under QR, visual-only */}
          <div className="ds-hype-meter-wrap">
            <div className="ds-hype-label">{hypeLabel}</div>
            <div className="ds-hype-meter" aria-hidden>
              <div
                className="ds-hype-meter-fill"
                style={{ width: `${hypeRatio * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="ds-stage-card ds-stage-card-soft ds-lobby-right">
          <div className="ds-lobby-wall-header">
            <div className="ds-label">{latestJoined ? 'ผู้เล่นใหม่กำลังเข้าห้อง' : 'ผู้เล่นในห้อง'}</div>
            <div className="ds-player-count ds-stage-inset">
              {/* key triggers re-animation on count change */}
              <div key={players.length} className="ds-lobby-player-count-hero ds-count-pop">
                {players.length}
              </div>
              <div className="ds-lobby-player-count-label">ผู้เล่น</div>
            </div>
          </div>

          {latestJoined && (
            <div className="ds-latest-joined-hero">
              <span className="ds-latest-joined-icon">🎉</span>
              <span className="ds-latest-joined-name">{truncate(latestJoined.display_name, 28)}</span>
              <span className="ds-latest-joined-sub">เข้าร่วมแล้ว!</span>
            </div>
          )}

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
                  {newPlayerIds.has(p.id) && !reducedMotion && <span className="ds-player-new-badge">NEW</span>}
                </div>
              ))}
              {overflow > 0 && (
                <div className="ds-overflow-chip">+{overflow} more players</div>
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
  gameState, question, totalQs, getServerTime, questionFetchError, reducedMotion,
}: {
  gameState: GameState;
  question: DisplayQuestion | null;
  totalQs: number;
  getServerTime: () => number;
  questionFetchError: boolean;
  reducedMotion: boolean;
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

  // P0.6 — preload mask at reveal-phase ahead of time
  const maskUrl = question
    ? `${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(question.id)}&updatedAt=${encodeURIComponent(gameState.updated_at ?? '')}`
    : null;
  usePreloadImages(maskUrl);

  return (
    <DsShell centered>
      <QPos question={question} totalQs={totalQs} />

      {!showClue ? (
        <div className="ds-countdown-stage">
          <div className="ds-stage-kicker">Next Round</div>
          <div className="ds-label" style={{ marginBottom: 8 }}>เตรียมพร้อม!</div>
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
              <div key={count} className="ds-big-num ds-big-num-pop">{count > 0 ? count : '●'}</div>
            </div>
            {/* Lightweight count-change particle burst — client-only, never written to Supabase */}
            {!reducedMotion && count > 0 && (
              <div key={`p-${count}`} className="ds-countdown-particles" aria-hidden>
                {Array.from({ length: 10 }, (_, i) => (
                  <span
                    key={i}
                    className="ds-countdown-pop-particle"
                    style={{ '--ds-cd-angle': `${i * 36}deg` } as CSSProperties}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="ds-stage-caption">ภาพปริศนาจะขึ้นทันทีเมื่อ countdown จบ</div>
        </div>
      ) : (
        <div className="ds-stage-card ds-stage-card-clue ds-clue-wrap ds-clue-enter">
          {question && <SpecialRoundBadge type={question.special_round_type} large />}
          {questionFetchError && !clueUrl ? (
            <div className="ds-muted">ไม่สามารถโหลดภาพคำถามได้</div>
          ) : (
            <DisplayImageStage imageUrl={clueUrl} variant="clue" />
          )}
        </div>
      )}
    </DsShell>
  );
}

// ── 3. QUESTION OPEN ──────────────────────────────────────────────────────────

function DsQuestion({
  gameState, question, stats, totalQs, getServerTime, questionFetchError, reducedMotion,
}: {
  gameState: GameState;
  question: DisplayQuestion | null;
  stats: DisplayStatsResponse | null;
  totalQs: number;
  getServerTime: () => number;
  questionFetchError: boolean;
  reducedMotion: boolean;
}) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const prevSubmittedRef = useRef<number | null>(null);
  const [statPulse, setStatPulse] = useState(false);
  const milestoneRef = useRef<number>(0);
  const [milestoneBanner, setMilestoneBanner] = useState<string | null>(null);
  const milestoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const endsAt = gameState.question_ends_at;
    if (!endsAt) { setTimeLeft(null); return; }
    const endMs = new Date(endsAt).getTime();
    const tick = () => setTimeLeft(Math.max(0, (endMs - getServerTime()) / 1000));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [gameState.question_ends_at, getServerTime]);

  // Reset milestone tracker when question changes
  useEffect(() => {
    milestoneRef.current = 0;
    setMilestoneBanner(null);
    if (milestoneTimerRef.current) { clearTimeout(milestoneTimerRef.current); milestoneTimerRef.current = null; }
  }, [gameState.current_question_id]);

  // Stat pill pulse on answer count increase
  useEffect(() => {
    const count = stats?.submitted_count ?? null;
    if (count === null) return;
    if (prevSubmittedRef.current !== null && count > prevSubmittedRef.current) {
      setStatPulse(true);
      const t = setTimeout(() => setStatPulse(false), 600);
      prevSubmittedRef.current = count;
      return () => clearTimeout(t);
    }
    prevSubmittedRef.current = count;
  }, [stats?.submitted_count]);

  // Milestone banners at 50 / 75 / 90 / 100 %
  useEffect(() => {
    const count = stats?.submitted_count ?? 0;
    const total = stats?.player_count ?? 0;
    if (!total || !count) return;
    const pct = count / total;
    const thresholds: Array<{ pct: number; label: string }> = [
      { pct: 1.0, label: '🎯 ครบ 100% แล้ว!' },
      { pct: 0.9, label: '🔥 90% ตอบแล้ว' },
      { pct: 0.75, label: '75% ตอบแล้ว' },
      { pct: 0.5, label: '50% ตอบแล้ว' },
    ];
    for (const th of thresholds) {
      if (pct >= th.pct && milestoneRef.current < th.pct) {
        milestoneRef.current = th.pct;
        setMilestoneBanner(th.label);
        if (milestoneTimerRef.current) clearTimeout(milestoneTimerRef.current);
        milestoneTimerRef.current = setTimeout(() => {
          setMilestoneBanner(null);
          milestoneTimerRef.current = null;
        }, 2500);
        break;
      }
    }
  }, [stats?.submitted_count, stats?.player_count]);

  useEffect(() => {
    return () => { if (milestoneTimerRef.current) clearTimeout(milestoneTimerRef.current); };
  }, []);

  const totalSec = question?.time_limit_seconds ?? 30;
  const ratio = timeLeft != null ? Math.max(0, Math.min(1, timeLeft / totalSec)) : 1;
  const urgent = timeLeft != null && timeLeft <= 5;
  const critical = timeLeft != null && timeLeft <= 3;
  const imgUrl = question ? resolveQuestionImageUrl(question.image_url) : null;

  const submittedCount = stats?.submitted_count ?? null;
  const playerCount = stats?.player_count ?? null;

  return (
    <DsShell>
      <div
        className={[
          'ds-q-root',
          urgent ? 'ds-question-urgent' : '',
          critical ? 'ds-question-critical' : '',
        ].filter(Boolean).join(' ')}
        style={{ position: 'relative' }}
      >
        {!reducedMotion && <div className="ds-q-shockwave" aria-hidden />}
        {milestoneBanner && !reducedMotion && (
          <div className="ds-answer-milestone" aria-live="polite">{milestoneBanner}</div>
        )}

        <div className="ds-q-bar" style={{fontSize: '1.45rem'}}>
          <QPos question={question} totalQs={totalQs} small />
          <div className="ds-q-meta" style={{fontSize: '1.45rem'}}>
            {question && <SpecialRoundBadge type={question.special_round_type} />}
            {submittedCount !== null && playerCount !== null ? (
              <span className={`ds-stat-pill${statPulse && !reducedMotion ? ' is-pulsing' : ''}`}>
                ตอบแล้ว {submittedCount} / {playerCount}
              </span>
            ) : null}
          </div>
        </div>

        <div className="ds-q-body">
          <div className="ds-stage-card ds-stage-card-soft ds-q-left">
            {questionFetchError && !question ? (
              <div className="ds-muted">ไม่สามารถโหลดคำถามได้</div>
            ) : (
              <div className="ds-q-text">{question?.text ?? 'กำลังโหลด...'}</div>
            )}
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
          </div>

          <div className="ds-stage-card ds-stage-card-visual ds-q-right">
            <DisplayImageStage imageUrl={imgUrl} variant="question" />
          </div>
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
      <div className="ds-locked-stage">
        <div className="ds-closed-icon" style={{fontSize: '2.5rem'}}>🔒</div>
        <div className="ds-huge-text">หมดเวลา!</div>
      </div>
      {submittedCount !== null && playerCount !== null && (
        <div className="ds-stat-line" style={{fontSize:'2rem'}}>
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
  statsFetchError,
}: {
  gameState: GameState;
  question: DisplayQuestion | null;
  stats: DisplayStatsResponse | null;
  totalQs: number;
  getServerTime: () => number;
  statsFetchError: boolean;
}) {
  const [showReveal, setShowReveal] = useState(false);
  const [revealImageReady, setRevealImageReady] = useState(false);

  const baseImg = question ? resolveQuestionImageUrl(question.image_url) : null;
  const revealImg = question ? (resolveRevealImageUrl(question.reveal_image_url) ?? baseImg) : null;
  const maskUrl = question
    ? `${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(question.id)}&updatedAt=${encodeURIComponent(gameState.updated_at ?? '')}`
    : null;

  usePreloadImages(maskUrl, revealImg);

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

  useEffect(() => {
    if (!revealImg || revealImg === baseImg) {
      setRevealImageReady(true);
      return;
    }

    setRevealImageReady(false);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setRevealImageReady(true);
    };
    img.onerror = () => {
      if (!cancelled) setRevealImageReady(true);
    };
    img.src = revealImg;

    return () => {
      cancelled = true;
    };
  }, [baseImg, revealImg]);

  if (!question) {
    return (
      <DsShell centered>
        <div className="ds-muted">กำลังโหลด...</div>
      </DsShell>
    );
  }

  const submittedCount = stats?.submitted_count ?? 0;
  const correctCount = stats?.correct_count ?? 0;
  const accuracy = stats?.accuracy ?? 0;

  return (
    <DsShell>
      <div className="ds-reveal-header">
        <QPos question={question} totalQs={totalQs} small />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {question && <SpecialRoundBadge type={question.special_round_type} />}
          <div className="ds-label ds-gold" >เฉลย</div>
        </div>
      </div>

      <div className="ds-reveal-layout">
        <div className="ds-stage-card ds-stage-card-soft ds-reveal-left">
          <div className="ds-reveal-text" style={{fontSize:'2rem'}}>{question.text}</div>

          {showReveal && submittedCount > 0 && (
            <div className="ds-reveal-stats">
              <div className="ds-reveal-stat-item">
                <span className="ds-label">ตอบถูก</span>
                <span className="ds-reveal-stat-val ds-gold">{correctCount} / {submittedCount}</span>
              </div>
              <div className="ds-reveal-stat-sep" />
              <div className="ds-reveal-stat-item">
                <span className="ds-label">สัดส่วนคนเก่ง</span>
                <span className="ds-reveal-stat-val">{accuracy.toFixed(1)}%</span>
              </div>
            </div>
          )}

          {!showReveal && (
            <div className="ds-muted">...กำลังประมวลผล...</div>
          )}
          {showReveal && submittedCount === 0 && !statsFetchError && (
            <div className="ds-muted">ไม่มีผู้ที่ตอบในข้อนี้</div>
          )}
        </div>

        <div className="ds-stage-card ds-stage-card-visual ds-reveal-right">
          <DisplayImageStage
            imageUrl={baseImg}
            maskUrl={maskUrl ?? undefined}
            revealImageUrl={revealImg ?? baseImg}
            showReveal={showReveal}
            revealReady={revealImageReady}
            fullWidth
            variant="reveal"
          />
        </div>
      </div>
    </DsShell>
  );
}

// ── 6 + 7. LEADERBOARD / FINAL ────────────────────────────────────────────────

function DsLeaderboard({
  leaderboard, leaderboardFx, animationStage, leaderChange, question, totalQs, isFinal, reducedMotion,
}: {
  leaderboard: LeaderboardEntry[];
  leaderboardFx: Record<string, LeaderboardFxMeta>;
  animationStage: LeaderboardAnimationStage;
  leaderChange: LeaderChangeState | null;
  question: DisplayQuestion | null;
  totalQs: number;
  isFinal: boolean;
  reducedMotion: boolean;
}) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const rowTopsRef = useRef(new Map<string, number>());
  const winner = leaderboard[0];
  const top = leaderboard.slice(0, 10);
  const MEDALS = ['🥇', '🥈', '🥉'];
  const podiumSlots = [1, 0, 2].filter((i) => top[i]);

  // Biggest climber: highest positive rankDelta ≥ 2
  const climber = top.reduce<LeaderboardEntry | null>((best, entry) => {
    const delta = leaderboardFx[entry.player_id]?.rankDelta ?? 0;
    if (delta < 2) return best;
    const bestDelta = best ? (leaderboardFx[best.player_id]?.rankDelta ?? 0) : 0;
    return delta > bestDelta ? entry : best;
  }, null);

  // Comeback: was outside top 3, now inside top 3
  const comeback = top.find((entry) => {
    const meta = leaderboardFx[entry.player_id];
    return meta && (meta.previousRank ?? 0) > 3 && entry.rank <= 3;
  }) ?? null;
  const podiumMaxScore = podiumSlots.length > 0
    ? Math.max(...podiumSlots.map((i) => top[i].cumulative_score))
    : 0;
  const podiumMinScore = podiumSlots.length > 0
    ? Math.min(...podiumSlots.map((i) => top[i].cumulative_score))
    : 0;

  const podiumBarHeight = useCallback((score: number) => {
    if (podiumMaxScore <= 0) return 112;
    if (podiumMaxScore === podiumMinScore) return 120;
    const normalized = (score - podiumMinScore) / (podiumMaxScore - podiumMinScore);
    return Math.round(86 + normalized * 64);
  }, [podiumMaxScore, podiumMinScore]);

  useLayoutEffect(() => {
    const nextTops = new Map<string, number>();
    const cleanupTimers: number[] = [];

    rowRefs.current.forEach((node, playerId) => {
      const topPos = node.getBoundingClientRect().top;
      nextTops.set(playerId, topPos);

      if (reducedMotion) {
        node.style.transform = '';
        node.style.transition = '';
        return;
      }

      const previousTop = rowTopsRef.current.get(playerId);
      if (previousTop == null) return;

      const delta = previousTop - topPos;
      if (Math.abs(delta) < 1) return;

      node.style.transition = 'none';
      node.style.transform = `translateY(${delta}px)`;
      node.getBoundingClientRect();

      const rafId = window.requestAnimationFrame(() => {
        node.style.transition = `transform ${LEADERBOARD_REORDER_MOVE_MS}ms cubic-bezier(.22,1,.36,1)`;
        node.style.transform = 'translateY(0)';
      });
      cleanupTimers.push(rafId);
    });

    rowTopsRef.current = nextTops;

    return () => {
      cleanupTimers.forEach((id) => window.cancelAnimationFrame(id));
    };
  }, [leaderboard, reducedMotion]);

  const visualRankFor = useCallback((entry: LeaderboardEntry) => {
    if (animationStage === 'counting') {
      return leaderboardFx[entry.player_id]?.previousRank ?? entry.rank;
    }
    return entry.rank;
  }, [animationStage, leaderboardFx]);

  return (
    <DsShell>
      <div className="ds-lb-header">
        {isFinal ? (
          <>
            <div className="ds-label ds-gold" style={{ letterSpacing: '.2em' }}>Final Leaderboard</div>
            <div className="ds-title" style={{ fontSize: 36 }}>จบเกม! 🏆</div>
            {winner && (
              <div className={`ds-stage-card ds-winner-card${leaderChange?.playerId === winner.player_id ? ' ds-winner-card-leader' : ''}`}>
                <div className="ds-label ds-gold">Champion</div>
                <div className="ds-winner-crown">👑</div>
                <div className="ds-winner-name">{winner.display_name}</div>
                <div className="ds-winner-line">
                  <span className="ds-mono ds-gold">
                    <AnimatedScore
                      value={winner.cumulative_score}
                      from={leaderboardFx[winner.player_id]?.previousScore ?? winner.cumulative_score}
                      durationMs={LEADERBOARD_SCORE_ANIMATION_MS}
                      reducedMotion={reducedMotion}
                    /> คะแนน
                  </span>
                </div>
                {!reducedMotion && (
                  <>
                    <div className="ds-final-burst" aria-hidden>
                      {Array.from({ length: 12 }, (_, i) => (
                        <span key={i} className="ds-final-burst-particle" style={{ '--ds-angle': `${i * 30}deg` } as CSSProperties} />
                      ))}
                    </div>
                    <ConfettiBurst active mode="gold" count={28} />
                  </>
                )}
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
            {leaderChange && (
              <div className="ds-new-leader-banner">New Leader · {leaderChange.displayName}</div>
            )}
            {!leaderChange && climber && !reducedMotion && (
              <div className="ds-climber-banner">
                🚀 {climber.display_name} ขยับขึ้น +{leaderboardFx[climber.player_id]?.rankDelta} อันดับ!
              </div>
            )}
            {!leaderChange && comeback && !reducedMotion && (
              <div className="ds-comeback-banner">
                ⚡ Comeback! {comeback.display_name} ติด Top 3!
              </div>
            )}
          </>
        )}
      </div>

      {isFinal && top.length > 0 && (
        <div className="ds-podium">
          {podiumSlots.map((i) => (
            <div
              key={top[i].player_id}
              className={`ds-podium-slot${i === 0 ? ' ds-podium-slot-leader' : ''}`}
              style={{
                order: i === 0 ? 1 : i === 1 ? 0 : 2,
                animationDelay: i === 0 ? '1.8s' : i === 1 ? '1.0s' : '.2s',
              }}
            >
              <div className="ds-pod-medal">{MEDALS[i]}</div>
              {i === 0 && <div className="ds-pod-crown">👑</div>}
              <div className="ds-pod-av" style={{ background: avGrad(i) }}>{initials(top[i].display_name)}</div>
              <div className="ds-pod-name">{top[i].display_name}</div>
              <div
                className={`ds-pod-bar ds-pod-bar-${top[i].rank - 1}`}
                style={{ height: `${podiumBarHeight(top[i].cumulative_score)}px` }}
              >
                <span className="ds-mono ds-pod-score">
                  <AnimatedScore
                    value={top[i].cumulative_score}
                    from={leaderboardFx[top[i].player_id]?.previousScore ?? top[i].cumulative_score}
                    durationMs={LEADERBOARD_SCORE_ANIMATION_MS}
                    reducedMotion={reducedMotion}
                  />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ds-stage-card ds-stage-card-soft ds-lb-list">
        {(isFinal ? top.slice(3) : top).map((entry, idx) => (
          <div
            key={entry.player_id}
            ref={(node) => {
              if (node) rowRefs.current.set(entry.player_id, node);
              else rowRefs.current.delete(entry.player_id);
            }}
            className={[
              'ds-lb-row',
              visualRankFor(entry) === 1 ? 'ds-lb-row-gold' : '',
              entry.rank === 1 ? 'ds-lb-row-top1' : entry.rank === 2 ? 'ds-lb-row-top2' : entry.rank === 3 ? 'ds-lb-row-top3' : '',
              leaderboardFx[entry.player_id]?.rankDelta && leaderboardFx[entry.player_id].rankDelta! > 0 ? 'ds-lb-row-up' : '',
              leaderboardFx[entry.player_id]?.rankDelta && leaderboardFx[entry.player_id].rankDelta! < 0 ? 'ds-lb-row-down' : '',
              leaderboardFx[entry.player_id]?.isNew ? 'ds-lb-row-new' : '',
              leaderChange?.playerId === entry.player_id ? 'ds-lb-row-leader-change' : '',
              animationStage === 'reordering' ? 'ds-lb-row-reordering' : '',
            ].filter(Boolean).join(' ')}
            style={{ animationDelay: `${Math.min(idx * 45, 320)}ms` }}
          >
            <span className="ds-lb-rank ds-mono" style={{ fontSize: '2rem' }}>#{visualRankFor(entry)}</span>
            <div className="ds-lb-av" style={{ background: avGrad(visualRankFor(entry) - 1) }}>{initials(entry.display_name)}</div>
            <div className="ds-lb-name-wrap">
              <span className="ds-lb-name">
                {visualRankFor(entry) === 1 ? '👑 ' : visualRankFor(entry) <= 3 ? `${MEDALS[visualRankFor(entry) - 1]} ` : ''}{entry.display_name}
              </span>
              <div className="ds-lb-meta-line">
                <RankDeltaBadge meta={leaderboardFx[entry.player_id]} />
                {leaderboardFx[entry.player_id]?.scoreDelta > 0 && (
                  <span className="ds-score-delta">+{leaderboardFx[entry.player_id].scoreDelta}</span>
                )}
              </div>
            </div>
            <span className="ds-lb-score ds-mono">
              <AnimatedScore
                value={entry.cumulative_score}
                from={leaderboardFx[entry.player_id]?.previousScore ?? entry.cumulative_score}
                durationMs={LEADERBOARD_SCORE_ANIMATION_MS}
                reducedMotion={reducedMotion}
              />
            </span>
          </div>
        ))}
        {top.length === 0 && (
          <div className="ds-muted" style={{ textAlign: 'center', padding: '40px 0' }}>กำลังโหลด...</div>
        )}
      </div>
    </DsShell>
  );
}
