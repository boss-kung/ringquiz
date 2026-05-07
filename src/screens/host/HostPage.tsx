import { useState, useEffect, useCallback, useRef } from 'react';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../../lib/supabase';
import { STATS_POLL_INTERVAL_MS } from '../../lib/constants';
import { useGameStore } from '../../store/gameStore';
import { useGetServerTime } from '../../hooks/useServerTime';
import { AdminQuestionManager } from './AdminQuestionManager';
import { GameSetManager } from './GameSetManager';
import type {
  HostActionName,
  HostActionResponse,
  QuestionStatsResponse,
  EdgeFunctionError,
  DisplayTheme,
} from '../../lib/types';

const SESSION_KEY = 'quiz_host_secret';

const PRIMARY_ACTIONS: { action: HostActionName; label: string }[] = [
  { action: 'start_countdown',   label: 'Start Game' },
  { action: 'open_question',     label: 'Open Question' },
  { action: 'close_question',    label: 'Close Question' },
  { action: 'show_reveal',       label: 'Show Reveal' },
  { action: 'show_leaderboard',  label: 'Show Leaderboard' },
  { action: 'next_question',     label: 'Next Question →' },
  { action: 'end_game',          label: 'End Game' },
];

const UTILITY_ACTIONS: { action: HostActionName; label: string; danger?: boolean }[] = [
  { action: 'force_close_question', label: 'Force Close Question' },
  { action: 'recompute_leaderboard', label: 'Recompute Leaderboard' },
  { action: 'soft_reset_game',      label: 'Soft Reset Round',  danger: true },
  { action: 'hard_reset_game',      label: 'Hard Reset Game',   danger: true },
];

const HOST_ACTION_FALLBACKS: Partial<Record<HostActionName, string[]>> = {
  trigger_hype_cheer: ['hype_cheer'],
  trigger_spotlight_leaderboard: ['spotlight_leaderboard'],
  trigger_final_drumroll: ['final_drumroll'],
  set_display_theme: ['display_theme', 'set_theme'],
};

export function HostPage() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem(SESSION_KEY) ?? '');

  if (!secret) {
    return <HostLogin onLogin={(s) => { setSecret(s); }} />;
  }

  return (
    <HostDashboard
      secret={secret}
      onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setSecret(''); }}
    />
  );
}

// ── Login ──────────────────────────────────────────────────────────────────────

function HostLogin({ onLogin }: { onLogin: (s: string) => void }) {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [localError, setLocalError] = useState('');
  const inputId = 'host-secret-input';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setChecking(true);
    setLocalError('');

    try {
      const res = await fetch(`${FUNCTIONS_URL}/get-question-stats`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'X-Host-Secret': value.trim() },
      });
      if (res.ok) {
        sessionStorage.setItem(SESSION_KEY, value.trim());
        onLogin(value.trim());
        return;
      }
      let errCode = '';
      try { errCode = (await res.json()).error ?? ''; } catch { /* ignore */ }
      if (res.status === 401) {
        setLocalError('Wrong secret. Try again.');
      } else if (errCode === 'server_missing_host_secret') {
        setLocalError('Server is not configured: HOST_SECRET is missing. Contact the server admin.');
      } else {
        setLocalError(`Login failed (HTTP ${res.status}). Try again or check server logs.`);
      }
    } catch {
      setLocalError('Network error. Check connection.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        minHeight: '100%',
        background: 'var(--navy-deep)',
        padding: '24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div className="gr-label-sm gr-gold" style={{ marginBottom: 8, letterSpacing: '.18em' }}>Control Center</div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: 'var(--text)' }}>Host Panel</h1>
          <p style={{ marginTop: 6, fontSize: 13, color: 'var(--text-2)' }}>Enter your HOST_SECRET to continue</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label htmlFor={inputId} className="gr-label-xs" style={{ color: 'var(--text-2)' }}>
            HOST_SECRET
          </label>
          <input
            id={inputId}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="HOST_SECRET"
            autoFocus
            className="gr-input"
          />
          {localError && (
            <p style={{ color: 'var(--rose)', fontSize: 13, textAlign: 'center' }}>{localError}</p>
          )}
          <button
            type="submit"
            disabled={!value.trim() || checking}
            className="gr-btn gr-btn-gold"
          >
            {checking ? 'Verifying…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

function HostDashboard({ secret, onLogout }: { secret: string; onLogout: () => void }) {
  const gameState = useGameStore((s) => s.gameState);
  const question = useGameStore((s) => s.question);
  const getServerTime = useGetServerTime();
  const [activeTab, setActiveTab] = useState<'game' | 'questions' | 'setup'>('game');
  const [stats, setStats] = useState<QuestionStatsResponse | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<HostActionName | null>(null);
  const [fxLoading, setFxLoading] = useState<HostActionName | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [statsError, setStatsError] = useState('');
  const [resetConfirm, setResetConfirm] = useState<'soft_reset_game' | 'hard_reset_game' | null>(null);
  const resetInput = useRef('');
  const resetInputRef = useRef<HTMLInputElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const postHostAction = useCallback(async (action: string, payload?: Record<string, unknown>) => {
    const body = { action, ...(payload ? { payload } : {}) };
    const res = await fetch(`${FUNCTIONS_URL}/host-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'X-Host-Secret': secret },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { res, json };
  }, [secret]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${FUNCTIONS_URL}/get-question-stats`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'X-Host-Secret': secret },
      });
      if (!res.ok) {
        let errCode = '';
        try { errCode = (await res.json()).error ?? ''; } catch { /* ignore */ }
        setStatsError(errCode || `stats_http_${res.status}`);
        setStats((current) => current ? { ...current, question_ends_at: null } : current);
        return;
      }
      setStats(await res.json());
      setStatsError('');
    } catch {
      setStatsError('network_error');
      setStats((current) => current ? { ...current, question_ends_at: null } : current);
    }
  }, [secret]);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, STATS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  useEffect(() => {
    if (activeTab === 'game') {
      void fetchStats();
    }
  }, [activeTab, fetchStats]);

  useEffect(() => {
    if (!resetConfirm) return;

    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = resetInputRef.current ?? cancelButtonRef.current ?? confirmButtonRef.current;
    focusTarget?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!resetConfirm) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setResetConfirm(null);
        resetInput.current = '';
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = [
        resetInputRef.current as HTMLElement | null,
        cancelButtonRef.current as HTMLElement | null,
        confirmButtonRef.current as HTMLElement | null,
      ].filter((node): node is HTMLElement => node !== null);

      if (focusable.length === 0) return;

      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const lastIndex = focusable.length - 1;

      if (event.shiftKey) {
        if (currentIndex <= 0) {
          event.preventDefault();
          const target = focusable[lastIndex];
          if (target) target.focus();
        }
        return;
      }

      if (currentIndex === -1 || currentIndex === lastIndex) {
        event.preventDefault();
        const target = focusable[0];
        if (target) target.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      lastFocusedRef.current?.focus();
    };
  }, [resetConfirm]);

  useEffect(() => {
    const endsAt = stats?.question_ends_at;
    if (!endsAt) { setTimeLeft(null); return; }
    const endMs = new Date(endsAt).getTime();
    const tick = () => setTimeLeft(Math.max(0, Math.ceil((endMs - getServerTime()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [stats?.question_ends_at, getServerTime]);

  const callAction = useCallback(async (action: HostActionName) => {
    if (action === 'soft_reset_game' || action === 'hard_reset_game') {
      setResetConfirm(action);
      return;
    }
    await doAction(action);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doAction = async (action: HostActionName, payload?: Record<string, unknown>) => {
    setActionLoading(action);
    setActionError('');
    setActionSuccess('');
    try {
      const { res, json } = await postHostAction(action, payload);
      if (!res.ok) {
        setActionError((json as EdgeFunctionError).error ?? 'Unknown error');
      } else {
        const r = json as HostActionResponse;
        setActionSuccess(`${action} → ${r.status}${r.already_in_state ? ' (already)' : ''}`);
        fetchStats();
      }
    } catch {
      setActionError('Network error');
    } finally {
      setActionLoading(null);
    }
  };

  const doFxAction = async (action: HostActionName, payload?: Record<string, unknown>) => {
    setFxLoading(action);
    setActionError('');
    setActionSuccess('');
    try {
      let { res, json } = await postHostAction(action, payload);

      if (!res.ok && (json as EdgeFunctionError).error === 'unknown_action') {
        for (const fallback of HOST_ACTION_FALLBACKS[action] ?? []) {
          const fallbackResult = await postHostAction(fallback, payload);
          res = fallbackResult.res;
          json = fallbackResult.json;
          if (res.ok || (json as EdgeFunctionError).error !== 'unknown_action') {
            break;
          }
        }
      }

      if (!res.ok) {
        const err = json as EdgeFunctionError;
        setActionError(
          err.error === 'unknown_action'
            ? 'Stage FX/Theme is not supported by the deployed host-action function yet.'
            : err.error ?? 'Unknown error',
        );
      } else {
        setActionSuccess(`✓ ${action} sent`);
      }
    } catch {
      setActionError('Network error');
    } finally {
      setFxLoading(null);
    }
  };

  const handleResetConfirm = async () => {
    if (resetInput.current !== 'RESET' || !resetConfirm) return;
    const action = resetConfirm;
    setResetConfirm(null);
    resetInput.current = '';
    await doAction(action);
  };

  const status = gameState?.status ?? 'loading…';
  const questionProgress = stats?.question_index != null
    ? `Q${stats.question_index}/${stats.total_questions || '—'}`
    : null;
  const submittedRatio = stats?.player_count
    ? Math.min(1, (stats?.submitted_count ?? 0) / stats.player_count)
    : 0;
  const statsStale = Boolean(statsError);

  const isActionEnabled = useCallback((action: HostActionName) => {
    switch (action) {
      case 'start_countdown':       return status === 'waiting' && (stats?.total_questions ?? 0) > 0;
      case 'open_question':         return status === 'countdown';
      case 'close_question':        return status === 'question_open' || status === 'question_closed';
      case 'show_reveal':           return status === 'question_closed' || status === 'reveal';
      case 'show_leaderboard':      return status === 'reveal' || status === 'leaderboard';
      case 'next_question':         return status === 'leaderboard';
      case 'end_game':              return status !== 'waiting' && status !== 'ended';
      case 'force_close_question':  return status === 'question_open' || status === 'question_closed';
      case 'recompute_leaderboard': return status === 'question_closed' || status === 'reveal' || status === 'leaderboard';
      case 'soft_reset_game':
      case 'hard_reset_game':       return true;
      default:                      return false;
    }
  }, [status, stats?.total_questions]);

  const nextRecommendedAction = PRIMARY_ACTIONS.find(({ action }) => isActionEnabled(action))?.label ?? 'Waiting for next valid step';

  const statusColor =
    status === 'question_open' ? 'var(--emerald)' :
    status === 'countdown'     ? 'var(--indigo)' :
    status === 'ended'         ? 'var(--gold)' :
    'var(--text-2)';

  return (
    <div style={{ minHeight: '100%', background: 'var(--navy-deep)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(5,8,16,.95)',
          backdropFilter: 'blur(12px)',
          padding: '12px 18px',
        }}
      >
        <div>
          <div className="gr-label-xs" style={{ marginBottom: 3 }}>Control Center</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Host Panel</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="gr-badge gr-badge-live">LIVE</div>
          <button
            onClick={onLogout}
            style={{ fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex', gap: 6,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {([
          ['game',      'Game Flow'],
          ['questions', 'Question Bank'],
          ['setup',     'Game Setup'],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '7px 14px',
              borderRadius: 999,
              border: 'none',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all .15s',
              background: activeTab === tab ? 'rgba(255,255,255,.07)' : 'transparent',
              color: activeTab === tab ? 'var(--text)' : 'var(--text-3)',
              borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: '90%', margin: '0 auto', padding: '14px 16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {activeTab === 'game' ? (
          <>
            {/* State card */}
            <div className="gr-card-strong" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div>
                  <div className="gr-label-xs" style={{ marginBottom: 5 }}>Live Game State</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>{nextRecommendedAction}</div>
                </div>
                <div
                  className="gr-badge"
                  style={{
                    background: `${statusColor}18`,
                    border: `1px solid ${statusColor}38`,
                    color: statusColor,
                    flexShrink: 0,
                  }}
                >
                  {status}
                </div>
              </div>

              {/* Active game set */}
              {stats?.active_game_set_name && (
                <div style={{ marginBottom: 12, padding: '7px 10px', borderRadius: 9, background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.25)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--indigo)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Game Set</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{stats.active_game_set_name}</span>
                </div>
              )}

              {/* Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { l: 'Question', v: questionProgress ?? '—', c: 'var(--indigo)' },
                  { l: 'Players',  v: stats?.player_count ?? '—', c: 'var(--text)' },
                  { l: 'Answers',  v: statsStale ? 'stale' : stats ? `${stats.submitted_count}/${stats.player_count || 0}` : '—', c: statsStale ? 'var(--text-3)' : 'var(--emerald)' },
                  { l: 'Time Left', v: statsStale ? 'stale' : timeLeft !== null ? `${timeLeft}s` : '—', c: statsStale ? 'var(--text-3)' : timeLeft !== null && timeLeft <= 5 ? 'var(--rose)' : 'var(--text)' },
                ].map((m) => (
                  <div key={m.l} className="gr-metric">
                    <div className="gr-label-xs" style={{ marginBottom: 5 }}>{m.l}</div>
                    <div className="gr-mono" style={{ fontSize: 18, fontWeight: 800, color: m.c }}>{String(m.v)}</div>
                  </div>
                ))}
              </div>

              {/* Answer progress */}
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 11, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                  <span className="gr-label-xs">Answer Progress</span>
                  <span className="gr-mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--emerald)' }}>
                    {statsStale ? 'stale' : stats?.player_count ? `${Math.round(submittedRatio * 100)}%` : '—'}
                  </span>
                </div>
                <div className="gr-progress">
                  <div className="gr-progress-fill" style={{ width: `${statsStale ? 0 : submittedRatio * 100}%` }} />
                </div>
              </div>

              {/* Current prompt */}
              {question && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 11, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
                  <div className="gr-label-xs" style={{ marginBottom: 6 }}>Current Prompt</div>
                  <p style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.6, color: 'var(--text)' }}>{question.text}</p>
                </div>
              )}
            </div>

            {/* Feedback */}
            {actionError && (
              <div style={{ background: 'rgba(251,113,133,.1)', border: '1px solid rgba(251,113,133,.3)', borderRadius: 10, padding: '10px 14px', color: 'var(--rose)', fontSize: 13 }}>
                {actionError}
              </div>
            )}
            {statsError && (
              <div style={{ background: 'rgba(251,113,133,.1)', border: '1px solid rgba(251,113,133,.3)', borderRadius: 10, padding: '10px 14px', color: 'var(--rose)', fontSize: 13 }}>
                Stats may be stale: {statsError}
              </div>
            )}
            {actionSuccess && (
              <div style={{ background: 'rgba(52,211,153,.1)', border: '1px solid rgba(52,211,153,.3)', borderRadius: 10, padding: '10px 14px', color: 'var(--emerald)', fontSize: 13 }}>
                ✓ {actionSuccess}
              </div>
            )}

            {/* Primary actions */}
            <div>
              <div className="gr-label-xs" style={{ marginBottom: 8 }}>Game Flow</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                {PRIMARY_ACTIONS.map(({ action, label }) => (
                  <button
                    key={action}
                    onClick={() => callAction(action)}
                    disabled={actionLoading !== null || !isActionEnabled(action)}
                    className="gr-hbtn"
                    style={isActionEnabled(action) && actionLoading === null ? { borderColor: 'rgba(245,199,74,.2)', color: 'var(--gold)', background: 'rgba(245,199,74,.07)' } : undefined}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700 }}>
                      {actionLoading === action ? '…' : label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Utility actions */}
            <div>
              <div className="gr-label-xs" style={{ marginBottom: 8 }}>Emergency / Utilities</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                {UTILITY_ACTIONS.map(({ action, label, danger }) => (
                  <button
                    key={action}
                    onClick={() => callAction(action)}
                    disabled={actionLoading !== null || !isActionEnabled(action)}
                    className={`gr-hbtn ${danger ? 'gr-hbtn-danger' : ''}`}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700 }}>
                      {actionLoading === action ? '…' : label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Stage FX — visual-only, never affect game_state.status */}
            <div>
              <div className="gr-label-xs" style={{ marginBottom: 8 }}>Stage FX</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
                {([
                  { action: 'trigger_hype_cheer' as HostActionName,           label: 'ส่งเสียงเชียร์' },
                  { action: 'trigger_spotlight_leaderboard' as HostActionName, label: 'Spotlight LB' },
                  { action: 'trigger_final_drumroll' as HostActionName,        label: 'Final Drumroll' },
                ] as const).map(({ action, label }) => (
                  <button
                    key={action}
                    onClick={() => doFxAction(action)}
                    disabled={fxLoading !== null}
                    className="gr-hbtn"
                    style={{ borderColor: 'rgba(129,140,248,.25)', color: 'var(--indigo)' }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700 }}>
                      {fxLoading === action ? '…' : label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Stage Theme */}
            <div>
              <div className="gr-label-xs" style={{ marginBottom: 8 }}>Stage Theme</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                {([
                  { theme: 'classic_gold'  as DisplayTheme, label: 'Classic Gold' },
                  { theme: 'neon_night'    as DisplayTheme, label: 'Neon Night' },
                  { theme: 'danger_round'  as DisplayTheme, label: 'Danger Round' },
                  { theme: 'final_round'   as DisplayTheme, label: 'Final Round' },
                ]).map(({ theme, label }) => (
                  <button
                    key={theme}
                    onClick={() => doFxAction('set_display_theme', { theme })}
                    disabled={fxLoading !== null}
                    className={`gr-hbtn ds-theme-btn-${theme}`}
                    style={{ fontSize: 11 }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700 }}>
                      {fxLoading === 'set_display_theme' ? '…' : label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : activeTab === 'questions' ? (
          <AdminQuestionManager secret={secret} />
        ) : (
          <GameSetManager secret={secret} onStatsChanged={fetchStats} />
        )}
      </div>

      {/* Reset confirmation modal */}
      {resetConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-confirm-title"
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(5,8,16,.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24, zIndex: 300,
            backdropFilter: 'blur(6px)',
          }}
        >
          <div className="gr-card" style={{ width: '100%', maxWidth: 300, padding: 22 }}>
            <div id="reset-confirm-title" style={{ fontSize: 18, fontWeight: 800, color: 'var(--rose)', marginBottom: 10 }}>
              ⚠️ {resetConfirm === 'soft_reset_game' ? 'Soft Reset Round' : 'Hard Reset Game'}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.6 }}>
              {resetConfirm === 'soft_reset_game'
                ? 'This deletes answers, scores, and leaderboard data. Type RESET to confirm.'
                : 'This clears ALL players, answers, scores, and leaderboard data. Type RESET to confirm.'}
            </p>
            <label htmlFor="reset-confirm-input" className="gr-label-xs" style={{ color: 'var(--text-2)', marginBottom: 8, display: 'block' }}>
              Type RESET to confirm
            </label>
            <input
              id="reset-confirm-input"
              ref={resetInputRef}
              type="text"
              placeholder="Type RESET"
              autoFocus
              onChange={(e) => { resetInput.current = e.target.value; }}
              className="gr-input"
              style={{ marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 9 }}>
              <button
                ref={cancelButtonRef}
                onClick={() => { setResetConfirm(null); resetInput.current = ''; }}
                className="gr-btn gr-btn-ghost"
                style={{ padding: '10px', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                ref={confirmButtonRef}
                onClick={handleResetConfirm}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 12, border: 'none',
                  background: '#be123c', color: 'white',
                  fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
