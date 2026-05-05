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
 * - All image/mask layers use object-fit:contain to preserve coordinate alignment.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, GAME_STATE_ID, FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../lib/supabase';
import { resolveQuestionImageUrl, resolveRevealImageUrl } from '../lib/questionAssets';
import { COUNTDOWN_DISPLAY_SECONDS, SERVER_TIME_RESYNC_INTERVAL_MS } from '../lib/constants';
import type { GameState, Player, LeaderboardEntry, DisplayStatsResponse } from '../lib/types';
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
}

// P0.1 — per-channel realtime status
type ChannelStatus = 'idle' | 'connecting' | 'subscribed' | 'error' | 'timeout';
interface RealtimeStatus {
  game: ChannelStatus;
  players: ChannelStatus;
  answers: ChannelStatus;
  leaderboard: ChannelStatus;
}

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
  fullWidth = false,
  variant = 'question',
}: {
  imageUrl: string | null;
  maskUrl?: string | null;
  revealImageUrl?: string | null;
  showReveal?: boolean;
  fullWidth?: boolean;
  variant?: 'clue' | 'question' | 'reveal';
}) {
  const shellVariant =
    variant === 'clue' ? 'quiz-image-shell--display-clue' :
    variant === 'reveal' ? 'quiz-image-shell--display-reveal' :
    'quiz-image-shell--display-question';

  const displayImageUrl = showReveal ? (revealImageUrl ?? imageUrl) : imageUrl;
  const shellClassName = `ds-display-shell ${shellVariant}${fullWidth ? ' ds-display-shell-full' : ''}`;

  return (
    <div className="ds-display-image-wrap">
      <QuestionImage
        imageUrl={displayImageUrl}
        circleRadiusRatio={0}
        circle={null}
        onCircleChange={() => {}}
        locked
        maskOverlayUrl={!showReveal ? (maskUrl ?? undefined) : undefined}
        maskOverlayClassName={!showReveal ? 'reveal-mask-pulse ds-display-mask' : undefined}
        shellClassName={shellClassName}
      />
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

  // P0.4 — throttle repeated error logs
  const lastPlayersErrLogRef = useRef(0);
  const lastStatsErrLogRef = useRef(0);
  const lastGameStateErrLogRef = useRef(0);

  const getServerTime = useDisplayServerTime();
  const prevQuestionKeyRef = useRef<string | null>(null);

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      newPlayerTimeoutsRef.current.forEach((t) => clearTimeout(t));
      if (latestJoinedTimerRef.current) clearTimeout(latestJoinedTimerRef.current);
    };
  }, []);

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
        };

        if (gsqId) {
          const { data: gsqData } = await supabase
            .from('game_set_questions')
            .select('play_order, time_limit_seconds, max_score, min_correct_score, circle_radius_ratio')
            .eq('id', gsqId)
            .single();
          if (gsqData) {
            dq = { ...dq, play_order: gsqData.play_order, time_limit_seconds: gsqData.time_limit_seconds,
              max_score: gsqData.max_score, min_correct_score: gsqData.min_correct_score,
              circle_radius_ratio: gsqData.circle_radius_ratio };
          }
        }

        setQuestion(dq);
        setQuestionFetchError(false);
      } catch (err) {
        console.error('[DisplayPage] question fetch failed:', err);
        setQuestionFetchError(true);
      }
    };

    void fetch_();
  }, [authReady, gameState?.current_question_id, gameState?.current_game_set_question_id]);

  // ── P0.6 — Preload question images when question becomes known ───────────────
  const preloadImageUrl = question ? resolveQuestionImageUrl(question.image_url) : null;
  const preloadRevealUrl = question ? resolveRevealImageUrl(question.reveal_image_url) : null;
  usePreloadImages(preloadImageUrl, preloadRevealUrl);

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
        setLeaderboard((data ?? []) as LeaderboardEntry[]);
      } catch (err) {
        console.error('[DisplayPage] leaderboard fetch failed:', err);
      }
    };

    void fetchLb();
    const retryTimer = setTimeout(() => void fetchLb(), 400);

    const ch = supabase.channel('display-leaderboard')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'leaderboard_snapshot',
        filter: `question_id=eq.${qId}`,
      }, () => void fetchLb())
      .subscribe((s) => {
        const cs = toChannelStatus(s);
        logDisplayRt('display-leaderboard', s);
        setRealtimeStatus((prev) => ({ ...prev, leaderboard: cs }));
      });

    return () => {
      clearTimeout(retryTimer);
      supabase.removeChannel(ch);
      setRealtimeStatus((prev) => ({ ...prev, leaderboard: 'idle' }));
    };
  }, [gameState?.status, gameState?.current_question_id]);

  // ── Route to phase component ────────────────────────────────────────────────
  const status = gameState?.status ?? 'waiting';
  const totalQs = stats?.total_questions ?? 0;

  if (!gameState || status === 'waiting') {
    return (
      <DsLobby
        players={players}
        newPlayerIds={newPlayerIds}
        latestJoined={latestJoined}
        realtimeStatus={realtimeStatus}
        playersFetchError={playersFetchError}
        gameStateFetchError={gameStateFetchError}
        statsFetchError={statsFetchError}
      />
    );
  }
  if (status === 'countdown') {
    return (
      <DsCountdown
        gameState={gameState}
        question={question}
        totalQs={totalQs}
        getServerTime={getServerTime}
        questionFetchError={questionFetchError}
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
        questionFetchError={questionFetchError}
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
        statsFetchError={statsFetchError}
      />
    );
  }
  if (status === 'leaderboard') {
    return <DsLeaderboard leaderboard={leaderboard} question={question} totalQs={totalQs} isFinal={false} />;
  }
  if (status === 'ended') {
    return <DsLeaderboard leaderboard={leaderboard} question={question} totalQs={totalQs} isFinal />;
  }
  return (
    <DsLobby
      players={players}
      newPlayerIds={newPlayerIds}
      latestJoined={latestJoined}
      realtimeStatus={realtimeStatus}
      playersFetchError={playersFetchError}
      gameStateFetchError={gameStateFetchError}
      statsFetchError={statsFetchError}
    />
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
    ? <div className="ds-q-pos-sm">{pos}</div>
    : <div className="ds-q-pos">{pos}</div>;
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
}: {
  players: Player[];
  newPlayerIds: Set<string>;
  latestJoined: Player | null;
  realtimeStatus: RealtimeStatus;
  playersFetchError: boolean;
  gameStateFetchError: boolean;
  statsFetchError: boolean;
}) {
  const joinUrl = window.location.origin + (import.meta.env.BASE_URL || '/');
  const visible = players.slice(0, MAX_VISIBLE_PLAYERS);
  const overflow = players.length - MAX_VISIBLE_PLAYERS;
  const badge = deriveConnBadge(realtimeStatus, playersFetchError, gameStateFetchError, statsFetchError);

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
          <div className="ds-label ds-gold" style={{ marginBottom: 12, textAlign: 'center' }}>Join The Game</div>
          <QRCode url={joinUrl} />
          <div className="ds-join-url">{joinUrl}</div>
          <div className="ds-lobby-steps">
            <div className="ds-lobby-step"><span>1</span>สแกน QR หรือเปิดลิงก์</div>
            <div className="ds-lobby-step"><span>2</span>กรอกชื่อเล่นของคุณ</div>
            <div className="ds-lobby-step"><span>3</span>รอพิธีกรเริ่มเกม</div>
          </div>
          <div className="ds-player-count ds-stage-inset">
            <div className="ds-lobby-player-count-hero">{players.length}</div>
            <div className="ds-lobby-player-count-label">ผู้เล่น</div>
          </div>
        </div>

        <div className="ds-stage-card ds-stage-card-soft ds-lobby-right">
          <div className="ds-lobby-wall-header">
            <div className="ds-label">{latestJoined ? 'ผู้เล่นใหม่กำลังเข้าห้อง' : 'ผู้เล่นในห้อง'}</div>
            <div className="ds-stage-pill">{players.length} joined</div>
          </div>

          {latestJoined && (
            <div className="ds-latest-joined">
              🎉 {truncate(latestJoined.display_name, 24)} เข้าร่วมแล้ว!
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
  gameState, question, totalQs, getServerTime, questionFetchError,
}: {
  gameState: GameState;
  question: DisplayQuestion | null;
  totalQs: number;
  getServerTime: () => number;
  questionFetchError: boolean;
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
          <div className="ds-stage-caption">ภาพปริศนาจะขึ้นทันทีเมื่อ countdown จบ</div>
        </div>
      ) : (
        <div className="ds-stage-card ds-stage-card-clue ds-clue-wrap">
          <div className="ds-label ds-gold" style={{ marginBottom: 16, letterSpacing: '.2em' }}>ภาพปริศนา</div>
          {questionFetchError && !clueUrl ? (
            <div className="ds-muted">ไม่สามารถโหลดภาพคำถามได้</div>
          ) : (
            <DisplayImageStage imageUrl={clueUrl} variant="clue" />
          )}
          <div className="ds-muted" style={{ marginTop: 16 }}>ดูภาพให้ดีก่อนตอบ</div>
        </div>
      )}
    </DsShell>
  );
}

// ── 3. QUESTION OPEN ──────────────────────────────────────────────────────────

function DsQuestion({
  gameState, question, stats, totalQs, getServerTime, questionFetchError,
}: {
  gameState: GameState;
  question: DisplayQuestion | null;
  stats: DisplayStatsResponse | null;
  totalQs: number;
  getServerTime: () => number;
  questionFetchError: boolean;
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
      <div className="ds-q-bar">
        <QPos question={question} totalQs={totalQs} small />
        <div className="ds-q-meta">
          {submittedCount !== null && playerCount !== null ? (
            <span className="ds-stat-pill">ตอบแล้ว {submittedCount} / {playerCount}</span>
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
          <div className="ds-q-progress-meta">
            <div className="ds-stage-kicker">Live Question</div>
            {submittedCount !== null && playerCount !== null ? (
              <div className="ds-stage-pill">{submittedCount} / {playerCount} answered</div>
            ) : null}
          </div>
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

        <div className="ds-stage-card ds-stage-card-visual ds-q-right">
          <DisplayImageStage imageUrl={imgUrl} variant="question" />
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
  // P0.6 — preload mask early so it's cached before the reveal moment
  usePreloadImages(maskUrl);

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
        <div className="ds-stage-card ds-stage-card-soft ds-reveal-left">
          <div className="ds-reveal-text">{question.text}</div>

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
            <div className="ds-muted">กำลังส่องวงเฉลย...</div>
          )}
          {showReveal && submittedCount === 0 && !statsFetchError && (
            <div className="ds-muted">ยังไม่มีคำตอบในข้อนี้</div>
          )}
        </div>

        <div className="ds-stage-card ds-stage-card-visual ds-reveal-right">
          <DisplayImageStage
            imageUrl={baseImg}
            maskUrl={maskUrl}
            revealImageUrl={revealImg ?? baseImg}
            showReveal={showReveal}
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
  const podiumSlots = [1, 0, 2].filter((i) => top[i]);

  return (
    <DsShell>
      <div className="ds-lb-header">
        {isFinal ? (
          <>
            <div className="ds-label ds-gold" style={{ letterSpacing: '.2em' }}>Final Leaderboard</div>
            <div className="ds-title" style={{ fontSize: 36 }}>จบเกม! 🏆</div>
            {winner && (
              <div className="ds-stage-card ds-winner-card">
                <div className="ds-label ds-gold">Champion</div>
                <div className="ds-winner-name">{winner.display_name}</div>
                <div className="ds-winner-line">
                  <span className="ds-mono ds-gold">{winner.cumulative_score.toLocaleString()} คะแนน</span>
                </div>
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

      <div className="ds-stage-card ds-stage-card-soft ds-lb-list">
        {(isFinal ? top.slice(3) : top).map((entry, idx) => (
          <div
            key={entry.player_id}
            className={`ds-lb-row${entry.rank === 1 ? ' ds-lb-row-gold' : ''}`}
            style={{ animationDelay: `${Math.min(idx * 45, 320)}ms` }}
          >
            <span className="ds-lb-rank ds-mono">#{entry.rank}</span>
            <div className="ds-lb-av" style={{ background: avGrad(entry.rank - 1) }}>{initials(entry.display_name)}</div>
            <span className="ds-lb-name">{entry.display_name}</span>
            <span className="ds-lb-score ds-mono">{entry.cumulative_score.toLocaleString()}</span>
          </div>
        ))}
        {top.length === 0 && (
          <div className="ds-muted" style={{ textAlign: 'center', padding: '40px 0' }}>กำลังโหลด...</div>
        )}
      </div>
    </DsShell>
  );
}
