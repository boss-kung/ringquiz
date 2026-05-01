import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { FUNCTIONS_URL } from '../../lib/supabase';
import {
  getLocalImageDimensions,
  resolveQuestionImageUrl,
  resolveRevealImageUrl,
} from '../../lib/questionAssets';
import {
  parseBulkQuestionJson,
  validateAdminQuestionInput,
  validateBulkAdminQuestionInputs,
} from '../../lib/adminQuestionValidation';
import type {
  AdminQuestionPreviewItem,
  AdminQuestionRecord,
  AdminQuestionRequest,
  AdminQuestionResponse,
  AdminQuestionValidationIssue,
  AdminUploadAssetsResponse,
} from '../../lib/adminTypes';

type AdminTab = 'manual' | 'bulk' | 'bank';
type EditorMode = 'create' | 'edit';

type EditorFormState = {
  text: string;
  image_url: string;
  mask_storage_path: string;
  reveal_image_url: string;
  circle_radius_ratio: string;
  time_limit_seconds: string;
  max_score: string;
  min_correct_score: string;
  image_width: string;
  image_height: string;
  mask_width: string;
  mask_height: string;
  order_index: string;
  is_published: boolean;
};

type AssetFilesState = {
  imageFile: File | null;
  maskFile: File | null;
  revealFile: File | null;
};

const DEFAULT_EDITOR_FORM: EditorFormState = {
  text: '',
  image_url: '',
  mask_storage_path: '',
  reveal_image_url: '',
  circle_radius_ratio: '0.1',
  time_limit_seconds: '30',
  max_score: '1000',
  min_correct_score: '100',
  image_width: '',
  image_height: '',
  mask_width: '',
  mask_height: '',
  order_index: '',
  is_published: true,
};

const EMPTY_ASSET_FILES: AssetFilesState = {
  imageFile: null,
  maskFile: null,
  revealFile: null,
};

const BULK_IMPORT_EXAMPLE = `[
  {
    "text": "Tap the elephant in the image",
    "image_url": "11111111-1111-1111-1111-111111111111.jpg",
    "mask_storage_path": "11111111-1111-1111-1111-111111111111_mask.png",
    "circle_radius_ratio": 0.1,
    "time_limit_seconds": 20,
    "max_score": 1000,
    "min_correct_score": 100,
    "image_width": 1920,
    "image_height": 1080,
    "mask_width": 1920,
    "mask_height": 1080,
    "is_published": true
  }
]`;

async function callAdminQuestionAction(
  secret: string,
  body: AdminQuestionRequest,
): Promise<AdminQuestionResponse> {
  const response = await fetch(`${FUNCTIONS_URL}/admin-question-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Host-Secret': secret,
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  if (!response.ok) {
    const detail = typeof json?.detail === 'string' ? `: ${json.detail}` : '';
    throw new Error(`${json?.error ?? 'Request failed'}${detail}`);
  }

  return json as AdminQuestionResponse;
}

async function uploadQuestionAssets(
  secret: string,
  form: EditorFormState,
  files: AssetFilesState,
): Promise<AdminUploadAssetsResponse> {
  if (!files.imageFile || !files.maskFile) {
    throw new Error('Select both an image file and a mask file before uploading.');
  }

  const body = new FormData();
  body.set('action', 'upload_assets');
  body.set('image_file', files.imageFile);
  body.set('mask_file', files.maskFile);
  if (files.revealFile) body.set('reveal_file', files.revealFile);
  body.set('image_width', form.image_width);
  body.set('image_height', form.image_height);
  body.set('mask_width', form.mask_width);
  body.set('mask_height', form.mask_height);

  const response = await fetch(`${FUNCTIONS_URL}/admin-question-action`, {
    method: 'POST',
    headers: {
      'X-Host-Secret': secret,
    },
    body,
  });

  const json = await response.json();
  if (!response.ok) {
    const detail = typeof json?.detail === 'string' ? `: ${json.detail}` : '';
    throw new Error(`${json?.error ?? 'Upload failed'}${detail}`);
  }

  return json as AdminUploadAssetsResponse;
}

function normalizeEditorForm(form: EditorFormState): Record<string, unknown> {
  return {
    ...form,
    reveal_image_url: form.reveal_image_url.trim() || null,
    order_index: form.order_index.trim() || undefined,
  };
}

function mergeUploadedAssetsIntoForm(
  form: EditorFormState,
  uploaded: AdminUploadAssetsResponse,
): EditorFormState {
  return {
    ...form,
    image_url: uploaded.image_url,
    mask_storage_path: uploaded.mask_storage_path,
    reveal_image_url: uploaded.reveal_image_url ?? '',
    image_width: String(uploaded.image_width),
    image_height: String(uploaded.image_height),
    mask_width: String(uploaded.mask_width),
    mask_height: String(uploaded.mask_height),
  };
}

function questionToForm(question: AdminQuestionRecord): EditorFormState {
  return {
    text: question.text,
    image_url: question.image_url,
    mask_storage_path: question.mask_storage_path,
    reveal_image_url: question.reveal_image_url ?? '',
    circle_radius_ratio: String(question.circle_radius_ratio),
    time_limit_seconds: String(question.time_limit_seconds),
    max_score: String(question.max_score),
    min_correct_score: String(question.min_correct_score),
    image_width: question.image_width ? String(question.image_width) : '',
    image_height: question.image_height ? String(question.image_height) : '',
    mask_width: question.mask_width ? String(question.mask_width) : '',
    mask_height: question.mask_height ? String(question.mask_height) : '',
    order_index: String(question.order_index),
    is_published: question.is_published,
  };
}

function issuesToFieldMap(issues: AdminQuestionValidationIssue[]): Record<string, string> {
  return issues.reduce<Record<string, string>>((acc, issue) => {
    if (!acc[issue.field]) acc[issue.field] = issue.message;
    return acc;
  }, {});
}

export function AdminQuestionManager({ secret }: { secret: string }) {
  const [activeTab, setActiveTab] = useState<AdminTab>('manual');
  const [questions, setQuestions] = useState<AdminQuestionRecord[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankError, setBankError] = useState('');
  const [bankMessage, setBankMessage] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [editorMode, setEditorMode] = useState<EditorMode>('create');
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editorForm, setEditorForm] = useState<EditorFormState>(DEFAULT_EDITOR_FORM);
  const [assetFiles, setAssetFiles] = useState<AssetFilesState>(EMPTY_ASSET_FILES);
  const [editorErrors, setEditorErrors] = useState<Record<string, string>>({});
  const [editorMessage, setEditorMessage] = useState('');
  const [editorError, setEditorError] = useState('');

  const [bulkText, setBulkText] = useState(BULK_IMPORT_EXAMPLE);
  const [bulkPreview, setBulkPreview] = useState<AdminQuestionPreviewItem[]>([]);
  const [bulkGlobalErrors, setBulkGlobalErrors] = useState<string[]>([]);
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkError, setBulkError] = useState('');

  const loadQuestions = useCallback(async () => {
    setBankLoading(true);
    setBankError('');

    try {
      const response = await callAdminQuestionAction(secret, { action: 'list_questions' });
      setQuestions(response.questions ?? []);
    } catch (error) {
      setBankError(error instanceof Error ? error.message : 'Failed to load questions.');
    } finally {
      setBankLoading(false);
    }
  }, [secret]);

  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions]);

  const resetEditor = useCallback(() => {
    setEditorMode('create');
    setEditingQuestionId(null);
    setEditorForm(DEFAULT_EDITOR_FORM);
    setAssetFiles(EMPTY_ASSET_FILES);
    setEditorErrors({});
    setEditorMessage('');
    setEditorError('');
  }, []);

  const handleEditorFieldChange = <K extends keyof EditorFormState>(
    field: K,
    value: EditorFormState[K],
  ) => {
    setEditorForm((current) => ({ ...current, [field]: value }));
    setEditorErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setEditorError('');
    setEditorMessage('');
  };

  const applyDetectedDimensions = async (
    kind: 'imageFile' | 'maskFile' | 'revealFile',
    file: File | null,
  ) => {
    setAssetFiles((current) => ({ ...current, [kind]: file }));
    setEditorError('');
    setEditorMessage('');

    if (!file || kind === 'revealFile') return;

    try {
      const dimensions = await getLocalImageDimensions(file);
      setEditorForm((current) => ({
        ...current,
        ...(kind === 'imageFile'
          ? {
              image_width: String(dimensions.width),
              image_height: String(dimensions.height),
            }
          : {
              mask_width: String(dimensions.width),
              mask_height: String(dimensions.height),
            }),
      }));
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Failed to read file dimensions.');
    }
  };

  const handleFileInputChange = (
    kind: 'imageFile' | 'maskFile' | 'revealFile',
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0] ?? null;
    void applyDetectedDimensions(kind, file);
  };

  const handleUploadAssets = async () => {
    if (!assetFiles.imageFile || !assetFiles.maskFile) {
      setEditorError('Select both the image file and the mask file first.');
      return;
    }

    if (
      editorForm.image_width &&
      editorForm.mask_width &&
      editorForm.image_height &&
      editorForm.mask_height &&
      (editorForm.image_width !== editorForm.mask_width || editorForm.image_height !== editorForm.mask_height)
    ) {
      setEditorError('Image and mask dimensions must match.');
      return;
    }

    setBusyAction('asset-upload');
    setEditorError('');
    setEditorMessage('');

    try {
      const response = await uploadQuestionAssets(secret, editorForm, assetFiles);
      setEditorForm((current) => ({
        ...current,
        image_url: response.image_url,
        mask_storage_path: response.mask_storage_path,
        reveal_image_url: response.reveal_image_url ?? '',
        image_width: String(response.image_width),
        image_height: String(response.image_height),
        mask_width: String(response.mask_width),
        mask_height: String(response.mask_height),
      }));
      setEditorMessage('Files uploaded. You can save the question now.');
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Asset upload failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveQuestion = async () => {
    setEditorError('');
    setEditorMessage('');

    let nextForm = editorForm;
    const hasSelectedUploadFiles = !!assetFiles.imageFile || !!assetFiles.maskFile || !!assetFiles.revealFile;
    const isMissingRequiredAssetPaths = !editorForm.image_url.trim() || !editorForm.mask_storage_path.trim();

    if (hasSelectedUploadFiles) {
      if (!assetFiles.imageFile || !assetFiles.maskFile) {
        setEditorError('Select both the image file and the mask file before saving.');
        return;
      }

      if (
        !editorForm.image_width ||
        !editorForm.image_height ||
        !editorForm.mask_width ||
        !editorForm.mask_height
      ) {
        setEditorError('Please wait for the image and mask dimensions to be detected before saving.');
        return;
      }

      if (
        editorForm.image_width !== editorForm.mask_width ||
        editorForm.image_height !== editorForm.mask_height
      ) {
        setEditorError('Image and mask dimensions must match.');
        return;
      }

      setBusyAction('question-save');
      try {
        const uploaded = await uploadQuestionAssets(secret, editorForm, assetFiles);
        nextForm = mergeUploadedAssetsIntoForm(editorForm, uploaded);
        setEditorForm(nextForm);
        setEditorMessage('Files uploaded. Saving question…');
      } catch (error) {
        setBusyAction(null);
        setEditorError(error instanceof Error ? error.message : 'Asset upload failed.');
        return;
      }
    } else if (isMissingRequiredAssetPaths) {
      setEditorError('Choose image and mask files from your computer, or use an existing uploaded asset set.');
      return;
    }

    const validation = validateAdminQuestionInput(normalizeEditorForm(nextForm));
    if (!validation.normalizedQuestion || validation.errors.length > 0) {
      setEditorErrors(issuesToFieldMap(validation.errors));
      setEditorError('Please fix the highlighted fields before saving.');
      return;
    }

    setBusyAction('question-save');
    try {
      const action = editorMode === 'create' ? 'create_question' : 'update_question';
      const response = await callAdminQuestionAction(secret, {
        action,
        ...(editingQuestionId ? { question_id: editingQuestionId } : {}),
        question: validation.normalizedQuestion,
      });

      await loadQuestions();
      if (editorMode === 'edit' && response.question) {
        setEditorForm(questionToForm(response.question));
        setEditingQuestionId(response.question.id);
      } else {
        resetEditor();
      }

      setActiveTab('bank');
      setBankMessage(editorMode === 'create' ? 'Question created.' : 'Question updated.');
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Failed to save question.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleStartEdit = (question: AdminQuestionRecord) => {
    setEditorMode('edit');
    setEditingQuestionId(question.id);
    setEditorForm(questionToForm(question));
    setAssetFiles(EMPTY_ASSET_FILES);
    setEditorErrors({});
    setEditorError('');
    setEditorMessage('Editing existing question. Upload replacement files only if you want to change assets.');
    setActiveTab('manual');
  };

  const handleBulkValidate = () => {
    setBulkMessage('');
    setBulkError('');
    const parsed = parseBulkQuestionJson(bulkText);
    if (parsed.error) {
      setBulkGlobalErrors([parsed.error]);
      setBulkPreview([]);
      return;
    }

    const validation = validateBulkAdminQuestionInputs(parsed.parsed);
    setBulkGlobalErrors(validation.globalErrors);
    setBulkPreview(validation.items);
  };

  const handleBulkSave = async () => {
    setBulkMessage('');
    setBulkError('');
    const parsed = parseBulkQuestionJson(bulkText);
    if (parsed.error) {
      setBulkGlobalErrors([parsed.error]);
      return;
    }

    const validation = validateBulkAdminQuestionInputs(parsed.parsed);
    setBulkGlobalErrors(validation.globalErrors);
    setBulkPreview(validation.items);

    if (validation.globalErrors.length > 0 || validation.items.some((item) => !item.valid) || validation.validQuestions.length === 0) {
      setBulkError('Fix all invalid rows before saving.');
      return;
    }

    setBusyAction('bulk-save');
    try {
      const response = await callAdminQuestionAction(secret, {
        action: 'bulk_create_questions',
        questions: validation.validQuestions,
      });
      setBulkMessage(`Saved ${response.created_count ?? validation.validQuestions.length} questions successfully.`);
      await loadQuestions();
      setBankMessage('Question bank refreshed after bulk import.');
      setActiveTab('bank');
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : 'Bulk save failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    const confirmed = window.confirm('Delete this question and its uploaded assets? This cannot be undone.');
    if (!confirmed) return;

    setBusyAction(`delete-${questionId}`);
    setBankError('');
    setBankMessage('');

    try {
      await callAdminQuestionAction(secret, {
        action: 'delete_question',
        question_id: questionId,
      });
      setQuestions((current) => current.filter((question) => question.id !== questionId));
      setBankMessage('Question deleted.');
      if (editingQuestionId === questionId) resetEditor();
    } catch (error) {
      setBankError(error instanceof Error ? error.message : 'Delete failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleTogglePublish = async (question: AdminQuestionRecord) => {
    setBusyAction(`publish-${question.id}`);
    setBankError('');
    setBankMessage('');

    try {
      const response = await callAdminQuestionAction(secret, {
        action: question.is_published ? 'unpublish_question' : 'publish_question',
        question_id: question.id,
      });
      if (response.question) {
        setQuestions((current) =>
          current.map((item) => (item.id === question.id ? response.question! : item)),
        );
      }
      setBankMessage(question.is_published ? 'Question unpublished.' : 'Question published.');
    } catch (error) {
      setBankError(error instanceof Error ? error.message : 'Publish toggle failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleMoveQuestion = async (
    question: AdminQuestionRecord,
    direction: 'up' | 'down',
  ) => {
    setBusyAction(`move-${question.id}-${direction}`);
    setBankError('');
    setBankMessage('');

    try {
      await callAdminQuestionAction(secret, {
        action: 'move_question',
        question_id: question.id,
        direction,
      });
      await loadQuestions();
      setBankMessage(`Question moved ${direction}.`);
    } catch (error) {
      setBankError(error instanceof Error ? error.message : 'Reorder failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const validCount = useMemo(() => bulkPreview.filter((item) => item.valid).length, [bulkPreview]);
  const invalidCount = bulkPreview.length - validCount;

  return (
    <div className="bg-slate-800 rounded-2xl border border-white/10 p-4 space-y-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xl font-bold text-white">Question Upload</h2>
          <button
            type="button"
            onClick={() => { void loadQuestions(); }}
            disabled={bankLoading || busyAction !== null}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
          >
            {bankLoading ? 'Refreshing…' : 'Refresh Bank'}
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Manual mode now supports file upload from this computer. The system reads image and mask dimensions for you,
          and the dimension fields are kept read-only as a validation checkpoint.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-900/50 p-1">
        <TabButton label="Manual Add" active={activeTab === 'manual'} onClick={() => setActiveTab('manual')} />
        <TabButton label="Bulk Import" active={activeTab === 'bulk'} onClick={() => setActiveTab('bulk')} />
        <TabButton label="Question Bank" active={activeTab === 'bank'} onClick={() => setActiveTab('bank')} />
      </div>

      {activeTab === 'manual' && (
        <div className="space-y-4">
          {editorError && <FeedbackBox tone="error" message={editorError} />}
          {editorMessage && <FeedbackBox tone="success" message={editorMessage} />}

          <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-900/40 px-4 py-3">
            <div>
              <p className="font-semibold text-white">
                {editorMode === 'create' ? 'Create Question' : 'Edit Question'}
              </p>
              <p className="text-sm text-slate-400">
                {editorMode === 'create'
                  ? 'Upload assets, then save the question metadata.'
                  : 'Update text/timing/score, or upload replacement assets before saving.'}
              </p>
            </div>
            {editorMode === 'edit' && (
              <button
                type="button"
                onClick={resetEditor}
                className="rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-200"
              >
                New Question
              </button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FieldBlock
              label="Question Text"
              error={editorErrors.text}
              fullWidth
              input={(
                <textarea
                  value={editorForm.text}
                  onChange={(event) => handleEditorFieldChange('text', event.target.value)}
                  rows={4}
                  className={inputClassName(!!editorErrors.text)}
                  placeholder="What should players tap?"
                />
              )}
            />
            <FilePicker
              label="Question image"
              file={assetFiles.imageFile}
              onChange={(event) => handleFileInputChange('imageFile', event)}
            />
            <FilePicker
              label="Mask image"
              file={assetFiles.maskFile}
              onChange={(event) => handleFileInputChange('maskFile', event)}
            />
            <FilePicker
              label="Reveal image (optional)"
              file={assetFiles.revealFile}
              onChange={(event) => handleFileInputChange('revealFile', event)}
            />
            <FieldBlock
              label="Uploaded image path"
              error={editorErrors.image_url}
              fullWidth
              input={(
                <input
                  value={editorForm.image_url}
                  readOnly
                  className={inputClassName(!!editorErrors.image_url, true)}
                  placeholder="Upload files to populate this path"
                />
              )}
            />
            <FieldBlock
              label="Mask storage path"
              error={editorErrors.mask_storage_path}
              fullWidth
              input={(
                <input
                  value={editorForm.mask_storage_path}
                  readOnly
                  className={inputClassName(!!editorErrors.mask_storage_path, true)}
                  placeholder="Upload files to populate this path"
                />
              )}
            />
            <FieldBlock
              label="Reveal image path"
              error={editorErrors.reveal_image_url}
              fullWidth
              input={(
                <input
                  value={editorForm.reveal_image_url}
                  readOnly
                  className={inputClassName(!!editorErrors.reveal_image_url, true)}
                  placeholder="Optional"
                />
              )}
            />
            <FieldBlock
              label="Circle radius ratio"
              error={editorErrors.circle_radius_ratio}
              input={(
                <input
                  value={editorForm.circle_radius_ratio}
                  onChange={(event) => handleEditorFieldChange('circle_radius_ratio', event.target.value)}
                  className={inputClassName(!!editorErrors.circle_radius_ratio)}
                  placeholder="0.10"
                />
              )}
            />
            <FieldBlock
              label="Time limit (seconds)"
              error={editorErrors.time_limit_seconds}
              input={(
                <input
                  value={editorForm.time_limit_seconds}
                  onChange={(event) => handleEditorFieldChange('time_limit_seconds', event.target.value)}
                  className={inputClassName(!!editorErrors.time_limit_seconds)}
                  placeholder="30"
                />
              )}
            />
            <FieldBlock
              label="Max score"
              error={editorErrors.max_score}
              input={(
                <input
                  value={editorForm.max_score}
                  onChange={(event) => handleEditorFieldChange('max_score', event.target.value)}
                  className={inputClassName(!!editorErrors.max_score)}
                  placeholder="1000"
                />
              )}
            />
            <FieldBlock
              label="Minimum correct score"
              error={editorErrors.min_correct_score}
              input={(
                <input
                  value={editorForm.min_correct_score}
                  onChange={(event) => handleEditorFieldChange('min_correct_score', event.target.value)}
                  className={inputClassName(!!editorErrors.min_correct_score)}
                  placeholder="100"
                />
              )}
            />
            <FieldBlock
              label="Image width"
              error={editorErrors.image_width}
              input={(
                <input
                  value={editorForm.image_width}
                  readOnly
                  className={inputClassName(!!editorErrors.image_width, true)}
                  placeholder="Detected automatically"
                />
              )}
            />
            <FieldBlock
              label="Image height"
              error={editorErrors.image_height}
              input={(
                <input
                  value={editorForm.image_height}
                  readOnly
                  className={inputClassName(!!editorErrors.image_height, true)}
                  placeholder="Detected automatically"
                />
              )}
            />
            <FieldBlock
              label="Mask width"
              error={editorErrors.mask_width}
              input={(
                <input
                  value={editorForm.mask_width}
                  readOnly
                  className={inputClassName(!!editorErrors.mask_width, true)}
                  placeholder="Detected automatically"
                />
              )}
            />
            <FieldBlock
              label="Mask height"
              error={editorErrors.mask_height}
              input={(
                <input
                  value={editorForm.mask_height}
                  readOnly
                  className={inputClassName(!!editorErrors.mask_height, true)}
                  placeholder="Detected automatically"
                />
              )}
            />
            <FieldBlock
              label="Order index (optional)"
              error={editorErrors.order_index}
              input={(
                <input
                  value={editorForm.order_index}
                  onChange={(event) => handleEditorFieldChange('order_index', event.target.value)}
                  className={inputClassName(!!editorErrors.order_index)}
                  placeholder={editorMode === 'create' ? 'Auto-assign next slot' : 'Keep current order'}
                />
              )}
            />
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={editorForm.is_published}
              onChange={(event) => handleEditorFieldChange('is_published', event.target.checked)}
            />
            Publish immediately
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => { void handleUploadAssets(); }}
              disabled={busyAction !== null}
              className="rounded-xl bg-white/10 px-4 py-3 font-semibold text-white disabled:opacity-50"
            >
              {busyAction === 'asset-upload' ? 'Uploading…' : 'Upload Selected Files'}
            </button>
            <button
              type="button"
              onClick={() => { void handleSaveQuestion(); }}
              disabled={busyAction !== null}
              className="rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-50"
            >
              {busyAction === 'question-save'
                ? 'Saving…'
                : editorMode === 'create'
                  ? 'Save Question'
                  : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'bulk' && (
        <div className="space-y-4">
          {bulkError && <FeedbackBox tone="error" message={bulkError} />}
          {bulkMessage && <FeedbackBox tone="success" message={bulkMessage} />}
          {bulkGlobalErrors.length > 0 && <FeedbackBox tone="error" message={bulkGlobalErrors.join(' ')} />}

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-200">Paste JSON array</p>
            <textarea
              value={bulkText}
              onChange={(event) => {
                setBulkText(event.target.value);
                setBulkMessage('');
                setBulkError('');
              }}
              rows={14}
              className={inputClassName(false)}
            />
            <p className="text-xs text-slate-400">
              Bulk import still assumes the assets already exist in Supabase Storage, so each row should include
              both `image_url` and `mask_storage_path`.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleBulkValidate}
              disabled={busyAction !== null}
              className="flex-1 rounded-xl bg-white/10 px-4 py-3 font-semibold text-white disabled:opacity-50"
            >
              Validate & Preview
            </button>
            <button
              type="button"
              onClick={() => { void handleBulkSave(); }}
              disabled={busyAction !== null}
              className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-50"
            >
              {busyAction === 'bulk-save' ? 'Saving…' : 'Save Valid Questions'}
            </button>
          </div>

          {bulkPreview.length > 0 && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <StatCard label="Valid" value={String(validCount)} tone="success" />
                <StatCard label="Invalid" value={String(invalidCount)} tone="error" />
                <StatCard label="Total" value={String(bulkPreview.length)} />
              </div>

              <div className="space-y-3">
                {bulkPreview.map((item) => (
                  <div
                    key={item.index}
                    className={`rounded-xl border px-4 py-3 ${
                      item.valid
                        ? 'border-emerald-500/30 bg-emerald-900/10'
                        : 'border-red-500/30 bg-red-900/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-white">Row {item.index + 1}</p>
                      <span className={`text-xs font-bold uppercase tracking-wide ${
                        item.valid ? 'text-emerald-300' : 'text-red-300'
                      }`}>
                        {item.valid ? 'Valid' : 'Invalid'}
                      </span>
                    </div>

                    {item.normalizedQuestion && (
                      <div className="mt-2 space-y-1 text-sm text-slate-200">
                        <p>{item.normalizedQuestion.text}</p>
                        <p className="text-slate-400">
                          order {item.normalizedQuestion.order_index ?? 'auto'} • time {item.normalizedQuestion.time_limit_seconds}s •
                          score {item.normalizedQuestion.min_correct_score}-{item.normalizedQuestion.max_score}
                        </p>
                        <p className="text-slate-400">
                          image {item.normalizedQuestion.image_width}×{item.normalizedQuestion.image_height} •
                          file {item.normalizedQuestion.image_url}
                        </p>
                      </div>
                    )}

                    {item.errors.length > 0 && (
                      <div className="mt-2 space-y-1 text-sm text-red-200">
                        {item.errors.map((error, index) => (
                          <p key={`${item.index}-${error.field}-${index}`}>• {error.message}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'bank' && (
        <div className="space-y-4">
          {bankError && <FeedbackBox tone="error" message={bankError} />}
          {bankMessage && <FeedbackBox tone="success" message={bankMessage} />}

          {bankLoading ? (
            <div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-6 text-center text-slate-300">
              Loading questions…
            </div>
          ) : questions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-slate-900/40 px-4 py-6 text-center text-slate-400">
              No saved questions yet.
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((question) => (
                <div
                  key={question.id}
                  className="rounded-xl border border-white/10 bg-slate-900/40 p-4 space-y-3"
                >
                  <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
                    <div className="space-y-2">
                      <img
                        src={resolveQuestionImageUrl(question.image_url)}
                        alt={question.text}
                        className="h-28 w-full rounded-lg object-cover bg-slate-950"
                      />
                      {question.reveal_image_url && (
                        <img
                          src={resolveRevealImageUrl(question.reveal_image_url) ?? undefined}
                          alt=""
                          className="h-20 w-full rounded-lg object-cover bg-slate-950"
                        />
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="rounded-full bg-indigo-500/20 px-2 py-1 text-xs font-semibold text-indigo-200">
                              Order {question.order_index}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => { void handleMoveQuestion(question, 'up'); }}
                                disabled={busyAction !== null || question.order_index === questions[0]?.order_index}
                                className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-slate-200 disabled:opacity-40"
                                aria-label={`Move question ${question.order_index} up`}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => { void handleMoveQuestion(question, 'down'); }}
                                disabled={busyAction !== null || question.order_index === questions[questions.length - 1]?.order_index}
                                className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-slate-200 disabled:opacity-40"
                                aria-label={`Move question ${question.order_index} down`}
                              >
                                ↓
                              </button>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              question.is_published
                                ? 'bg-emerald-500/20 text-emerald-200'
                                : 'bg-amber-500/20 text-amber-200'
                            }`}>
                              {question.is_published ? 'Published' : 'Draft'}
                            </span>
                          </div>
                          <p className="font-semibold text-white">{question.text}</p>
                        </div>
                        <span className="text-xs text-slate-500 font-mono">{question.id.slice(0, 8)}…</span>
                      </div>

                      <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-2">
                        <p>Time: {question.time_limit_seconds}s</p>
                        <p>Score: {question.min_correct_score}-{question.max_score}</p>
                        <p>Size: {question.image_width ?? '—'}×{question.image_height ?? '—'}</p>
                        <p>{question.reveal_image_url ? 'Reveal image attached' : 'No reveal image'}</p>
                      </div>

                      <div className="flex gap-3 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(question)}
                          disabled={busyAction !== null}
                          className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleTogglePublish(question); }}
                          disabled={busyAction !== null}
                          className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {busyAction === `publish-${question.id}`
                            ? 'Updating…'
                            : question.is_published
                              ? 'Unpublish'
                              : 'Publish'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleDeleteQuestion(question.id); }}
                          disabled={busyAction !== null}
                          className="flex-1 rounded-lg bg-red-900/60 px-3 py-2 text-sm font-semibold text-red-200 disabled:opacity-50"
                        >
                          {busyAction === `delete-${question.id}` ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
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

function FeedbackBox({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        tone === 'success'
          ? 'border-emerald-500/30 bg-emerald-900/20 text-emerald-200'
          : 'border-red-500/30 bg-red-900/20 text-red-200'
      }`}
    >
      {message}
    </div>
  );
}

function FieldBlock({
  label,
  input,
  error,
  fullWidth,
}: {
  label: string;
  input: ReactNode;
  error?: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'md:col-span-2 space-y-2' : 'space-y-2'}>
      <label className="text-sm font-medium text-slate-200">{label}</label>
      {input}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}

function FilePicker({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-200">{label}</label>
      <input
        type="file"
        accept="image/*"
        onChange={onChange}
        className="block w-full rounded-xl border border-white/10 bg-slate-900/50 px-3 py-3 text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-white"
      />
      <p className="text-xs text-slate-500">{file ? file.name : 'No file selected'}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'error';
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-900/20 text-emerald-200'
      : tone === 'error'
        ? 'border-red-500/30 bg-red-900/20 text-red-200'
        : 'border-white/10 bg-slate-900/40 text-slate-200';

  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function inputClassName(hasError: boolean, readOnly = false): string {
  return `w-full rounded-xl border bg-slate-900/50 px-3 py-3 text-sm text-white placeholder-slate-500
    focus:outline-none focus:ring-2 disabled:opacity-60 ${
      hasError
        ? 'border-red-500/50 focus:ring-red-500'
        : 'border-white/10 focus:ring-indigo-500'
    } ${readOnly ? 'cursor-default text-slate-300' : ''}`;
}
