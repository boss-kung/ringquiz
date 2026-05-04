import { useCallback, useEffect, useState } from 'react';
import { FUNCTIONS_URL } from '../../lib/supabase';
import { resolveQuestionImageUrl } from '../../lib/questionAssets';
import type {
  AdminQuestionRecord,
  AdminQuestionRequest,
  AdminQuestionResponse,
  GameSetRecord,
  GameSetQuestionRecord,
} from '../../lib/adminTypes';

// ── API helpers ───────────────────────────────────────────────────────────────

async function callAdmin(
  secret: string,
  body: AdminQuestionRequest,
): Promise<AdminQuestionResponse> {
  const res = await fetch(`${FUNCTIONS_URL}/admin-question-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Host-Secret': secret },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    const detail = typeof json?.detail === 'string' ? `: ${json.detail}` : '';
    throw new Error(`${json?.error ?? 'Request failed'}${detail}`);
  }
  return json as AdminQuestionResponse;
}

// ── Types ────────────────────────────────────────────────────────────────────

type View = 'sets_list' | 'set_detail' | 'question_picker';

interface EditingRow {
  id: string;
  time_limit_seconds: string;
  max_score: string;
  min_correct_score: string;
  circle_radius_ratio: string;
}

// ── Main component ────────────────────────────────────────────────────────────

export function GameSetManager({ secret }: { secret: string }) {
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
      setGsQuestions(res.game_set_questions ?? []);
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

  const handleCreateGameSet = async () => {
    if (!newSetName.trim()) return;
    setBusy('create');
    try {
      await callAdmin(secret, { action: 'create_game_set', name: newSetName.trim() });
      setNewSetName('');
      await loadGameSets();
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
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to toggle', true);
    } finally {
      setBusy(null);
    }
  };

  // ── Reorder (move up/down) ────────────────────────────────────────────────

  const handleMove = async (gsq: GameSetQuestionRecord, direction: 'up' | 'down') => {
    if (!selectedGameSet) return;
    const idx = gsQuestions.findIndex((q) => q.id === gsq.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= gsQuestions.length) return;

    const newOrder = [...gsQuestions];
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    setGsQuestions(newOrder); // optimistic

    setBusy(`move-${gsq.id}`);
    try {
      await callAdmin(secret, {
        action: 'reorder_game_set_questions',
        game_set_id: selectedGameSet.id,
        ordered_ids: newOrder.map((q) => q.id),
      });
      await loadGSQ(selectedGameSet.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Reorder failed', true);
      await loadGSQ(selectedGameSet.id); // revert
    } finally {
      setBusy(null);
    }
  };

  // ── Edit row (inline) ─────────────────────────────────────────────────────

  const startEdit = (gsq: GameSetQuestionRecord) => {
    setEditingRow({
      id: gsq.id,
      time_limit_seconds: String(gsq.time_limit_seconds),
      max_score: String(gsq.max_score),
      min_correct_score: String(gsq.min_correct_score),
      circle_radius_ratio: String(gsq.circle_radius_ratio),
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
      });
      setEditingRow(null);
      await loadGSQ(selectedGameSet.id);
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
      for (const qid of selectedBankIds) {
        await callAdmin(secret, {
          action: 'add_question_to_game_set',
          game_set_id: selectedGameSet.id,
          question_id: qid,
        });
      }
      setView('set_detail');
      await loadGSQ(selectedGameSet.id);
      await loadGameSets();
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
          onMove={handleMove}
          onStartEdit={startEdit}
          onEditChange={(field, val) => setEditingRow((prev) => prev ? { ...prev, [field]: val } : null)}
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
          onSelectAll={() => setSelectedBankIds(new Set(bankQuestions.map((q) => q.id)))}
          onClearAll={() => setSelectedBankIds(new Set())}
          onAdd={handleAddSelected}
          onBack={() => setView('set_detail')}
        />
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(5,8,16,.88)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, zIndex: 300, backdropFilter: 'blur(6px)',
        }}>
          <div className="gr-card" style={{ width: '100%', maxWidth: 300, padding: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--rose)', marginBottom: 10 }}>
              Delete Game Set?
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 18, lineHeight: 1.6 }}>
              This will permanently delete this Game Set and all its question slots. Question Bank content is not affected.
            </p>
            <div style={{ display: 'flex', gap: 9 }}>
              <button onClick={() => setConfirmDelete(null)} className="gr-btn gr-btn-ghost" style={{ padding: '10px', fontSize: 13 }}>
                Cancel
              </button>
              <button
                onClick={() => handleDeleteGameSet(confirmDelete)}
                disabled={busy !== null}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 12, border: 'none',
                  background: '#be123c', color: 'white',
                  fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Game Sets List View ───────────────────────────────────────────────────────

function GameSetsListView({
  gameSets, loading, busy, newSetName, confirmDelete,
  onNewSetNameChange, onCreateSet, onOpenSet, onSetActive,
  onConfirmDelete, onDeleteSet, onRefresh,
}: {
  gameSets: GameSetRecord[];
  loading: boolean;
  busy: string | null;
  newSetName: string;
  confirmDelete: string | null;
  onNewSetNameChange: (v: string) => void;
  onCreateSet: () => void;
  onOpenSet: (gs: GameSetRecord) => void;
  onSetActive: (id: string) => void;
  onConfirmDelete: (id: string | null) => void;
  onDeleteSet: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <>
      {/* Create new */}
      <div className="gr-card-strong" style={{ padding: 16 }}>
        <div className="gr-label-xs" style={{ marginBottom: 10 }}>Create New Game Set</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newSetName}
            onChange={(e) => onNewSetNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreateSet()}
            placeholder="Game Set name…"
            className="gr-input"
            style={{ flex: 1, fontSize: 13 }}
          />
          <button
            onClick={onCreateSet}
            disabled={!newSetName.trim() || busy !== null}
            className="gr-btn gr-btn-gold"
            style={{ fontSize: 13, padding: '10px 16px', flexShrink: 0 }}
          >
            {busy === 'create' ? '…' : '+ Create'}
          </button>
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
          <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)', border: '1px dashed rgba(255,255,255,.1)', borderRadius: 12 }}>
            No Game Sets yet. Create one above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {gameSets.map((gs) => (
              <div
                key={gs.id}
                className="gr-card"
                style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{gs.name}</span>
                    <StatusBadge status={gs.status} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {gs.enabled_question_count}/{gs.question_count} questions enabled
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => onOpenSet(gs)}
                    className="gr-hbtn"
                    style={{ fontSize: 11, padding: '6px 10px' }}
                  >
                    Edit
                  </button>
                  {gs.status !== 'active' && (
                    <button
                      onClick={() => onSetActive(gs.id)}
                      disabled={busy !== null}
                      className="gr-hbtn"
                      style={{ fontSize: 11, padding: '6px 10px', borderColor: 'rgba(245,199,74,.3)', color: 'var(--gold)' }}
                    >
                      {busy === `active-${gs.id}` ? '…' : 'Set Active'}
                    </button>
                  )}
                  <button
                    onClick={() => onConfirmDelete(gs.id)}
                    disabled={busy !== null}
                    className="gr-hbtn gr-hbtn-danger"
                    style={{ fontSize: 11, padding: '6px 10px' }}
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
  onMove, onStartEdit, onEditChange, onSaveEdit, onCancelEdit,
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
  onMove: (gsq: GameSetQuestionRecord, dir: 'up' | 'down') => void;
  onStartEdit: (gsq: GameSetQuestionRecord) => void;
  onEditChange: (field: keyof EditingRow, val: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}) {
  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          style={{ fontSize: 13, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', padding: 0 }}
        >
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
          <button
            onClick={onSetActive}
            disabled={busy !== null}
            className="gr-btn gr-btn-gold"
            style={{ fontSize: 12, padding: '8px 14px', flexShrink: 0 }}
          >
            {busy?.startsWith('active') ? '…' : 'Set Active'}
          </button>
        )}
      </div>

      {/* Info box */}
      {gameSet.status === 'active' && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 12, background: 'rgba(245,199,74,.07)', border: '1px solid rgba(245,199,74,.2)', color: 'var(--gold)' }}>
          ✓ This is the active Game Set. Host navigation uses these questions in this order.
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onOpenPicker}
          disabled={busy !== null}
          className="gr-btn gr-btn-gold"
          style={{ fontSize: 12, padding: '9px 14px' }}
        >
          + Add Questions from Bank
        </button>
      </div>

      {/* Questions table */}
      {questions.length === 0 ? (
        <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)', border: '1px dashed rgba(255,255,255,.1)', borderRadius: 12 }}>
          No questions selected yet. Add questions from Question Bank.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Column header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '28px 60px 1fr 60px 70px 70px 60px 50px 80px',
            gap: 6, padding: '6px 10px',
            fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
            color: 'var(--text-3)', textTransform: 'uppercase',
          }}>
            <span>#</span>
            <span>Preview</span>
            <span>Question</span>
            <span>Time</span>
            <span>Max</span>
            <span>Min</span>
            <span>Circle</span>
            <span>On</span>
            <span>Actions</span>
          </div>

          {questions.map((gsq, idx) => {
            const isEditing = editingRow?.id === gsq.id;
            const isBusy = busy === `remove-${gsq.id}` || busy === `toggle-${gsq.id}` ||
              busy === `move-${gsq.id}` || busy === `save-${gsq.id}`;

            return (
              <div
                key={gsq.id}
                className="gr-card"
                style={{
                  padding: '10px 10px',
                  opacity: gsq.is_enabled ? 1 : 0.5,
                  display: 'grid',
                  gridTemplateColumns: '28px 60px 1fr 60px 70px 70px 60px 50px 80px',
                  gap: 6,
                  alignItems: 'center',
                }}
              >
                {/* Play order */}
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-2)' }}>{gsq.play_order}</span>

                {/* Preview */}
                <div style={{ width: 52, height: 36, borderRadius: 7, overflow: 'hidden', background: 'rgba(0,0,0,.4)', flexShrink: 0 }}>
                  <img
                    src={resolveQuestionImageUrl(gsq.question_image_url)}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>

                {/* Question text */}
                <span
                  title={gsq.question_text}
                  style={{
                    fontSize: 11, color: 'var(--text)', lineHeight: 1.4,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}
                >
                  {gsq.question_text}
                </span>

                {/* Editable fields */}
                {isEditing ? (
                  <>
                    <SmallInput label="s" value={editingRow!.time_limit_seconds} onChange={(v) => onEditChange('time_limit_seconds', v)} />
                    <SmallInput label="pts" value={editingRow!.max_score} onChange={(v) => onEditChange('max_score', v)} />
                    <SmallInput label="pts" value={editingRow!.min_correct_score} onChange={(v) => onEditChange('min_correct_score', v)} />
                    <SmallInput label="" value={editingRow!.circle_radius_ratio} onChange={(v) => onEditChange('circle_radius_ratio', v)} />
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{gsq.time_limit_seconds}s</span>
                    <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{gsq.max_score}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{gsq.min_correct_score}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{gsq.circle_radius_ratio}</span>
                  </>
                )}

                {/* Enabled toggle */}
                <button
                  onClick={() => onToggleEnabled(gsq)}
                  disabled={isBusy}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 16, opacity: isBusy ? 0.5 : 1,
                    color: gsq.is_enabled ? 'var(--emerald)' : 'var(--text-3)',
                  }}
                  title={gsq.is_enabled ? 'Disable' : 'Enable'}
                >
                  {gsq.is_enabled ? '✓' : '○'}
                </button>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {isEditing ? (
                    <>
                      <MiniBtn onClick={onSaveEdit} disabled={isBusy} gold>Save</MiniBtn>
                      <MiniBtn onClick={onCancelEdit} disabled={isBusy}>✕</MiniBtn>
                    </>
                  ) : (
                    <>
                      <MiniBtn onClick={() => onStartEdit(gsq)} disabled={isBusy}>Edit</MiniBtn>
                      <MiniBtn onClick={() => onMove(gsq, 'up')} disabled={isBusy || idx === 0}>↑</MiniBtn>
                      <MiniBtn onClick={() => onMove(gsq, 'down')} disabled={isBusy || idx === questions.length - 1}>↓</MiniBtn>
                      <MiniBtn onClick={() => onRemove(gsq.id)} disabled={isBusy} danger>×</MiniBtn>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.6 }}>
        These values are the actual runtime values for this Game Set only.<br />
        Changing Question Bank defaults after this point will NOT affect this Game Set.
      </div>
    </>
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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={onSelectAll} className="gr-hbtn" style={{ fontSize: 11, padding: '6px 10px' }}>Select All</button>
        <button onClick={onClearAll} className="gr-hbtn" style={{ fontSize: 11, padding: '6px 10px' }}>Clear</button>
        <button
          onClick={onAdd}
          disabled={selectedIds.size === 0 || busy === 'add-questions'}
          className="gr-btn gr-btn-gold"
          style={{ fontSize: 12, padding: '8px 14px', marginLeft: 'auto' }}
        >
          {busy === 'add-questions' ? 'Adding…' : `Add ${selectedIds.size > 0 ? selectedIds.size : ''} to Game Set`}
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: -6 }}>
        Snapshot values will be copied from the Question Bank defaults at time of adding.
      </div>

      {/* Question list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {questions.map((q) => {
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
                <img src={resolveQuestionImageUrl(q.image_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4, marginBottom: 2 }}>{q.text}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  {q.time_limit_seconds}s · {q.max_score} pts · circle {q.circle_radius_ratio}
                  {!q.is_published && ' · draft'}
                </div>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                #{q.order_index}
              </span>
            </button>
          );
        })}
      </div>
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

function SmallInput({
  value, onChange, label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', fontSize: 11, padding: '4px 6px',
          borderRadius: 7, border: '1px solid rgba(245,199,74,.4)',
          background: 'rgba(0,0,0,.3)', color: 'var(--text)',
          fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
        }}
      />
      {label && (
        <span style={{
          position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
          fontSize: 9, color: 'var(--text-3)', pointerEvents: 'none',
        }}>
          {label}
        </span>
      )}
    </div>
  );
}
