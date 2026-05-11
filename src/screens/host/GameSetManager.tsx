import { useCallback, useEffect, useRef, useState } from 'react';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../../lib/supabase';
import { resolveQuestionImageUrl } from '../../lib/questionAssets';
import type { SpecialRuleConfig, SpecialRuleType } from '../../lib/types';
import type {
  AdminQuestionRecord,
  AdminQuestionRequest,
  AdminQuestionResponse,
  GameSetRecord,
  GameSetQuestionRecord,
} from '../../lib/adminTypes';
import { getSpecialRulePresentation, hasSpecialRule, normalizeSpecialRuleConfig } from '../../lib/specialRules';

// ── API helpers ───────────────────────────────────────────────────────────────

async function callAdmin(
  secret: string,
  body: AdminQuestionRequest,
): Promise<AdminQuestionResponse> {
  const res = await fetch(`${FUNCTIONS_URL}/admin-question-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'X-Host-Secret': secret },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    return res.json() as Promise<AdminQuestionResponse>;
  }

  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* non-JSON body */ }

  // Edge function errors use { error, detail }; Supabase gateway uses { code, message }
  const msg =
    (typeof json.error   === 'string' ? json.error   : null) ??
    (typeof json.code    === 'string' ? json.code    : null) ??
    `HTTP ${res.status}`;
  const detail =
    (typeof json.detail  === 'string' ? json.detail  : null) ??
    (typeof json.message === 'string' ? json.message : null) ??
    res.statusText;
  throw new Error(detail ? `${msg}: ${detail}` : msg);
}

// ── Types ────────────────────────────────────────────────────────────────────

type View = 'sets_list' | 'set_detail' | 'question_picker';

interface EditingRow {
  id: string;
  time_limit_seconds: string;
  max_score: string;
  min_correct_score: string;
  circle_radius_ratio: string;
  special_rule_type: SpecialRuleType;
  special_rule_form: {
    multiplier: string;
    bonus_ratio: string;
    max_bonus_points: string;
    wrong_penalty_points: string;
    top_n: string;
    bonus_points: string;
    hidden_until_reveal: boolean;
    penalize_no_answer: boolean;
    allow_negative_total_score: boolean;
  };
}

const SPECIAL_RULE_OPTIONS: Array<{ type: SpecialRuleType; label: string }> = [
  { type: 'normal', label: 'None' },
  { type: 'double_score', label: 'Double Score' },
  { type: 'triple_score', label: 'Triple Score' },
  { type: 'speed_bonus', label: 'Speed Bonus' },
  { type: 'no_mistake', label: 'No Mistake' },
  { type: 'fastest_finger', label: 'Fastest Finger' },
  { type: 'mystery_multiplier', label: 'Mystery Multiplier' },
];

function parseSpecialRuleNumber(value: string, fallback: number | undefined) {
  if (value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createSpecialRuleForm(type: SpecialRuleType, rawConfig: SpecialRuleConfig | null | undefined) {
  const config = normalizeSpecialRuleConfig(type, rawConfig ?? {});
  return {
    multiplier: String(config.multiplier ?? (type === 'triple_score' ? 3 : 2)),
    bonus_ratio: String(config.bonus_ratio ?? 0.5),
    max_bonus_points: String(config.max_bonus_points ?? 500),
    wrong_penalty_points: String(config.wrong_penalty_points ?? -200),
    top_n: String(config.top_n ?? 3),
    bonus_points: String(config.bonus_points ?? 300),
    hidden_until_reveal: Boolean(config.hidden_until_reveal ?? true),
    penalize_no_answer: Boolean(config.penalize_no_answer ?? false),
    allow_negative_total_score: Boolean(config.allow_negative_total_score ?? false),
  };
}

function buildSpecialRuleConfigFromEditingRow(editingRow: EditingRow): SpecialRuleConfig {
  const form = editingRow.special_rule_form;
  return normalizeSpecialRuleConfig(editingRow.special_rule_type, {
    multiplier: parseSpecialRuleNumber(form.multiplier, editingRow.special_rule_type === 'triple_score' ? 3 : 2),
    bonus_ratio: parseSpecialRuleNumber(form.bonus_ratio, 0.5),
    max_bonus_points: parseSpecialRuleNumber(form.max_bonus_points, 500),
    wrong_penalty_points: parseSpecialRuleNumber(form.wrong_penalty_points, -200),
    penalize_no_answer: form.penalize_no_answer,
    allow_negative_total_score: form.allow_negative_total_score,
    top_n: parseSpecialRuleNumber(form.top_n, 3),
    bonus_points: parseSpecialRuleNumber(form.bonus_points, 300),
    hidden_until_reveal: form.hidden_until_reveal,
  });
}

function toLegacySpecialRoundType(type: SpecialRuleType): 'normal' | 'double_score' | 'speed_bonus' | 'mystery_round' | undefined {
  switch (type) {
    case 'normal':
      return 'normal';
    case 'double_score':
      return 'double_score';
    case 'speed_bonus':
      return 'speed_bonus';
    case 'mystery_multiplier':
      return 'mystery_round';
    default:
      return undefined;
  }
}

function fromLegacySpecialRoundType(type: unknown): SpecialRuleType {
  switch (type) {
    case 'double_score':
      return 'double_score';
    case 'speed_bonus':
      return 'speed_bonus';
    case 'mystery_round':
      return 'mystery_multiplier';
    default:
      return 'normal';
  }
}

function normalizeGameSetQuestionRecord(
  raw: GameSetQuestionRecord | (Record<string, unknown> & Partial<GameSetQuestionRecord>),
): GameSetQuestionRecord {
  const specialRuleType = (raw.special_rule_type as SpecialRuleType | undefined)
    ?? fromLegacySpecialRoundType((raw as Record<string, unknown>).special_round_type);
  const specialRuleConfig = normalizeSpecialRuleConfig(
    specialRuleType,
    (raw.special_rule_config as SpecialRuleConfig | undefined) ?? {},
  );

  return {
    ...(raw as GameSetQuestionRecord),
    special_rule_type: specialRuleType,
    special_rule_config: specialRuleConfig,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export function GameSetManager({ secret, onStatsChanged }: { secret: string; onStatsChanged?: () => Promise<void> | void }) {
  const [view, setView] = useState<View>('sets_list');
  const [gameSets, setGameSets] = useState<GameSetRecord[]>([]);
  const [selectedGameSet, setSelectedGameSet] = useState<GameSetRecord | null>(null);
  const [gsQuestions, setGsQuestions] = useState<GameSetQuestionRecord[]>([]);
  const [bankQuestions, setBankQuestions] = useState<AdminQuestionRecord[]>([]);
  const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set());
  const [editingRow, setEditingRow] = useState<EditingRow | null>(null);
  const [newSetName, setNewSetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const flash = (msg: string, isError = false) => {
    if (isError) { setErrorMsg(msg); setMessage(''); }
    else { setMessage(msg); setErrorMsg(''); }
    setTimeout(() => { setMessage(''); setErrorMsg(''); }, 3500);
  };

  // ── Load game sets ────────────────────────────────────────────────────────

  const loadGameSets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await callAdmin(secret, { action: 'list_game_sets' });
      setGameSets(res.game_sets ?? []);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to load game sets', true);
    } finally {
      setLoading(false);
    }
  }, [secret]);

  useEffect(() => { void loadGameSets(); }, [loadGameSets]);

  // ── Load game set questions ───────────────────────────────────────────────

  const loadGSQ = useCallback(async (gameSetId: string) => {
    try {
      const res = await callAdmin(secret, { action: 'list_game_set_questions', game_set_id: gameSetId });
      setGsQuestions((res.game_set_questions ?? []).map((row) => normalizeGameSetQuestionRecord(row as GameSetQuestionRecord)));
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to load questions', true);
    }
  }, [secret]);

  // ── Load bank questions (for picker) ─────────────────────────────────────

  const loadBank = useCallback(async () => {
    try {
      const res = await callAdmin(secret, { action: 'list_questions' });
      setBankQuestions(res.questions ?? []);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to load question bank', true);
    }
  }, [secret]);

  // ── Create game set ───────────────────────────────────────────────────────

  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleCreateGameSet = async () => {
    if (!newSetName.trim()) {
      nameInputRef.current?.focus();
      flash('Enter a name for the Game Set first.', true);
      return;
    }
    setBusy('create');
    try {
      await callAdmin(secret, { action: 'create_game_set', name: newSetName.trim() });
      setNewSetName('');
      await loadGameSets();
      await onStatsChanged?.();
      flash('Game Set created.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to create', true);
    } finally {
      setBusy(null);
    }
  };

  // ── Open game set detail ──────────────────────────────────────────────────

  const handleOpenSet = async (gs: GameSetRecord) => {
    setSelectedGameSet(gs);
    setEditingRow(null);
    setView('set_detail');
    await loadGSQ(gs.id);
  };

  // ── Set active ────────────────────────────────────────────────────────────

  const handleSetActive = async (gameSetId: string) => {
    setBusy(`active-${gameSetId}`);
    try {
      const res = await callAdmin(secret, { action: 'set_active_game_set', game_set_id: gameSetId });
      await loadGameSets();
      if (selectedGameSet?.id === gameSetId && res.game_set) {
        setSelectedGameSet(res.game_set);
      }
      await onStatsChanged?.();
      flash('Game Set set as active.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to set active', true);
    } finally {
      setBusy(null);
    }
  };

  // ── Delete game set ───────────────────────────────────────────────────────

  const handleDeleteGameSet = async (gameSetId: string) => {
    setBusy(`delete-gs-${gameSetId}`);
    setConfirmDelete(null);
    try {
      await callAdmin(secret, { action: 'delete_game_set', game_set_id: gameSetId });
      if (selectedGameSet?.id === gameSetId) {
        setView('sets_list');
        setSelectedGameSet(null);
        setGsQuestions([]);
      }
      await loadGameSets();
      await onStatsChanged?.();
      flash('Game Set deleted.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to delete', true);
    } finally {
      setBusy(null);
    }
  };

  // ── Remove question from game set ─────────────────────────────────────────

  const handleRemoveGSQ = async (gsqId: string) => {
    if (!selectedGameSet) return;
    setBusy(`remove-${gsqId}`);
    try {
      await callAdmin(secret, { action: 'remove_game_set_question', game_set_question_id: gsqId });
      await loadGSQ(selectedGameSet.id);
      await loadGameSets();
      await onStatsChanged?.();
      flash('Question removed from Game Set.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to remove', true);
    } finally {
      setBusy(null);
    }
  };

  // ── Toggle enabled ────────────────────────────────────────────────────────

  const handleToggleEnabled = async (gsq: GameSetQuestionRecord) => {
    if (!selectedGameSet) return;
    setBusy(`toggle-${gsq.id}`);
    try {
      await callAdmin(secret, {
        action: 'toggle_game_set_question_enabled',
        game_set_question_id: gsq.id,
        is_enabled: !gsq.is_enabled,
      });
      await loadGSQ(selectedGameSet.id);
      await loadGameSets();
      await onStatsChanged?.();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to toggle', true);
    } finally {
      setBusy(null);
    }
  };

  // ── Reorder (drag-and-drop full reorder) ─────────────────────────────────

  const handleReorder = async (newOrder: GameSetQuestionRecord[]) => {
    if (!selectedGameSet) return;
    setGsQuestions(newOrder); // optimistic
    setBusy('reorder');
    try {
      await callAdmin(secret, {
        action: 'reorder_game_set_questions',
        game_set_id: selectedGameSet.id,
        ordered_ids: newOrder.map((q) => q.id),
      });
      await loadGSQ(selectedGameSet.id);
      await onStatsChanged?.();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Reorder failed', true);
      await loadGSQ(selectedGameSet.id);
    } finally {
      setBusy(null);
    }
  };

  // ── Edit row (inline) ─────────────────────────────────────────────────────

  const startEdit = (gsq: GameSetQuestionRecord) => {
    const specialRuleType = gsq.special_rule_type ?? 'normal';
    setEditingRow({
      id: gsq.id,
      time_limit_seconds: String(gsq.time_limit_seconds),
      max_score: String(gsq.max_score),
      min_correct_score: String(gsq.min_correct_score),
      circle_radius_ratio: String(gsq.circle_radius_ratio),
      special_rule_type: specialRuleType,
      special_rule_form: createSpecialRuleForm(specialRuleType, gsq.special_rule_config ?? {}),
    });
  };

  const handleSaveEdit = async () => {
    if (!editingRow || !selectedGameSet) return;
    setBusy(`save-${editingRow.id}`);
    try {
      await callAdmin(secret, {
        action: 'update_game_set_question',
        game_set_question_id: editingRow.id,
        time_limit_seconds: parseInt(editingRow.time_limit_seconds, 10),
        max_score: parseInt(editingRow.max_score, 10),
        min_correct_score: parseInt(editingRow.min_correct_score, 10),
        circle_radius_ratio: parseFloat(editingRow.circle_radius_ratio),
        special_rule_type: editingRow.special_rule_type,
        special_rule_config: buildSpecialRuleConfigFromEditingRow(editingRow),
        special_round_type: toLegacySpecialRoundType(editingRow.special_rule_type),
      });
      setEditingRow(null);
      await loadGSQ(selectedGameSet.id);
      await onStatsChanged?.();
      flash('Values saved.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Save failed', true);
    } finally {
      setBusy(null);
    }
  };

  // ── Add questions from bank ───────────────────────────────────────────────

  const handleOpenPicker = async () => {
    await loadBank();
    setSelectedBankIds(new Set());
    setView('question_picker');
  };

  const handleAddSelected = async () => {
    if (!selectedGameSet || selectedBankIds.size === 0) return;
    setBusy('add-questions');
    try {
      const orderedSelectedIds = bankQuestions
        .filter((question) => selectedBankIds.has(question.id))
        .map((question) => question.id);

      await callAdmin(secret, {
        action: 'bulk_add_questions_to_game_set',
        game_set_id: selectedGameSet.id,
        question_ids: orderedSelectedIds,
      });
      setView('set_detail');
      await loadGSQ(selectedGameSet.id);
      await loadGameSets();
      await onStatsChanged?.();
      flash(`Added ${selectedBankIds.size} question(s) to Game Set.`);
      setSelectedBankIds(new Set());
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to add questions', true);
    } finally {
      setBusy(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Feedback */}
      {(message || errorMsg) && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 13,
          background: errorMsg ? 'rgba(251,113,133,.1)' : 'rgba(52,211,153,.1)',
          border: `1px solid ${errorMsg ? 'rgba(251,113,133,.3)' : 'rgba(52,211,153,.3)'}`,
          color: errorMsg ? 'var(--rose)' : 'var(--emerald)',
        }}>
          {message || errorMsg}
        </div>
      )}

      {/* ── Game Sets List ─────────────────────────────────────────────────── */}
      {view === 'sets_list' && (
        <GameSetsListView
          gameSets={gameSets}
          loading={loading}
          busy={busy}
          newSetName={newSetName}
          confirmDelete={confirmDelete}
          nameInputRef={nameInputRef}
          onNewSetNameChange={setNewSetName}
          onCreateSet={handleCreateGameSet}
          onOpenSet={handleOpenSet}
          onSetActive={handleSetActive}
          onConfirmDelete={setConfirmDelete}
          onDeleteSet={handleDeleteGameSet}
          onRefresh={loadGameSets}
        />
      )}

      {/* ── Game Set Detail ────────────────────────────────────────────────── */}
      {view === 'set_detail' && selectedGameSet && (
        <GameSetDetailView
          gameSet={selectedGameSet}
          questions={gsQuestions}
          busy={busy}
          editingRow={editingRow}
          onBack={() => { setView('sets_list'); setSelectedGameSet(null); setGsQuestions([]); setEditingRow(null); }}
          onSetActive={() => handleSetActive(selectedGameSet.id)}
          onOpenPicker={handleOpenPicker}
          onRemove={handleRemoveGSQ}
          onToggleEnabled={handleToggleEnabled}
          onReorderAll={handleReorder}
          onStartEdit={startEdit}
          onEditChange={(field, val) => setEditingRow((prev) => prev ? { ...prev, [field]: val } : null)}
          onEditRuleTypeChange={(type) => setEditingRow((prev) => prev ? {
            ...prev,
            special_rule_type: type,
            special_rule_form: createSpecialRuleForm(type, buildSpecialRuleConfigFromEditingRow(prev)),
          } : null)}
          onEditRuleFormChange={(patch) => setEditingRow((prev) => prev ? {
            ...prev,
            special_rule_form: { ...prev.special_rule_form, ...patch },
          } : null)}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => setEditingRow(null)}
        />
      )}

      {/* ── Question Picker ────────────────────────────────────────────────── */}
      {view === 'question_picker' && (
        <QuestionPickerView
          questions={bankQuestions}
          selectedIds={selectedBankIds}
          busy={busy}
          onToggle={(id) => setSelectedBankIds((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
          })}
          onSelectAll={() => setSelectedBankIds(new Set(bankQuestions.filter((q) => q.is_published).map((q) => q.id)))}
          onClearAll={() => setSelectedBankIds(new Set())}
          onAdd={handleAddSelected}
          onBack={() => setView('set_detail')}
        />
      )}

    </div>
  );
}

// ── Game Sets List View ───────────────────────────────────────────────────────

function GameSetsListView({
  gameSets, loading, busy, newSetName, confirmDelete, nameInputRef,
  onNewSetNameChange, onCreateSet, onOpenSet, onSetActive,
  onConfirmDelete, onDeleteSet, onRefresh,
}: {
  gameSets: GameSetRecord[];
  loading: boolean;
  busy: string | null;
  newSetName: string;
  confirmDelete: string | null;
  nameInputRef: React.RefObject<HTMLInputElement>;
  onNewSetNameChange: (v: string) => void;
  onCreateSet: () => void;
  onOpenSet: (gs: GameSetRecord) => void;
  onSetActive: (id: string) => void;
  onConfirmDelete: (id: string | null) => void;
  onDeleteSet: (id: string) => void;
  onRefresh: () => void;
}) {
  const activeSet = gameSets.find((gameSet) => gameSet.status === 'active') ?? null;
  return (
    <>
      {/* Create new */}
      <div className="gr-card-strong" style={{ padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <div className="gr-label-xs" style={{ marginBottom: 6 }}>Game Setup</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Create and prepare playable question sets</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            Build sets from published bank questions, activate one set, then use Host Game Flow to run the live session.
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 14 }}>
          <SetupStat label="Total sets" value={String(gameSets.length)} />
          <SetupStat label="Active set" value={activeSet?.name ?? 'None'} />
          <SetupStat label="Ready sets" value={String(gameSets.filter((set) => set.enabled_question_count > 0).length)} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={nameInputRef}
            value={newSetName}
            onChange={(e) => onNewSetNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreateSet()}
            placeholder="Game Set name…"
            className="gr-input"
            aria-label="Game set name"
            style={{ flex: '1 1 260px', fontSize: 13 }}
          />
          <button
            onClick={onCreateSet}
            disabled={busy === 'create' || !newSetName.trim()}
            className="gr-btn gr-btn-gold"
            style={{ fontSize: 13, padding: '10px 16px', flex: '0 0 auto', width: 'auto', minWidth: 140 }}
          >
            {busy === 'create' ? '…' : '+ Create'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
          Give each set a clear event-facing name so the active setup is easy to verify before starting the game.
        </div>
      </div>

      {/* List */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="gr-label-xs">Game Sets</div>
          <button
            onClick={onRefresh}
            disabled={loading || busy !== null}
            style={{ fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {gameSets.length === 0 && !loading ? (
          <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)', border: '1px dashed rgba(255,255,255,.1)', borderRadius: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>No Game Sets yet.</div>
            <div>Create a set above, then add questions from Question Bank.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {gameSets.map((gs) => (
              <div
                key={gs.id}
                className="gr-card"
                style={{ padding: '14px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{gs.name}</span>
                    <StatusBadge status={gs.status} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {gs.enabled_question_count}/{gs.question_count} questions enabled
                  </div>
                  <div style={{ fontSize: 11, color: gs.enabled_question_count > 0 ? 'var(--emerald)' : 'var(--rose)', marginTop: 4 }}>
                    {gs.enabled_question_count > 0 ? 'Ready to activate' : 'Add at least one enabled question before activation'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', width: '100%', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => onOpenSet(gs)}
                    className="gr-hbtn"
                    style={{ fontSize: 11, padding: '6px 10px', width: 'auto' }}
                  >
                    Edit
                  </button>
                  {gs.status !== 'active' && (
                    <button
                      onClick={() => onSetActive(gs.id)}
                      disabled={busy !== null || gs.enabled_question_count === 0}
                      className="gr-hbtn"
                      style={{ fontSize: 11, padding: '6px 10px', borderColor: 'rgba(245,199,74,.3)', color: 'var(--gold)', width: 'auto' }}
                    >
                      {busy === `active-${gs.id}` ? '…' : 'Set Active'}
                    </button>
                  )}
                  <button
                    onClick={() => onConfirmDelete(gs.id)}
                    disabled={busy !== null}
                    className="gr-hbtn gr-hbtn-danger"
                    style={{ fontSize: 11, padding: '6px 10px', width: 'auto' }}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,8,16,.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 300, backdropFilter: 'blur(6px)' }}>
          <div className="gr-card" style={{ width: '100%', maxWidth: 300, padding: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--rose)', marginBottom: 10 }}>Delete Game Set?</div>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 18, lineHeight: 1.6 }}>
              This will permanently delete the game set and all its question assignments. The questions in your bank will not be affected.
            </p>
            <div style={{ display: 'flex', gap: 9 }}>
              <button
                onClick={() => onConfirmDelete(null)}
                className="gr-btn gr-btn-ghost"
                style={{ padding: '10px', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={() => onDeleteSet(confirmDelete)}
                style={{ flex: 1, padding: '10px 14px', borderRadius: 12, border: 'none', background: '#be123c', color: 'white', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Game Set Detail View ──────────────────────────────────────────────────────

function GameSetDetailView({
  gameSet, questions, busy, editingRow,
  onBack, onSetActive, onOpenPicker, onRemove, onToggleEnabled,
  onReorderAll, onStartEdit, onEditChange, onEditRuleTypeChange, onEditRuleFormChange, onSaveEdit, onCancelEdit,
}: {
  gameSet: GameSetRecord;
  questions: GameSetQuestionRecord[];
  busy: string | null;
  editingRow: EditingRow | null;
  onBack: () => void;
  onSetActive: () => void;
  onOpenPicker: () => void;
  onRemove: (id: string) => void;
  onToggleEnabled: (gsq: GameSetQuestionRecord) => void;
  onReorderAll: (newOrder: GameSetQuestionRecord[]) => void;
  onStartEdit: (gsq: GameSetQuestionRecord) => void;
  onEditChange: (field: keyof EditingRow, val: EditingRow[keyof EditingRow]) => void;
  onEditRuleTypeChange: (type: SpecialRuleType) => void;
  onEditRuleFormChange: (patch: Partial<EditingRow['special_rule_form']>) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}) {
  const readyCount = questions.filter((q) => q.is_enabled).length;
  const canActivate = readyCount > 0;

  // Drag-and-drop state
  const [dragId,     setDragId]     = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== dragOverId) setDragOverId(id);
  };
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const from = questions.findIndex((q) => q.id === dragId);
    const to   = questions.findIndex((q) => q.id === targetId);
    if (from === -1 || to === -1) { setDragId(null); setDragOverId(null); return; }
    const next = [...questions];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setDragId(null); setDragOverId(null);
    onReorderAll(next);
  };
  const handleDragEnd = () => { setDragId(null); setDragOverId(null); };

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ fontSize: 13, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', padding: 0 }}>
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{gameSet.name}</span>
            <StatusBadge status={gameSet.status} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
            {gameSet.enabled_question_count}/{gameSet.question_count} enabled
          </div>
        </div>
        {gameSet.status !== 'active' && (
          <button onClick={onSetActive} disabled={busy !== null || !canActivate} className="gr-btn gr-btn-gold" style={{ fontSize: 12, padding: '8px 14px', flexShrink: 0, width: 'auto' }}>
            {busy?.startsWith('active') ? '…' : 'Set Active'}
          </button>
        )}
      </div>

      {gameSet.status === 'active' && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 12, background: 'rgba(245,199,74,.07)', border: '1px solid rgba(245,199,74,.2)', color: 'var(--gold)' }}>
          ✓ This is the active Game Set. Host navigation uses these questions in this order.
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <SetupStat label="Enabled questions" value={`${readyCount}/${questions.length || 0}`} />
        <SetupStat label="Ready to activate" value={canActivate ? 'Yes' : 'No'} tone={canActivate ? 'good' : 'warning'} />
        <SetupStat label="Live status" value={gameSet.status} tone={gameSet.status === 'active' ? 'good' : 'neutral'} />
      </div>

      {!canActivate && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 12, background: 'rgba(251,113,133,.08)', border: '1px solid rgba(251,113,133,.22)', color: 'var(--rose)' }}>
          This Game Set cannot be activated yet. Add at least one question and keep it enabled.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onOpenPicker} disabled={busy !== null} className="gr-btn gr-btn-gold" style={{ fontSize: 12, padding: '9px 14px', width: 'auto' }}>
          + Add Questions from Bank
        </button>
      </div>

      {questions.length > 0 && <QuestionTimeline questions={questions} />}

      {/* Questions list */}
      {questions.length === 0 ? (
        <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)', border: '1px dashed rgba(255,255,255,.1)', borderRadius: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>No questions selected yet.</div>
          <div>Add questions from Question Bank to make this set playable.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Column header */}
          <div style={{ display: 'grid', gridTemplateColumns: '22px 24px 52px minmax(140px,1fr) 52px 60px 60px 52px 32px 66px', gap: 6, padding: '4px 10px', minWidth: 680, fontSize: 10, fontWeight: 700, letterSpacing: '.07em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
            <span />
            <span>#</span>
            <span>IMG</span>
            <span>Question</span>
            <span>Time</span>
            <span>Max</span>
            <span>Min</span>
            <span>⊙</span>
            <span>On</span>
            <span>Actions</span>
          </div>

          {questions.map((gsq) => {
            const isBusy    = busy === `remove-${gsq.id}` || busy === `toggle-${gsq.id}` || busy === 'reorder';
            const isDragging = dragId === gsq.id;
            const isOver     = dragOverId === gsq.id && dragId !== gsq.id;
            const rulePresentation = hasSpecialRule(gsq.special_rule_type)
              ? getSpecialRulePresentation(gsq.special_rule_type ?? 'normal', gsq.special_rule_config ?? {}, 'countdown')
              : null;

            return (
              <div
                key={gsq.id}
                draggable
                onDragStart={(e) => handleDragStart(e, gsq.id)}
                onDragOver={(e) => handleDragOver(e, gsq.id)}
                onDrop={(e) => handleDrop(e, gsq.id)}
                onDragEnd={handleDragEnd}
                className="gr-card"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 24px 52px minmax(140px,1fr) 52px 60px 60px 52px 32px 66px',
                  gap: 6, padding: '9px 10px', minWidth: 680,
                  alignItems: 'center',
                  opacity: isDragging ? 0.35 : gsq.is_enabled ? 1 : 0.5,
                  outline: isOver ? '2px dashed rgba(245,199,74,.55)' : 'none',
                  outlineOffset: -2,
                  transition: 'opacity .15s, outline .1s',
                  cursor: isDragging ? 'grabbing' : 'default',
                }}
              >
                {/* Drag handle */}
                <div style={{ cursor: 'grab', color: 'var(--text-3)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }} title="Drag to reorder">
                  ⠿
                </div>

                {/* Play order */}
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-2)', textAlign: 'center' }}>{gsq.play_order}</span>

                {/* Preview */}
                <div style={{ width: 44, height: 30, borderRadius: 6, overflow: 'hidden', background: 'rgba(0,0,0,.4)' }}>
                  <img src={resolveQuestionImageUrl(gsq.question_image_url) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>

                {/* Question text */}
                <div style={{ overflow: 'hidden' }}>
                  <span title={gsq.question_text} style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {gsq.question_text}
                  </span>
                  {rulePresentation && (
                    <span className={`special-rule-badge special-rule-card--${rulePresentation.theme}`} style={{ display: 'inline-flex', marginTop: 3, fontSize: 9, padding: '2px 6px' }}>
                      {rulePresentation.label}
                    </span>
                  )}
                </div>

                {/* Static values */}
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{gsq.time_limit_seconds}s</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{gsq.max_score}</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{gsq.min_correct_score}</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{gsq.circle_radius_ratio}</span>

                {/* Enabled toggle */}
                <button onClick={() => onToggleEnabled(gsq)} disabled={isBusy} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, opacity: isBusy ? 0.5 : 1, color: gsq.is_enabled ? 'var(--emerald)' : 'var(--text-3)' }} title={gsq.is_enabled ? 'Disable' : 'Enable'}>
                  {gsq.is_enabled ? '✓' : '○'}
                </button>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 3 }}>
                  <MiniBtn onClick={() => onStartEdit(gsq)} disabled={isBusy} gold>Edit</MiniBtn>
                  <MiniBtn onClick={() => onRemove(gsq.id)} disabled={isBusy} danger>×</MiniBtn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.6 }}>
        Drag ⠿ to reorder. Values here are runtime snapshots — changes to Question Bank defaults won't affect this set.
      </div>

      {/* Edit Modal */}
      {editingRow && (
        <QuestionEditModal
          editingRow={editingRow}
          questions={questions}
          busy={busy}
          onEditChange={onEditChange}
          onEditRuleTypeChange={onEditRuleTypeChange}
          onEditRuleFormChange={onEditRuleFormChange}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      )}
    </>
  );
}

// ── Question Edit Modal ───────────────────────────────────────────────────────

function QuestionEditModal({
  editingRow, questions, busy,
  onEditChange, onEditRuleTypeChange, onEditRuleFormChange, onSave, onCancel,
}: {
  editingRow: EditingRow;
  questions: GameSetQuestionRecord[];
  busy: string | null;
  onEditChange: (field: keyof EditingRow, val: EditingRow[keyof EditingRow]) => void;
  onEditRuleTypeChange: (type: SpecialRuleType) => void;
  onEditRuleFormChange: (patch: Partial<EditingRow['special_rule_form']>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const gsq = questions.find((q) => q.id === editingRow.id);
  const isBusy = busy === `save-${editingRow.id}`;

  const editingRuleConfig = buildSpecialRuleConfigFromEditingRow(editingRow);
  const editingRulePresentation = getSpecialRulePresentation(editingRow.special_rule_type, editingRuleConfig, 'countdown');
  const editingPlayerPreview    = getSpecialRulePresentation(editingRow.special_rule_type, editingRuleConfig, 'question');
  const editingRevealPreview    = getSpecialRulePresentation(editingRow.special_rule_type, editingRuleConfig, 'reveal');

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(5,8,16,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 16px', zIndex: 200, backdropFilter: 'blur(6px)', overflowY: 'auto' }}
      onClick={onCancel}
    >
      <div
        style={{ width: '100%', maxWidth: 560, background: 'var(--navy-mid)', borderRadius: 16, border: '1px solid rgba(255,255,255,.1)', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div className="gr-label-xs" style={{ marginBottom: 4 }}>Edit Question Settings</div>
            {gsq && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                <div style={{ width: 52, height: 36, borderRadius: 7, overflow: 'hidden', background: 'rgba(0,0,0,.4)', flexShrink: 0 }}>
                  <img src={resolveQuestionImageUrl(gsq.question_image_url) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, fontWeight: 600 }}>{gsq.question_text}</div>
              </div>
            )}
          </div>
          <button onClick={onCancel} style={{ fontSize: 20, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Core numeric fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <ModalField label="Time (วินาที)" hint="s">
            <input value={editingRow.time_limit_seconds} onChange={(e) => onEditChange('time_limit_seconds', e.target.value)} style={modalInputStyle} type="number" min={5} max={300} />
          </ModalField>
          <ModalField label="Max Score (pts)" hint="pts">
            <input value={editingRow.max_score} onChange={(e) => onEditChange('max_score', e.target.value)} style={modalInputStyle} type="number" min={0} />
          </ModalField>
          <ModalField label="Min Correct Score (pts)" hint="pts">
            <input value={editingRow.min_correct_score} onChange={(e) => onEditChange('min_correct_score', e.target.value)} style={modalInputStyle} type="number" />
          </ModalField>
          <ModalField label="Circle Radius Ratio" hint="0–0.5">
            <input value={editingRow.circle_radius_ratio} onChange={(e) => onEditChange('circle_radius_ratio', e.target.value)} style={modalInputStyle} type="number" min={0.01} max={0.5} step={0.01} />
          </ModalField>
        </div>

        {/* Special rule selector */}
        <div>
          <div className="gr-label-xs" style={{ marginBottom: 8 }}>Special Rule</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SPECIAL_RULE_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() => onEditRuleTypeChange(opt.type)}
                style={{ padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, background: editingRow.special_rule_type === opt.type ? 'var(--gold)' : 'rgba(255,255,255,.08)', color: editingRow.special_rule_type === opt.type ? 'var(--navy-deep)' : 'var(--text-2)' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rule-specific fields */}
        {editingRow.special_rule_type === 'speed_bonus' && (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <ModalField label="Bonus Ratio" hint="0–1"><input value={editingRow.special_rule_form.bonus_ratio} onChange={(e) => onEditRuleFormChange({ bonus_ratio: e.target.value })} style={modalInputStyle} type="number" step={0.05} min={0} max={1} /></ModalField>
            <ModalField label="Max Bonus Points" hint="pts"><input value={editingRow.special_rule_form.max_bonus_points} onChange={(e) => onEditRuleFormChange({ max_bonus_points: e.target.value })} style={modalInputStyle} type="number" min={0} /></ModalField>
          </div>
        )}
        {editingRow.special_rule_type === 'no_mistake' && (
          <>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
              <ModalField label="คะแนนโทษ (ติดลบ)" hint="pts"><input value={editingRow.special_rule_form.wrong_penalty_points} onChange={(e) => onEditRuleFormChange({ wrong_penalty_points: e.target.value })} style={modalInputStyle} type="number" max={0} /></ModalField>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ToggleField label="หักคะแนนเมื่อไม่ตอบ" checked={editingRow.special_rule_form.penalize_no_answer} onChange={(v) => onEditRuleFormChange({ penalize_no_answer: v })} />
              <ToggleField label="ยอมให้คะแนนรวมติดลบ" checked={editingRow.special_rule_form.allow_negative_total_score} onChange={(v) => onEditRuleFormChange({ allow_negative_total_score: v })} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>ตอบผิด → หักคะแนนโทษ · ไม่ตอบ → หักเมื่อเปิด "หักคะแนนเมื่อไม่ตอบ" · ตอบถูก → ได้คะแนนตามปกติ</div>
          </>
        )}
        {editingRow.special_rule_type === 'fastest_finger' && (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <ModalField label="Top N" hint="คน"><input value={editingRow.special_rule_form.top_n} onChange={(e) => onEditRuleFormChange({ top_n: e.target.value })} style={modalInputStyle} type="number" min={1} /></ModalField>
            <ModalField label="Bonus Points" hint="pts"><input value={editingRow.special_rule_form.bonus_points} onChange={(e) => onEditRuleFormChange({ bonus_points: e.target.value })} style={modalInputStyle} type="number" min={0} /></ModalField>
          </div>
        )}
        {editingRow.special_rule_type === 'mystery_multiplier' && (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <ModalField label="Multiplier" hint="×"><input value={editingRow.special_rule_form.multiplier} onChange={(e) => onEditRuleFormChange({ multiplier: e.target.value })} style={modalInputStyle} type="number" min={1} step={0.5} /></ModalField>
            <ToggleField label="Hidden until reveal" checked={editingRow.special_rule_form.hidden_until_reveal} onChange={(v) => onEditRuleFormChange({ hidden_until_reveal: v })} />
          </div>
        )}
        {editingRow.special_rule_type === 'double_score' && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Multiplier ×2 will be applied to correct answers.</div>}
        {editingRow.special_rule_type === 'triple_score' && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Multiplier ×3 will be applied to correct answers.</div>}

        {/* Rule preview cards */}
        {editingRow.special_rule_type !== 'normal' && editingRulePresentation && (
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <RulePreviewCard title="Big Screen" badge={editingRulePresentation.label} message={editingRulePresentation.bigScreenMessage} theme={editingRulePresentation.theme} />
            {editingPlayerPreview && <RulePreviewCard title="Player" badge={editingPlayerPreview.label} message={editingPlayerPreview.playerMessage} theme={editingPlayerPreview.theme} />}
            {editingRevealPreview && <RulePreviewCard title="Reveal" badge={editingRevealPreview.label} message={editingRevealPreview.revealMessage} theme={editingRevealPreview.theme} />}
          </div>
        )}

        {/* Save / Cancel */}
        <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
          <button onClick={onCancel} disabled={isBusy} className="gr-btn gr-btn-ghost" style={{ padding: '11px 16px', fontSize: 13 }}>ยกเลิก</button>
          <button onClick={onSave} disabled={isBusy} className="gr-btn gr-btn-gold" style={{ flex: 1, fontSize: 14, padding: '11px 16px' }}>
            {isBusy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}

const modalInputStyle: React.CSSProperties = {
  width: '100%', fontSize: 14, padding: '9px 12px', borderRadius: 9,
  border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)',
  color: 'var(--text)', fontFamily: 'var(--font-mono)', boxSizing: 'border-box', outline: 'none',
};

function ModalField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 5, letterSpacing: '.04em', display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        {hint && <span style={{ color: 'var(--text-3)', opacity: .6 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Question Order Timeline ───────────────────────────────────────────────────

function QuestionTimeline({ questions }: { questions: GameSetQuestionRecord[] }) {
  const enabledCount = questions.filter((q) => q.is_enabled).length;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div className="gr-label-xs">Play Order</div>
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{enabledCount} of {questions.length} active</span>
      </div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 0,
          overflowX: 'auto', paddingBottom: 6,
          scrollbarWidth: 'thin',
        }}
      >
        {questions.map((gsq, idx) => {
          const rulePresentation = hasSpecialRule(gsq.special_rule_type)
            ? getSpecialRulePresentation(gsq.special_rule_type ?? 'normal', gsq.special_rule_config ?? {}, 'countdown')
            : null;
          const isLast = idx === questions.length - 1;
          return (
            <div key={gsq.id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {/* Card */}
              <div
                style={{
                  width: 72, flexShrink: 0,
                  borderRadius: 10,
                  border: `1px solid ${gsq.is_enabled ? 'rgba(245,199,74,.28)' : 'rgba(255,255,255,.07)'}`,
                  background: gsq.is_enabled ? 'rgba(245,199,74,.05)' : 'rgba(255,255,255,.02)',
                  opacity: gsq.is_enabled ? 1 : 0.45,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {/* Play order badge */}
                <div
                  style={{
                    position: 'absolute', top: 4, left: 4,
                    width: 18, height: 18, borderRadius: '50%',
                    background: gsq.is_enabled ? 'var(--gold)' : 'rgba(255,255,255,.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 900, color: gsq.is_enabled ? 'var(--navy-deep)' : 'var(--text-3)',
                    zIndex: 1,
                  }}
                >
                  {gsq.play_order}
                </div>
                {/* Thumbnail */}
                <div style={{ width: '100%', height: 44, overflow: 'hidden', background: 'rgba(0,0,0,.4)' }}>
                  <img
                    src={resolveQuestionImageUrl(gsq.question_image_url) ?? undefined}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                {/* Text */}
                <div style={{ padding: '4px 5px 5px' }}>
                  <div
                    style={{
                      fontSize: 9, color: 'var(--text-2)', lineHeight: 1.35,
                      overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {gsq.question_text}
                  </div>
                  {rulePresentation && (
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 8, fontWeight: 700, letterSpacing: '.04em',
                        color: 'var(--gold)', opacity: 0.85,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      ★ {rulePresentation.label}
                    </div>
                  )}
                </div>
              </div>
              {/* Connector arrow */}
              {!isLast && (
                <div style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.18)', userSelect: 'none' }}>›</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Question Picker View ──────────────────────────────────────────────────────

function QuestionPickerView({
  questions, selectedIds, busy,
  onToggle, onSelectAll, onClearAll, onAdd, onBack,
}: {
  questions: AdminQuestionRecord[];
  selectedIds: Set<string>;
  busy: string | null;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onAdd: () => void;
  onBack: () => void;
}) {
  const availableQuestions = questions.filter((question) => question.is_published);
  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={onBack}
          style={{ fontSize: 13, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', padding: 0 }}
        >
          ← Back
        </button>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', flex: 1 }}>
          Select Questions from Bank
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {selectedIds.size} selected
        </span>
      </div>

      <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 12, background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.18)', color: 'var(--text-2)' }}>
        Only published questions are shown here so the host cannot accidentally build a live set from incomplete bank entries.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onSelectAll} disabled={availableQuestions.length === 0} className="gr-hbtn" style={{ fontSize: 11, padding: '6px 10px', width: 'auto' }}>Select All</button>
        <button onClick={onClearAll} disabled={selectedIds.size === 0} className="gr-hbtn" style={{ fontSize: 11, padding: '6px 10px', width: 'auto' }}>Clear</button>
        <button
          onClick={onAdd}
          disabled={selectedIds.size === 0 || busy === 'add-questions'}
          className="gr-btn gr-btn-gold"
          style={{ fontSize: 12, padding: '8px 14px', marginLeft: 'auto', width: 'auto' }}
        >
          {busy === 'add-questions' ? 'Adding…' : `Add ${selectedIds.size > 0 ? selectedIds.size : ''} to Game Set`}
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -6 }}>
        Snapshot values will be copied from the Question Bank defaults at time of adding.
      </div>

      {/* Question list */}
      {availableQuestions.length === 0 ? (
        <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)', border: '1px dashed rgba(255,255,255,.1)', borderRadius: 12 }}>
          No published questions are available yet. Publish questions in Question Bank first.
        </div>
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {availableQuestions.map((q) => {
          const selected = selectedIds.has(q.id);
          return (
            <button
              key={q.id}
              onClick={() => onToggle(q.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 56px 1fr auto',
                gap: 10, padding: '10px 12px', borderRadius: 11,
                border: `1px solid ${selected ? 'rgba(245,199,74,.4)' : 'rgba(255,255,255,.07)'}`,
                background: selected ? 'rgba(245,199,74,.07)' : 'rgba(255,255,255,.02)',
                cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 14, color: selected ? 'var(--gold)' : 'var(--text-3)' }}>
                {selected ? '☑' : '☐'}
              </span>
              <div style={{ width: 52, height: 36, borderRadius: 7, overflow: 'hidden', background: 'rgba(0,0,0,.4)' }}>
                <img src={resolveQuestionImageUrl(q.image_url) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4, marginBottom: 2 }}>{q.text}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  {q.time_limit_seconds}s · {q.max_score} pts · circle {q.circle_radius_ratio}
                  {q.reveal_image_url ? ' · reveal ready' : ' · no reveal'}
                </div>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                #{q.order_index}
              </span>
            </button>
          );
        })}
      </div>
      )}
    </>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'active' ? 'var(--gold)' :
    status === 'archived' ? 'var(--text-3)' :
    'var(--indigo)';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 999,
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      color,
    }}>
      {status}
    </span>
  );
}

function SetupStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warning';
}) {
  const color =
    tone === 'good'
      ? 'var(--emerald)'
      : tone === 'warning'
        ? 'var(--rose)'
        : 'var(--text)';

  return (
    <div style={{ padding: '11px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.03)' }}>
      <div className="gr-label-xs" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function MiniBtn({
  onClick, disabled, children, gold, danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  gold?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 7,
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-sans)', opacity: disabled ? 0.4 : 1,
        background: danger ? 'rgba(251,113,133,.15)' : gold ? 'rgba(245,199,74,.15)' : 'rgba(255,255,255,.08)',
        color: danger ? 'var(--rose)' : gold ? 'var(--gold)' : 'var(--text-2)',
      }}
    >
      {children}
    </button>
  );
}


function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        minHeight: 34,
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        borderRadius: 9,
        border: '1px solid rgba(255,255,255,.08)',
        background: 'rgba(255,255,255,.03)',
        padding: '8px 10px',
        fontSize: 11,
        color: 'var(--text-2)',
      }}
    >
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function RulePreviewCard({
  title,
  badge,
  message,
  theme,
}: {
  title: string;
  badge: string;
  message: string;
  theme: string;
}) {
  return (
    <div className={`special-rule-card special-rule-card--${theme}`}>
      <div className="gr-label-xs" style={{ marginBottom: 8 }}>{title}</div>
      <div className="special-rule-badge">{badge}</div>
      <div style={{ marginTop: 10, fontSize: 12, color: '#fff', lineHeight: 1.5 }}>{message}</div>
    </div>
  );
}
