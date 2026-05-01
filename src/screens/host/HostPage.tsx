import { useState, useEffect, useCallback, useRef } from 'react';
import { FUNCTIONS_URL } from '../../lib/supabase';
import { STATS_POLL_INTERVAL_MS } from '../../lib/constants';
import { useGameStore } from '../../store/gameStore';
import { useGetServerTime } from '../../hooks/useServerTime';
import { AdminQuestionManager } from './AdminQuestionManager';
import type {
  HostActionName,
  HostActionRequest,
  HostActionResponse,
  QuestionStatsResponse,
  EdgeFunctionError,
} from '../../lib/types';

const SESSION_KEY = 'quiz_host_secret';

// Actions that move the game forward sequentially
const PRIMARY_ACTIONS: { action: HostActionName; label: string }[] = [
  { action: 'start_countdown', label: 'Start Game' },
  { action: 'open_question',   label: 'Open Question' },
  { action: 'close_question',  label: 'Close Question' },
  { action: 'show_reveal',     label: 'Show Reveal' },
  { action: 'show_leaderboard', label: 'Show Leaderboard' },
  { action: 'next_question',   label: 'Next Question →' },
  { action: 'end_game',        label: 'End Game' },
];

const UTILITY_ACTIONS: { action: HostActionName; label: string; danger?: boolean }[] = [
  { action: 'force_close_question', label: 'Force Close Question' },
  { action: 'recompute_leaderboard', label: 'Recompute Leaderboard' },
  { action: 'soft_reset_game', label: 'Soft Reset Round', danger: true },
  { action: 'hard_reset_game', label: 'Hard Reset Game', danger: true },
];

export function HostPage() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem(SESSION_KEY) ?? '');
  const [authError] = useState('');

  if (!secret) {
    return <HostLogin onLogin={(s) => { setSecret(s); }} error={authError} />;
  }

  return <HostDashboard secret={secret} onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setSecret(''); }} />;
}

// ── Login ──────────────────────────────────────────────────────────────────────

function HostLogin({ onLogin, error }: { onLogin: (s: string) => void; error: string }) {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setChecking(true);
    setLocalError('');

    // Validate by calling get-question-stats — it requires HOST_SECRET
    try {
      const res = await fetch(`${FUNCTIONS_URL}/get-question-stats`, {
        headers: { 'X-Host-Secret': value.trim() },
      });
      if (res.status === 401) {
        setLocalError('Wrong secret. Try again.');
      } else {
        sessionStorage.setItem(SESSION_KEY, value.trim());
        onLogin(value.trim());
      }
    } catch {
      setLocalError('Network error. Check connection.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-full bg-slate-900 px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">Host Panel</h1>
          <p className="mt-1 text-slate-400 text-sm">Enter your HOST_SECRET to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="HOST_SECRET"
            autoFocus
            className="w-full rounded-xl bg-white/10 text-white placeholder-slate-500
              px-4 py-4 text-base border border-white/10 focus:outline-none
              focus:ring-2 focus:ring-indigo-500"
          />
          {(localError || error) && (
            <p className="text-red-400 text-sm text-center">{localError || error}</p>
          )}
          <button
            type="submit"
            disabled={!value.trim() || checking}
            className="w-full rounded-xl bg-indigo-600 text-white font-bold py-4
              disabled:opacity-40 active:scale-95 transition-transform"
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
  const [activeTab, setActiveTab] = useState<'game' | 'questions'>('game');
  const [stats, setStats] = useState<QuestionStatsResponse | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<HostActionName | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [resetConfirm, setResetConfirm] = useState<'soft_reset_game' | 'hard_reset_game' | null>(null);
  const resetInput = useRef('');

  // Poll get-question-stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${FUNCTIONS_URL}/get-question-stats`, {
        headers: { 'X-Host-Secret': secret },
      });
      if (res.ok) setStats(await res.json());
    } catch { /* silent */ }
  }, [secret]);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, STATS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStats]);

  // Live countdown ticker derived from stats.question_ends_at
  useEffect(() => {
    const endsAt = stats?.question_ends_at;
    if (!endsAt) { setTimeLeft(null); return; }
    const endMs = new Date(endsAt).getTime();
    const tick = () => {
      const diff = endMs - getServerTime();
      setTimeLeft(Math.max(0, Math.ceil(diff / 1000)));
    };
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
  }, []);// eslint-disable-line react-hooks/exhaustive-deps

  const doAction = async (action: HostActionName) => {
    setActionLoading(action);
    setActionError('');
    setActionSuccess('');
    try {
      const body: HostActionRequest = { action };
      const res = await fetch(`${FUNCTIONS_URL}/host-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Host-Secret': secret,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = json as EdgeFunctionError;
        setActionError(err.error ?? 'Unknown error');
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

  const handleResetConfirm = async () => {
    if (resetInput.current !== 'RESET' || !resetConfirm) return;
    const action = resetConfirm;
    setResetConfirm(null);
    resetInput.current = '';
    await doAction(action);
  };

  const status = gameState?.status ?? 'loading…';
  const questionProgress = stats?.question_index != null
    ? `${stats.question_index}/${stats.total_questions || '—'}`
    : null;
  const submittedRatio = stats?.player_count
    ? Math.min(1, (stats?.submitted_count ?? 0) / stats.player_count)
    : 0;

  const isActionEnabled = useCallback((action: HostActionName) => {
    switch (action) {
      case 'start_countdown':
        return status === 'waiting' && (stats?.total_questions ?? 0) > 0;
      case 'open_question':
        return status === 'countdown';
      case 'close_question':
        return status === 'question_open' || status === 'question_closed';
      case 'show_reveal':
        return status === 'question_closed' || status === 'reveal';
      case 'show_leaderboard':
        return status === 'reveal' || status === 'leaderboard';
      case 'next_question':
        return status === 'leaderboard';
      case 'end_game':
        return status !== 'waiting' && status !== 'ended';
      case 'force_close_question':
        return status === 'question_open' || status === 'question_closed';
      case 'recompute_leaderboard':
        return status === 'question_closed' || status === 'reveal' || status === 'leaderboard';
      case 'soft_reset_game':
      case 'hard_reset_game':
        return true;
      default:
        return false;
    }
  }, [status, stats?.total_questions]);
  const nextRecommendedAction = PRIMARY_ACTIONS.find(({ action }) => isActionEnabled(action))?.label ?? 'Waiting for next valid step';

  return (
    <div className="min-h-full bg-slate-900 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-slate-800 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Control Center</p>
          <h1 className="mt-1 text-lg font-bold">Host Panel</h1>
        </div>
        <button
          onClick={onLogout}
          className="text-slate-400 text-sm hover:text-white transition-colors"
        >
          Logout
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-800/70 p-1 border border-white/10">
          <HostTabButton
            label="Game Flow"
            active={activeTab === 'game'}
            onClick={() => setActiveTab('game')}
          />
          <HostTabButton
            label="Question Bank"
            active={activeTab === 'questions'}
            onClick={() => setActiveTab('questions')}
          />
        </div>

        {activeTab === 'game' ? (
          <>
            <div className="rounded-[28px] border border-white/10 bg-slate-800/90 p-5 shadow-xl shadow-slate-950/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Live game state</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-white">{status}</h2>
                  <p className="mt-2 text-sm text-slate-300">{nextRecommendedAction}</p>
                </div>
                <div className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] ${
                  status === 'question_open'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : status === 'countdown'
                      ? 'bg-indigo-500/15 text-indigo-300'
                      : status === 'ended'
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-white/5 text-slate-300'
                }`}>
                  {status}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <HostMetricCard
                  label="Question"
                  value={questionProgress ?? '—'}
                  accent="text-indigo-300"
                />
                <HostMetricCard
                  label="Players"
                  value={stats?.player_count ?? '—'}
                  accent="text-white"
                />
                <HostMetricCard
                  label="Answers"
                  value={stats ? `${stats.submitted_count}/${stats.player_count || 0}` : '—'}
                  accent="text-emerald-300"
                />
                <HostMetricCard
                  label="Time Left"
                  value={timeLeft !== null ? `${timeLeft}s` : '—'}
                  accent={timeLeft !== null && timeLeft <= 5 ? 'text-red-300' : 'text-white'}
                />
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Answer progress</p>
                    <p className="mt-1 text-sm font-medium text-slate-200">
                      {stats
                        ? `${stats.submitted_count} answered out of ${stats.player_count || 0} players`
                        : 'Waiting for stats'}
                    </p>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-white">
                    {stats?.player_count ? `${Math.round(submittedRatio * 100)}%` : '—'}
                  </p>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                    style={{ width: `${submittedRatio * 100}%` }}
                  />
                </div>
              </div>

              {question && (
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Current prompt</p>
                  <p className="mt-2 text-sm font-medium leading-6 text-white">
                    {question.text}
                  </p>
                </div>
              )}
            </div>

            {/* Feedback */}
            {actionError && (
              <div className="bg-red-900/40 border border-red-500/40 rounded-lg px-4 py-3 text-red-300 text-sm">
                {actionError}
              </div>
            )}
            {actionSuccess && (
              <div className="bg-emerald-900/40 border border-emerald-500/40 rounded-lg px-4 py-3 text-emerald-300 text-sm">
                ✓ {actionSuccess}
              </div>
            )}

            {/* Primary actions */}
            <div className="space-y-2">
              <p className="text-slate-400 text-xs uppercase tracking-widest">Game Flow</p>
              <div className="grid grid-cols-2 gap-2">
                {PRIMARY_ACTIONS.map(({ action, label }) => (
                  <ActionButton
                    key={action}
                    label={label}
                    loading={actionLoading === action}
                    disabled={actionLoading !== null || !isActionEnabled(action)}
                    onClick={() => callAction(action)}
                  />
                ))}
              </div>
            </div>

            {/* Utility actions */}
            <div className="space-y-2">
              <p className="text-slate-400 text-xs uppercase tracking-widest">Emergency / Utilities</p>
              <div className="grid grid-cols-2 gap-2">
                {UTILITY_ACTIONS.map(({ action, label, danger }) => (
                  <ActionButton
                    key={action}
                    label={label}
                    loading={actionLoading === action}
                    disabled={actionLoading !== null || !isActionEnabled(action)}
                    onClick={() => callAction(action)}
                    danger={danger}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <AdminQuestionManager secret={secret} />
        )}
      </div>

      {/* Reset confirmation modal */}
      {resetConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-6">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-xl font-bold text-red-400">
              ⚠️ {resetConfirm === 'soft_reset_game' ? 'Soft Reset Round' : 'Hard Reset Game'}
            </h2>
            <p className="text-slate-300 text-sm">
              {resetConfirm === 'soft_reset_game'
                ? 'This deletes answers, scores, and leaderboard data. Players can rejoin. Type RESET to confirm.'
                : 'This clears ALL players, answers, scores, and leaderboard data. Players must re-enter their name. Type RESET to confirm.'}
            </p>
            <input
              type="text"
              placeholder="Type RESET"
              autoFocus
              onChange={(e) => { resetInput.current = e.target.value; }}
              className="w-full rounded-lg bg-white/10 text-white px-3 py-3 text-base
                border border-white/10 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setResetConfirm(null); resetInput.current = ''; }}
                className="flex-1 rounded-lg bg-white/10 text-white py-3 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleResetConfirm}
                className="flex-1 rounded-lg bg-red-600 text-white py-3 font-bold"
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

function HostTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  );
}

function ActionButton({
  label, loading, disabled, onClick, danger,
}: {
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-2xl border px-4 py-4 text-left transition-transform
        disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform
        ${danger
          ? 'border-red-700/50 bg-red-900/60 text-red-300'
          : 'border-white/10 bg-slate-700 text-white hover:bg-slate-600'
        }`}
    >
      <div className="flex min-h-[72px] items-center">
        <p className="text-sm font-bold">{loading ? '…' : label}</p>
      </div>
    </button>
  );
}

function HostMetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-black tabular-nums ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  );
}
