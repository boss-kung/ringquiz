import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../../lib/supabase';
import { STATS_POLL_INTERVAL_MS, COUNTDOWN_DISPLAY_SECONDS } from '../../lib/constants';
import { useGameStore } from '../../store/gameStore';
import { useGetServerTime } from '../../hooks/useServerTime';
import { AdminQuestionManager } from './AdminQuestionManager';
import { GameSetManager } from './GameSetManager';
import { getHostActionMessage } from '../../lib/hostActionMessages';
import { getOperatorStep, getSpecialRuleLabelTh } from '../../lib/hostOperatorFlow';
import type {
  HostActionName,
  HostActionResponse,
  QuestionStatsResponse,
  EdgeFunctionError,
  DisplayTheme,
  Question,
  GameState,
} from '../../lib/types';

const SESSION_KEY = 'quiz_host_secret';

type ConfirmAction = 'soft_reset_game' | 'hard_reset_game' | 'end_game' | 'force_close_question';
type RtStatus = 'connecting' | 'connected' | 'disconnected';

const HOST_ACTION_FALLBACKS: Partial<Record<HostActionName, string[]>> = {
  trigger_hype_cheer:           ['hype_cheer'],
  trigger_spotlight_leaderboard:['spotlight_leaderboard'],
  trigger_final_drumroll:       ['final_drumroll'],
  set_display_theme:            ['display_theme', 'set_theme'],
};

export function HostPage() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem(SESSION_KEY) ?? '');
  if (!secret) return <HostLogin onLogin={(s) => setSecret(s)} />;
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setChecking(true);
    setLocalError('');
    try {
      const res = await fetch(`${FUNCTIONS_URL}/get-question-stats`, {
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'X-Host-Secret': value.trim() },
      });
      if (res.ok) { sessionStorage.setItem(SESSION_KEY, value.trim()); onLogin(value.trim()); return; }
      let errCode = '';
      try { errCode = (await res.json()).error ?? ''; } catch { /* ignore */ }
      if (res.status === 401) setLocalError('รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง');
      else if (errCode === 'server_missing_host_secret') setLocalError('เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า HOST_SECRET กรุณาติดต่อผู้ดูแลระบบ');
      else setLocalError(`เข้าสู่ระบบไม่สำเร็จ (HTTP ${res.status})`);
    } catch { setLocalError('เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'); }
    finally { setChecking(false); }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100%', background:'var(--navy-deep)', padding:24 }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div className="gr-label-sm gr-gold" style={{ marginBottom:8, letterSpacing:'.18em' }}>Control Center</div>
          <h1 style={{ fontSize:28, fontWeight:900, color:'var(--text)' }}>Host Panel</h1>
          <p style={{ marginTop:6, fontSize:13, color:'var(--text-2)' }}>ใส่ HOST_SECRET เพื่อเข้าควบคุมเกม</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <label className="gr-label-xs" style={{ color:'var(--text-2)' }}>HOST_SECRET</label>
          <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="HOST_SECRET" autoFocus className="gr-input" />
          {localError && <p style={{ color:'var(--rose)', fontSize:13, textAlign:'center' }}>{localError}</p>}
          <button type="submit" disabled={!value.trim() || checking} className="gr-btn gr-btn-gold">
            {checking ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

function HostDashboard({ secret, onLogout }: { secret: string; onLogout: () => void }) {
  const gameState   = useGameStore((s) => s.gameState);
  const question    = useGameStore((s) => s.question);
  const getServerTime = useGetServerTime();

  const [activeTab, setActiveTab] = useState<'game' | 'questions' | 'setup'>('game');
  const [stats, setStats]         = useState<QuestionStatsResponse | null>(null);
  const [timeLeft, setTimeLeft]   = useState<number | null>(null);

  const [actionLoading, setActionLoading] = useState<HostActionName | null>(null);
  const [fxLoading,     setFxLoading]     = useState<HostActionName | null>(null);
  const [actionError,   setActionError]   = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [statsError,    setStatsError]    = useState('');

  const [resetConfirm,       setResetConfirm]       = useState<ConfirmAction | null>(null);
  const [autoAdvance,        setAutoAdvance]        = useState(false);
  const [autoAdvanceCountdown, setAutoAdvanceCountdown] = useState<number | null>(null);
  const [rtStatus,           setRtStatus]           = useState<RtStatus>('connecting');
  const [exportBusy,         setExportBusy]         = useState(false);
  const [emergencyOpen,      setEmergencyOpen]      = useState(false);
  const [copiedLink,         setCopiedLink]         = useState<'join' | 'display' | null>(null);

  const resetInput        = useRef('');
  const resetInputRef     = useRef<HTMLInputElement | null>(null);
  const cancelButtonRef   = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef  = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef    = useRef<HTMLElement | null>(null);
  const autoCloseCalledRef = useRef(false);
  const autoOpenCalledRef  = useRef(false);
  const actionPendingRef   = useRef(false);

  // Declared early so effects below can reference without TDZ
  const status = gameState?.status ?? 'loading';

  // ── Network helpers ──────────────────────────────────────────────────────────

  const postHostAction = useCallback(async (action: string, payload?: Record<string, unknown>) => {
    const res = await fetch(`${FUNCTIONS_URL}/host-action`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${SUPABASE_ANON_KEY}`, 'X-Host-Secret':secret },
      body: JSON.stringify({ action, ...(payload ? { payload } : {}) }),
    });
    return { res, json: await res.json() };
  }, [secret]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${FUNCTIONS_URL}/get-question-stats`, {
        headers: { 'Authorization':`Bearer ${SUPABASE_ANON_KEY}`, 'X-Host-Secret':secret },
      });
      if (!res.ok) {
        let errCode = '';
        try { errCode = (await res.json()).error ?? ''; } catch { /* ignore */ }
        setStatsError(errCode || `stats_http_${res.status}`);
        setStats((cur) => cur ? { ...cur, question_ends_at: null } : cur);
        return;
      }
      setStats(await res.json());
      setStatsError('');
    } catch {
      setStatsError('network_error');
      setStats((cur) => cur ? { ...cur, question_ends_at: null } : cur);
    }
  }, [secret]);

  // ── Effects ──────────────────────────────────────────────────────────────────

  // Dynamic poll: 1 s during question_open, 2.5 s otherwise
  useEffect(() => {
    fetchStats();
    const interval = status === 'question_open' ? 1000 : STATS_POLL_INTERVAL_MS;
    const id = setInterval(fetchStats, interval);
    return () => clearInterval(id);
  }, [fetchStats, status]);

  useEffect(() => { if (activeTab === 'game') void fetchStats(); }, [activeTab, fetchStats]);

  // Realtime connection status
  useEffect(() => {
    const ch = supabase.channel('host-rt-watch')
      .on('postgres_changes', { event:'*', schema:'public', table:'game_state' }, () => {})
      .subscribe((s) => {
        if (s === 'SUBSCRIBED')                          setRtStatus('connected');
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setRtStatus('disconnected');
        else                                             setRtStatus('connecting');
      });
    return () => { void supabase.removeChannel(ch); };
  }, []);

  // Confirmation modal focus trap
  useEffect(() => {
    if (!resetConfirm) return;
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (resetInputRef.current ?? cancelButtonRef.current ?? confirmButtonRef.current)?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!resetConfirm) return;
      if (e.key === 'Escape') { e.preventDefault(); setResetConfirm(null); resetInput.current = ''; return; }
      if (e.key !== 'Tab') return;
      const focusable = ([resetInputRef.current, cancelButtonRef.current, confirmButtonRef.current] as (HTMLElement | null)[])
        .filter((n): n is HTMLElement => n !== null);
      if (!focusable.length) return;
      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); focusable[focusable.length - 1]?.focus(); }
      } else if (idx === -1 || idx === focusable.length - 1) {
        e.preventDefault(); focusable[0]?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); lastFocusedRef.current?.focus(); };
  }, [resetConfirm]);

  // Time-left ticker
  useEffect(() => {
    const endsAt = stats?.question_ends_at;
    if (!endsAt) { setTimeLeft(null); return; }
    const endMs = new Date(endsAt).getTime();
    const tick = () => setTimeLeft(Math.max(0, Math.ceil((endMs - getServerTime()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [stats?.question_ends_at, getServerTime]);

  // Auto-advance: auto-open after countdown
  useEffect(() => {
    if (!autoAdvance || status !== 'countdown') { autoOpenCalledRef.current = false; return; }
    if (autoOpenCalledRef.current) return;
    const updatedAt = gameState?.updated_at;
    if (!updatedAt) return;
    const openAt = new Date(updatedAt).getTime() + (COUNTDOWN_DISPLAY_SECONDS + 1) * 1000;
    const delay  = Math.max(0, openAt - getServerTime());
    const id = setTimeout(() => {
      if (!autoOpenCalledRef.current && isActionEnabled('open_question')) {
        autoOpenCalledRef.current = true;
        void doAction('open_question');
      }
    }, delay);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, status, gameState?.updated_at, getServerTime]);

  // Auto-advance: auto-close when timer expires
  useEffect(() => {
    if (!autoAdvance || status !== 'question_open') { autoCloseCalledRef.current = false; return; }
    if (timeLeft !== 0 || autoCloseCalledRef.current) return;
    autoCloseCalledRef.current = true;
    void doAction('close_question');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, status, timeLeft]);

  // Auto-advance countdown display
  useEffect(() => {
    if (!autoAdvance) { setAutoAdvanceCountdown(null); return; }
    if (status === 'countdown' && gameState?.updated_at) {
      const openAt = new Date(gameState.updated_at).getTime() + (COUNTDOWN_DISPLAY_SECONDS + 1) * 1000;
      const tick = () => setAutoAdvanceCountdown(Math.max(0, Math.ceil((openAt - getServerTime()) / 1000)));
      tick();
      const id = setInterval(tick, 250);
      return () => clearInterval(id);
    }
    setAutoAdvanceCountdown(status === 'question_open' ? timeLeft : null);
  }, [autoAdvance, status, gameState?.updated_at, timeLeft, getServerTime]);

  // Clear success message after 3 s
  useEffect(() => {
    if (!actionSuccess) return;
    const id = setTimeout(() => setActionSuccess(''), 3000);
    return () => clearTimeout(id);
  }, [actionSuccess]);

  // ── Action helpers ───────────────────────────────────────────────────────────

  const isActionEnabled = useCallback((action: HostActionName): boolean => {
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

  const doAction = async (action: HostActionName, payload?: Record<string, unknown>) => {
    if (actionPendingRef.current) return;
    actionPendingRef.current = true;
    setActionLoading(action);
    setActionError('');
    setActionSuccess('');
    try {
      const { res, json } = await postHostAction(action, payload);
      if (!res.ok) {
        const code = (json as EdgeFunctionError).error ?? 'unknown_error';
        setActionError(getHostActionMessage(code, `action=${action}`));
      } else {
        const r = json as HostActionResponse;
        setActionSuccess(`${action} → ${r.status}${r.already_in_state ? ' (already)' : ''}`);
        void fetchStats();
      }
    } catch { setActionError(getHostActionMessage('network_error')); }
    finally { setActionLoading(null); actionPendingRef.current = false; }
  };

  const doFxAction = async (action: HostActionName, payload?: Record<string, unknown>) => {
    setFxLoading(action);
    setActionError('');
    setActionSuccess('');
    try {
      let { res, json } = await postHostAction(action, payload);
      if (!res.ok && (json as EdgeFunctionError).error === 'unknown_action') {
        for (const fb of HOST_ACTION_FALLBACKS[action] ?? []) {
          const r = await postHostAction(fb, payload);
          res = r.res; json = r.json;
          if (res.ok || (json as EdgeFunctionError).error !== 'unknown_action') break;
        }
      }
      if (!res.ok) setActionError(getHostActionMessage((json as EdgeFunctionError).error ?? 'unknown_error', `fx=${action}`));
      else setActionSuccess(`✓ ${action} ส่งแล้ว`);
    } catch { setActionError(getHostActionMessage('network_error')); }
    finally { setFxLoading(null); }
  };

  // Actions that require typed confirmation
  const callAction = useCallback((action: HostActionName) => {
    if (['soft_reset_game', 'hard_reset_game', 'end_game', 'force_close_question'].includes(action)) {
      setResetConfirm(action as ConfirmAction);
      return;
    }
    void doAction(action);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExportResults = useCallback(async () => {
    setExportBusy(true);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/export-results`, {
        headers: { 'Authorization':`Bearer ${SUPABASE_ANON_KEY}`, 'X-Host-Secret':secret },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setActionError(getHostActionMessage((j as { error?: string }).error ?? 'function_error', `export HTTP ${res.status}`));
        return;
      }
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type:'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `game-results-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
      a.click(); URL.revokeObjectURL(url);
      setActionSuccess('ส่งออกผลสำเร็จ');
    } catch { setActionError(getHostActionMessage('network_error')); }
    finally { setExportBusy(false); }
  }, [secret]);

  const handleCopyLink = (type: 'join' | 'display') => {
    const base = window.location.origin + (import.meta.env.BASE_URL || '/');
    const url  = type === 'display' ? `${base}?/display` : base;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(type);
      setTimeout(() => setCopiedLink(null), 2000);
    });
  };

  const confirmKeyword = (action: ConfirmAction) =>
    action === 'end_game' ? 'END' : action === 'force_close_question' ? 'CLOSE' : 'RESET';

  const handleResetConfirm = async () => {
    if (!resetConfirm || resetInput.current !== confirmKeyword(resetConfirm)) return;
    const action = resetConfirm;
    setResetConfirm(null);
    resetInput.current = '';
    await doAction(action);
  };

  // ── Derived values ───────────────────────────────────────────────────────────

  const isLastQuestion   = (stats?.question_index ?? 0) > 0 && (stats?.question_index ?? 0) >= (stats?.total_questions ?? 0);
  const hasActiveGameSet = Boolean(stats?.active_game_set_id);
  const totalQuestions   = stats?.total_questions ?? 0;
  const playerCount      = stats?.player_count ?? 0;
  const submittedCount   = stats?.submitted_count ?? 0;
  const submittedRatio   = playerCount > 0 ? Math.min(1, submittedCount / playerCount) : 0;
  const statsStale       = Boolean(statsError);

  const step = getOperatorStep(status, {
    totalQuestions, hasActiveGameSet, playerCount, submittedCount, timeLeft, isLastQuestion,
  });

  const specialRuleLabel = getSpecialRuleLabelTh(gameState?.current_special_rule_type);

  const primaryDisabled =
    actionLoading !== null ||
    step.primaryAction === null ||
    !isActionEnabled(step.primaryAction!) ||
    step.disabledReasonTh !== null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight:'100%', background:'var(--navy-deep)', color:'var(--text)', fontFamily:'var(--font-sans)' }}>

      {/* ── Header ── */}
      <div style={{ position:'sticky', top:0, zIndex:10, display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)', background:'rgba(5,8,16,.96)', backdropFilter:'blur(12px)', padding:'11px 18px' }}>
        <div>
          <div className="gr-label-xs" style={{ marginBottom:3 }}>Control Center</div>
          <div style={{ fontSize:15, fontWeight:800 }}>Host Panel</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div className="gr-badge gr-badge-live">LIVE</div>
          <div
            title={`Realtime: ${rtStatus}`}
            style={{ width:8, height:8, borderRadius:'50%', flexShrink:0, background: rtStatus === 'connected' ? '#34D399' : rtStatus === 'disconnected' ? '#FB7185' : '#F5C74A', ...(rtStatus !== 'connected' ? { animation:'grGlowPulse 1.2s ease-in-out infinite' } : {}) }}
          />
          <button onClick={onLogout} style={{ fontSize:11, color:'var(--text-3)', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-sans)' }}>ออกจากระบบ</button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{ display:'flex', gap:6, padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
        {(['game','questions','setup'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding:'7px 14px', borderRadius:999, border:'none', fontFamily:'var(--font-sans)', fontSize:12, fontWeight:700, cursor:'pointer', transition:'all .15s', background: activeTab === tab ? 'rgba(255,255,255,.07)' : 'transparent', color: activeTab === tab ? 'var(--text)' : 'var(--text-3)', borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent' }}>
            {tab === 'game' ? 'ควบคุมเกม' : tab === 'questions' ? 'คลังคำถาม' : 'ตั้งค่าเกม'}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div style={{ maxWidth:960, margin:'0 auto', padding:'14px 16px 32px' }}>
        {activeTab === 'questions' ? (
          <AdminQuestionManager secret={secret} />
        ) : activeTab === 'setup' ? (
          <GameSetManager secret={secret} onStatsChanged={fetchStats} />
        ) : (
          <GameConsole
            status={status}
            step={step}
            stats={stats}
            statsStale={statsStale}
            statsError={statsError}
            question={question}
            gameState={gameState}
            timeLeft={timeLeft}
            submittedRatio={submittedRatio}
            submittedCount={submittedCount}
            playerCount={playerCount}
            specialRuleLabel={specialRuleLabel}
            actionLoading={actionLoading}
            fxLoading={fxLoading}
            actionError={actionError}
            actionSuccess={actionSuccess}
            primaryDisabled={primaryDisabled}
            autoAdvance={autoAdvance}
            autoAdvanceCountdown={autoAdvanceCountdown}
            emergencyOpen={emergencyOpen}
            copiedLink={copiedLink}
            exportBusy={exportBusy}
            isActionEnabled={isActionEnabled}
            onPrimaryAction={() => step.primaryAction && callAction(step.primaryAction)}
            onAutoAdvanceToggle={() => setAutoAdvance((v) => !v)}
            onCallAction={callAction}
            onFxAction={doFxAction}
            onExport={handleExportResults}
            onCopyLink={handleCopyLink}
            onEmergencyToggle={() => setEmergencyOpen((v) => !v)}
            onSetTab={setActiveTab}
          />
        )}
      </div>

      {/* ── Confirm Modal ── */}
      {resetConfirm && (
        <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" style={{ position:'fixed', inset:0, background:'rgba(5,8,16,.9)', display:'flex', alignItems:'center', justifyContent:'center', padding:24, zIndex:300, backdropFilter:'blur(6px)' }}>
          <div className="gr-card" style={{ width:'100%', maxWidth:320, padding:24 }}>
            <div id="confirm-title" style={{ fontSize:17, fontWeight:800, color:'var(--rose)', marginBottom:10 }}>
              ⚠{' '}
              {resetConfirm === 'soft_reset_game'      ? 'รีเซ็ตรอบ' :
               resetConfirm === 'hard_reset_game'      ? 'รีเซ็ตเกมทั้งหมด' :
               resetConfirm === 'force_close_question' ? 'บังคับปิดคำถาม' : 'จบเกม'}
            </div>
            <p style={{ fontSize:13, color:'var(--text-2)', marginBottom:14, lineHeight:1.65 }}>
              {resetConfirm === 'soft_reset_game'
                ? 'จะลบคำตอบ คะแนน และอันดับของรอบนี้ทั้งหมด\nดำเนินการต่อหรือไม่?'
                : resetConfirm === 'hard_reset_game'
                ? 'จะลบผู้เล่น คำตอบ คะแนน และอันดับทั้งหมด\nไม่สามารถกู้คืนได้!'
                : resetConfirm === 'force_close_question'
                ? 'จะบังคับปิดรับคำตอบทันที แม้ยังมีผู้เล่นที่ยังไม่ตอบ'
                : 'จะจบเกมทันทีและแสดงผลสุดท้ายบนจอหลัก'}
            </p>
            <div className="gr-label-xs" style={{ color:'var(--text-3)', marginBottom:8, display:'block' }}>
              พิมพ์ <strong style={{ color:'var(--rose)' }}>{confirmKeyword(resetConfirm)}</strong> เพื่อยืนยัน
            </div>
            <input
              ref={resetInputRef}
              type="text"
              placeholder={`พิมพ์ ${confirmKeyword(resetConfirm)}`}
              autoFocus
              onChange={(e) => { resetInput.current = e.target.value; }}
              className="gr-input"
              style={{ marginBottom:12 }}
            />
            <div style={{ display:'flex', gap:9 }}>
              <button ref={cancelButtonRef} onClick={() => { setResetConfirm(null); resetInput.current = ''; }} className="gr-btn gr-btn-ghost" style={{ padding:10, fontSize:13 }}>ยกเลิก</button>
              <button ref={confirmButtonRef} onClick={handleResetConfirm} style={{ flex:1, padding:'10px 14px', borderRadius:12, border:'none', background:'#be123c', color:'white', fontFamily:'var(--font-sans)', fontSize:13, fontWeight:700, cursor:'pointer' }}>ยืนยัน</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Game Console (game tab content) ──────────────────────────────────────────

interface GameConsoleProps {
  status: string;
  step: ReturnType<typeof getOperatorStep>;
  stats: QuestionStatsResponse | null;
  statsStale: boolean;
  statsError: string;
  question: Question | null;
  gameState: GameState | null;
  timeLeft: number | null;
  submittedRatio: number;
  submittedCount: number;
  playerCount: number;
  specialRuleLabel: string;
  actionLoading: HostActionName | null;
  fxLoading: HostActionName | null;
  actionError: string;
  actionSuccess: string;
  primaryDisabled: boolean;
  autoAdvance: boolean;
  autoAdvanceCountdown: number | null;
  emergencyOpen: boolean;
  copiedLink: 'join' | 'display' | null;
  exportBusy: boolean;
  isActionEnabled: (action: HostActionName) => boolean;
  onPrimaryAction: () => void;
  onAutoAdvanceToggle: () => void;
  onCallAction: (action: HostActionName) => void;
  onFxAction: (action: HostActionName, payload?: Record<string, unknown>) => void;
  onExport: () => void;
  onCopyLink: (type: 'join' | 'display') => void;
  onEmergencyToggle: () => void;
  onSetTab: (tab: 'game' | 'questions' | 'setup') => void;
}

function GameConsole({
  status, step, stats, statsStale, statsError,
  question, gameState,
  timeLeft, submittedRatio, submittedCount, playerCount, specialRuleLabel,
  actionLoading, fxLoading, actionError, actionSuccess,
  primaryDisabled, autoAdvance, autoAdvanceCountdown, emergencyOpen, copiedLink, exportBusy,
  isActionEnabled, onPrimaryAction, onAutoAdvanceToggle,
  onCallAction, onFxAction, onExport, onCopyLink, onEmergencyToggle, onSetTab,
}: GameConsoleProps) {
  const anyPending = actionLoading !== null;

  // ── A. Status Strip ──────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

      {/* Status strip */}
      <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:7, padding:'10px 14px', borderRadius:12, background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.07)' }}>
        {/* Phase pill */}
        <div className="hc-phase-pill" style={{ color: step.phaseColor, borderColor: step.phaseColor + '55' }}>
          {status === 'question_open' && <span className="hc-phase-dot" />}
          {step.phaseLabelTh}
        </div>

        {/* Stat chips */}
        {stats?.active_game_set_name && (
          <div style={{ fontSize:11, fontWeight:600, color:'var(--indigo)', background:'rgba(129,140,248,.1)', border:'1px solid rgba(129,140,248,.2)', borderRadius:8, padding:'4px 9px', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {stats.active_game_set_name}
          </div>
        )}
        {stats?.question_index != null && (
          <div className="hc-stat"><span className="hc-stat-label">ข้อ</span><span className="hc-stat-value">{stats.question_index}/{stats.total_questions}</span></div>
        )}
        <div className="hc-stat"><span className="hc-stat-label">ผู้เล่น</span><span className="hc-stat-value">{playerCount}</span></div>
        {(status === 'question_open' || status === 'question_closed') && (
          <div className="hc-stat"><span className="hc-stat-label">ตอบแล้ว</span><span className="hc-stat-value" style={{ color: submittedCount === playerCount && playerCount > 0 ? 'var(--emerald)' : 'var(--text)' }}>{submittedCount}/{playerCount}</span></div>
        )}
        {timeLeft !== null && status === 'question_open' && (
          <div className="hc-stat"><span className="hc-stat-label">เวลา</span><span className="hc-stat-value" style={{ color: timeLeft <= 5 ? 'var(--rose)' : timeLeft <= 10 ? 'var(--gold)' : 'var(--text)' }}>{timeLeft}s</span></div>
        )}
        {specialRuleLabel && (
          <div style={{ fontSize:11, fontWeight:700, color:'var(--gold)', background:'rgba(245,199,74,.08)', border:'1px solid rgba(245,199,74,.2)', borderRadius:8, padding:'4px 9px' }}>{specialRuleLabel}</div>
        )}
        {statsStale && (
          <div style={{ fontSize:10, color:'var(--rose)', fontWeight:600 }}>⚠ ข้อมูลอาจล้าสมัย</div>
        )}
      </div>

      {/* Feedback banners */}
      {actionError && (
        <div style={{ background:'rgba(251,113,133,.1)', border:'1px solid rgba(251,113,133,.28)', borderRadius:10, padding:'10px 14px', color:'var(--rose)', fontSize:13, display:'flex', alignItems:'flex-start', gap:8 }}>
          <span style={{ flexShrink:0, marginTop:1 }}>⚠</span>
          <span>{actionError}</span>
        </div>
      )}
      {statsError && !actionError && (
        <div style={{ background:'rgba(251,113,133,.08)', border:'1px solid rgba(251,113,133,.2)', borderRadius:10, padding:'9px 14px', color:'var(--rose)', fontSize:12 }}>
          ข้อมูลสถิติอาจล้าสมัย: {getHostActionMessage(statsError, statsError)}
        </div>
      )}
      {actionSuccess && (
        <div style={{ background:'rgba(52,211,153,.08)', border:'1px solid rgba(52,211,153,.25)', borderRadius:10, padding:'9px 14px', color:'var(--emerald)', fontSize:12 }}>
          ✓ {actionSuccess}
        </div>
      )}

      {/* Warnings */}
      {step.warnings.map((w, i) => (
        <div key={i} className="hc-warning">⚠ {w}</div>
      ))}

      {/* ── Main 2-col ── */}
      <div className="hc-two-col">

        {/* Left column */}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

          {/* B. Operator Card */}
          <div className="gr-card-strong" style={{ padding:18 }}>
            <div className="gr-label-xs" style={{ marginBottom:12 }}>ขั้นตอนถัดไป</div>

            <div style={{ fontSize:14, fontWeight:700, color: step.phaseColor, marginBottom:4 }}>{step.phaseLabelTh}</div>
            <div style={{ fontSize:12, color:'var(--text-2)', marginBottom:16, lineHeight:1.6 }}>{step.statusDescriptionTh}</div>

            {/* Primary CTA */}
            <button
              className={`hc-cta${step.riskLevel === 'caution' ? ' hc-cta-caution' : ''}`}
              onClick={onPrimaryAction}
              disabled={primaryDisabled}
            >
              {actionLoading === step.primaryAction
                ? 'กำลังดำเนินการ...'
                : step.primaryActionLabelTh}
            </button>

            {/* Disabled reason */}
            {step.disabledReasonTh && !anyPending && (
              <div style={{ marginTop:10, fontSize:12, color:'var(--text-3)', textAlign:'center', lineHeight:1.5 }}>
                🔒 {step.disabledReasonTh}
                {step.disabledReasonTh.includes('Game Setup') && (
                  <button onClick={() => onSetTab('setup')} style={{ marginLeft:6, fontSize:11, color:'var(--indigo)', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-sans)', fontWeight:700, textDecoration:'underline' }}>ไปที่ตั้งค่า</button>
                )}
              </div>
            )}

            {/* Action description */}
            {!primaryDisabled && step.primaryActionDescriptionTh && (
              <div style={{ marginTop:8, fontSize:11, color:'var(--text-3)', textAlign:'center', lineHeight:1.5 }}>{step.primaryActionDescriptionTh}</div>
            )}

            {/* Auto-advance toggle */}
            <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid rgba(255,255,255,.06)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color: autoAdvance ? 'var(--emerald)' : 'var(--text-3)' }}>
                  {autoAdvance ? '⚡ ทำงานอัตโนมัติ' : 'ทำงานอัตโนมัติ'}
                </div>
                {autoAdvance && (
                  <div style={{ fontSize:10, color:'var(--text-3)', marginTop:2 }}>
                    {autoAdvanceCountdown !== null
                      ? (status === 'countdown'
                          ? `เปิดรับคำตอบใน ${autoAdvanceCountdown}s`
                          : `ปิดรับคำตอบใน ${autoAdvanceCountdown}s`)
                      : 'รอสถานะถัดไป'}
                  </div>
                )}
              </div>
              <button
                onClick={onAutoAdvanceToggle}
                style={{ fontSize:10, fontWeight:700, padding:'5px 12px', borderRadius:999, border:'1px solid', cursor:'pointer', fontFamily:'var(--font-sans)', background: autoAdvance ? 'rgba(52,211,153,.12)' : 'rgba(255,255,255,.05)', borderColor: autoAdvance ? 'rgba(52,211,153,.35)' : 'rgba(255,255,255,.12)', color: autoAdvance ? 'var(--emerald)' : 'var(--text-3)', transition:'all .15s', flexShrink:0 }}
              >
                {autoAdvance ? 'เปิดอยู่' : 'ปิดอยู่'}
              </button>
            </div>
          </div>

          {/* D. Question Preview */}
          {question && (
            <div className="gr-card" style={{ padding:14 }}>
              <div className="gr-label-xs" style={{ marginBottom:10 }}>คำถามปัจจุบัน</div>
              <p style={{ fontSize:13, fontWeight:600, lineHeight:1.65, color:'var(--text)', marginBottom:10 }}>{question.text}</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {question.time_limit_seconds && (
                  <div style={{ fontSize:11, color:'var(--text-3)', background:'rgba(255,255,255,.05)', borderRadius:6, padding:'3px 8px' }}>⏱ {question.time_limit_seconds}s</div>
                )}
                {question.max_score && (
                  <div style={{ fontSize:11, color:'var(--text-3)', background:'rgba(255,255,255,.05)', borderRadius:6, padding:'3px 8px' }}>⭐ {question.max_score} pts</div>
                )}
                {question.special_rule_type && question.special_rule_type !== 'normal' && (
                  <div style={{ fontSize:11, color:'var(--gold)', background:'rgba(245,199,74,.08)', border:'1px solid rgba(245,199,74,.2)', borderRadius:6, padding:'3px 8px' }}>{getSpecialRuleLabelTh(question.special_rule_type)}</div>
                )}
                {question.play_order && (
                  <div style={{ fontSize:11, color:'var(--text-3)', background:'rgba(255,255,255,.05)', borderRadius:6, padding:'3px 8px' }}>ข้อ {question.play_order}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

          {/* C. Live Monitor */}
          <div className="gr-card" style={{ padding:14 }}>
            <div className="gr-label-xs" style={{ marginBottom:12 }}>สถานะรอบ</div>

            {/* Answer progress */}
            <div style={{ marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ fontSize:12, fontWeight:600, color:'var(--text-2)' }}>ผู้ตอบ</span>
                <span className="gr-mono" style={{ fontSize:12, fontWeight:700, color: submittedCount === playerCount && playerCount > 0 ? 'var(--emerald)' : 'var(--text)' }}>
                  {statsStale ? 'ล้าสมัย' : `${submittedCount} / ${playerCount}`}
                </span>
              </div>
              <div style={{ height:6, borderRadius:999, background:'rgba(255,255,255,.08)', overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:999, transition:'width .3s', background: submittedRatio === 1 ? 'var(--emerald)' : 'var(--gold)', width:`${statsStale ? 0 : submittedRatio * 100}%` }} />
              </div>
              {playerCount > 0 && (
                <div style={{ marginTop:4, fontSize:11, color:'var(--text-3)', textAlign:'right' }}>
                  {statsStale ? '—' : `${Math.round(submittedRatio * 100)}%`}
                </div>
              )}
            </div>

            {/* Time remaining */}
            {timeLeft !== null && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <span style={{ fontSize:12, color:'var(--text-2)', fontWeight:600 }}>เวลาที่เหลือ</span>
                <span className="gr-mono" style={{ fontSize:20, fontWeight:800, color: timeLeft <= 5 ? 'var(--rose)' : timeLeft <= 10 ? 'var(--gold)' : 'var(--emerald)' }}>
                  {timeLeft}s
                </span>
              </div>
            )}

            {/* Special rule */}
            {specialRuleLabel && (
              <div style={{ padding:'6px 10px', borderRadius:8, background:'rgba(245,199,74,.07)', border:'1px solid rgba(245,199,74,.18)', fontSize:12, fontWeight:700, color:'var(--gold)', marginBottom:8 }}>
                {specialRuleLabel}
              </div>
            )}

            {/* No players warning */}
            {playerCount === 0 && status === 'waiting' && (
              <div style={{ fontSize:12, color:'var(--text-3)', textAlign:'center', padding:'10px 0' }}>ยังไม่มีผู้เล่นเข้าร่วม</div>
            )}

            {/* Not answered warning */}
            {status === 'question_open' && playerCount > 0 && submittedCount < playerCount && (
              <div style={{ fontSize:11, color:'var(--gold)', marginTop:4 }}>
                ยังมี {playerCount - submittedCount} คนที่ยังไม่ตอบ
              </div>
            )}
          </div>

          {/* E. Secondary Controls */}
          <div className="gr-card" style={{ padding:14 }}>
            <div className="gr-label-xs" style={{ marginBottom:10 }}>เครื่องมือ</div>

            <div className="hc-sec-grid" style={{ marginBottom:10 }}>
              <button onClick={() => onCopyLink('join')} className="gr-hbtn" style={{ textAlign:'center' }}>
                <span style={{ fontSize:11, fontWeight:700 }}>{copiedLink === 'join' ? '✓ คัดลอกแล้ว' : '🔗 ลิงก์เข้าเล่น'}</span>
              </button>
              <button onClick={() => onCopyLink('display')} className="gr-hbtn" style={{ textAlign:'center' }}>
                <span style={{ fontSize:11, fontWeight:700 }}>{copiedLink === 'display' ? '✓ คัดลอกแล้ว' : '📺 ลิงก์จอหลัก'}</span>
              </button>
              <button onClick={onExport} disabled={exportBusy} className="gr-hbtn" style={{ textAlign:'center', borderColor:'rgba(129,140,248,.25)', color:'var(--indigo)' }}>
                <span style={{ fontSize:11, fontWeight:700 }}>{exportBusy ? '...' : '⬇ ส่งออกผล'}</span>
              </button>
              <button onClick={() => onCallAction('recompute_leaderboard')} disabled={anyPending || !isActionEnabled('recompute_leaderboard')} className="gr-hbtn" style={{ textAlign:'center' }}>
                <span style={{ fontSize:11, fontWeight:700 }}>🔄 คำนวณคะแนน</span>
              </button>
            </div>

            {/* Stage FX */}
            <div className="gr-label-xs" style={{ marginBottom:8 }}>Stage FX</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:10 }}>
              {([
                { action:'trigger_hype_cheer'           as HostActionName, label:'เชียร์' },
                { action:'trigger_spotlight_leaderboard'as HostActionName, label:'Spotlight' },
                { action:'trigger_final_drumroll'       as HostActionName, label:'Drumroll' },
              ] as const).map(({ action, label }) => (
                <button key={action} onClick={() => onFxAction(action)} disabled={fxLoading !== null} className="gr-hbtn" style={{ textAlign:'center', borderColor:'rgba(129,140,248,.2)', color:'var(--indigo)' }}>
                  <span style={{ fontSize:10, fontWeight:700 }}>{fxLoading === action ? '...' : label}</span>
                </button>
              ))}
            </div>

            {/* Stage Theme */}
            <div className="gr-label-xs" style={{ marginBottom:8 }}>ธีมจอหลัก</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
              {([
                { theme:'classic_gold' as DisplayTheme,  label:'Classic Gold' },
                { theme:'neon_night'   as DisplayTheme,  label:'Neon Night' },
                { theme:'danger_round' as DisplayTheme,  label:'Danger Round' },
                { theme:'final_round'  as DisplayTheme,  label:'Final Round' },
              ]).map(({ theme, label }) => (
                <button key={theme} onClick={() => onFxAction('set_display_theme', { theme })} disabled={fxLoading !== null} className={`gr-hbtn ds-theme-btn-${theme}`} style={{ fontSize:11, textAlign:'center' }}>
                  <span style={{ fontSize:10, fontWeight:700 }}>{fxLoading === 'set_display_theme' ? '...' : label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* F. Emergency Drawer */}
      <div style={{ marginTop:8 }}>
        <button onClick={onEmergencyToggle} className={`hc-emergency-toggle${emergencyOpen ? ' hc-open' : ''}`}>
          <span>⚠ Emergency &amp; Advanced Controls</span>
          <span style={{ fontSize:14 }}>{emergencyOpen ? '▲' : '▼'}</span>
        </button>

        {emergencyOpen && (
          <div style={{ marginTop:8, padding:14, borderRadius:12, border:'1px solid rgba(251,113,133,.2)', background:'rgba(251,113,133,.04)' }}>
            <p style={{ fontSize:12, color:'var(--rose)', marginBottom:12, lineHeight:1.6 }}>
              ⚠ การดำเนินการด้านล่างอาจกระทบต่อเกมที่กำลังดำเนินอยู่ กรุณาใช้ด้วยความระมัดระวัง
            </p>
            <div className="hc-sec-grid">
              <button onClick={() => onCallAction('force_close_question')} disabled={anyPending || !isActionEnabled('force_close_question')} className="gr-hbtn gr-hbtn-danger">
                <span style={{ fontSize:11, fontWeight:700 }}>{actionLoading === 'force_close_question' ? '...' : 'บังคับปิดคำถาม'}</span>
              </button>
              <button onClick={() => onCallAction('end_game')} disabled={anyPending || !isActionEnabled('end_game')} className="gr-hbtn gr-hbtn-danger">
                <span style={{ fontSize:11, fontWeight:700 }}>{actionLoading === 'end_game' ? '...' : 'จบเกม'}</span>
              </button>
              <button onClick={() => onCallAction('soft_reset_game')} disabled={anyPending} className="gr-hbtn gr-hbtn-danger">
                <span style={{ fontSize:11, fontWeight:700 }}>{actionLoading === 'soft_reset_game' ? '...' : 'รีเซ็ตรอบ'}</span>
              </button>
              <button onClick={() => onCallAction('hard_reset_game')} disabled={anyPending} className="gr-hbtn gr-hbtn-danger">
                <span style={{ fontSize:11, fontWeight:700 }}>{actionLoading === 'hard_reset_game' ? '...' : 'รีเซ็ตเกมทั้งหมด'}</span>
              </button>
            </div>
            <div style={{ marginTop:10, padding:'8px 10px', borderRadius:8, background:'rgba(0,0,0,.3)' }}>
              <div className="gr-label-xs" style={{ marginBottom:4 }}>Debug</div>
              <div style={{ fontSize:10, color:'var(--text-3)', fontFamily:'var(--font-mono)' }}>
                status: {status} | session: {gameState?.session_version ?? '—'} | rt: {
                  (function() {
                    const ch = supabase.getChannels();
                    return ch.length > 0 ? 'ok' : 'none';
                  })()
                }
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
