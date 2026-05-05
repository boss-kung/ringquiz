import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../../lib/supabase';
import {
  buildQuestionImportTemplateCsv,
  downloadQuestionImportTemplateCsv,
  downloadQuestionImportTemplateZip,
} from '../../lib/importTemplateDownloads';
import { parseZipImport } from '../../lib/parseZipImport';
import type { ZipFileStatus, ZipImportSummary, ZipParseResult, ZipValidatedRow } from '../../lib/zipImportTypes';
import type { AdminQuestionPayload, AdminQuestionRequest, AdminQuestionResponse, AdminUploadAssetsResponse } from '../../lib/adminTypes';

// ── API helpers (mirrors AdminQuestionManager pattern) ───────────────────────

async function callAdminAction(
  secret: string,
  body: AdminQuestionRequest,
): Promise<AdminQuestionResponse> {
  const response = await fetch(`${FUNCTIONS_URL}/admin-question-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'X-Host-Secret': secret,
    },
    body: JSON.stringify(body),
  });

  if (response.ok) return response.json() as Promise<AdminQuestionResponse>;

  let json: Record<string, unknown> = {};
  try { json = await response.json(); } catch { /* non-JSON body */ }
  const msg =
    (typeof json['error'] === 'string' ? json['error'] : null) ??
    `HTTP ${response.status}`;
  const detail =
    (typeof json['detail'] === 'string' ? json['detail'] : null) ??
    response.statusText;
  throw new Error(detail ? `${msg}: ${detail}` : msg);
}

async function uploadRowAssets(
  secret: string,
  row: ZipValidatedRow,
): Promise<AdminUploadAssetsResponse> {
  if (!row.imageFile || !row.maskFile || row.imageWidth === null || row.imageHeight === null ||
      row.maskWidth === null || row.maskHeight === null) {
    throw new Error('Row is missing required asset files or dimensions.');
  }

  const body = new FormData();
  body.set('action', 'upload_assets');
  body.set('image_file', row.imageFile);
  body.set('mask_file', row.maskFile);
  if (row.revealFile) body.set('reveal_file', row.revealFile);
  body.set('image_width', String(row.imageWidth));
  body.set('image_height', String(row.imageHeight));
  body.set('mask_width', String(row.maskWidth));
  body.set('mask_height', String(row.maskHeight));

  const response = await fetch(`${FUNCTIONS_URL}/admin-question-action`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'X-Host-Secret': secret,
    },
    body,
  });

  if (response.ok) return response.json() as Promise<AdminUploadAssetsResponse>;

  let errJson: Record<string, unknown> = {};
  try { errJson = await response.json(); } catch { /* non-JSON body */ }
  const msg =
    (typeof errJson['error'] === 'string' ? errJson['error'] : null) ??
    `HTTP ${response.status}`;
  const detail =
    (typeof errJson['detail'] === 'string' ? errJson['detail'] : null) ??
    response.statusText;
  throw new Error(detail ? `${msg}: ${detail}` : msg);
}

// ── Component ────────────────────────────────────────────────────────────────

type ImportPhase = 'idle' | 'parsing' | 'preview' | 'importing' | 'done';

export function ZipBulkImportPanel({
  secret,
  onImportSuccess,
  onViewBank,
}: {
  secret: string;
  onImportSuccess: () => Promise<void>;
  onViewBank: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [parseResult, setParseResult] = useState<ZipParseResult | null>(null);
  const [parseError, setParseError] = useState('');
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [importError, setImportError] = useState('');
  const [importSummary, setImportSummary] = useState<ZipImportSummary | null>(null);
  const [templateError, setTemplateError] = useState('');
  const [downloadingTemplate, setDownloadingTemplate] = useState<null | 'csv' | 'zip'>(null);

  const validRows = parseResult?.rows.filter((r) => r.valid) ?? [];
  const invalidRows = (parseResult?.rows.length ?? 0) - validRows.length;
  const allValid = parseResult !== null && parseResult.globalErrors.length === 0 && invalidRows === 0;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    // Reset input so same file can be re-selected after reset
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setParseError('Please select a .zip file.');
      return;
    }

    setPhase('parsing');
    setParseError('');
    setParseResult(null);
    setImportError('');
    setImportSummary(null);

    try {
      const result = await parseZipImport(file);
      setParseResult(result);
      setPhase('preview');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse ZIP file.');
      setPhase('idle');
    }
  };

  const handleDownloadCsvTemplate = () => {
    setTemplateError('');

    try {
      downloadQuestionImportTemplateCsv();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to download CSV template.');
    }
  };

  const handleDownloadZipTemplate = async () => {
    setTemplateError('');
    setDownloadingTemplate('zip');

    try {
      await downloadQuestionImportTemplateZip();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'Failed to download ZIP template.');
    } finally {
      setDownloadingTemplate(null);
    }
  };

  const handleImport = async () => {
    if (!parseResult || validRows.length === 0) return;

    setPhase('importing');
    setImportError('');
    setImportProgress({ current: 0, total: validRows.length });

    const questionPayloads: AdminQuestionPayload[] = [];
    let storageUploadCount = 0;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      setImportProgress({ current: i + 1, total: validRows.length });

      try {
        const uploaded = await uploadRowAssets(secret, row);
        storageUploadCount += 2 + (row.revealFile ? 1 : 0);

        questionPayloads.push({
          text: row.text,
          image_url: uploaded.image_url,
          mask_storage_path: uploaded.mask_storage_path,
          reveal_image_url: uploaded.reveal_image_url ?? null,
          time_limit_seconds: row.timeLimitSeconds!,
          max_score: row.maxScore!,
          min_correct_score: row.minCorrectScore!,
          circle_radius_ratio: row.circleRadiusRatio!,
          image_width: uploaded.image_width,
          image_height: uploaded.image_height,
          mask_width: uploaded.mask_width,
          mask_height: uploaded.mask_height,
          is_published: row.isPublished,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed.';
        setImportError(`Row ${row.rowNumber}: ${msg}`);
        setPhase('preview');
        return;
      }
    }

    try {
      const response = await callAdminAction(secret, {
        action: 'bulk_create_questions',
        questions: questionPayloads,
      });

      const publishedCount = questionPayloads.filter((q) => q.is_published !== false).length;
      const importedCount = response.created_count ?? questionPayloads.length;

      setImportSummary({
        totalRows: parseResult.rows.length,
        importedCount,
        failedCount: parseResult.rows.length - validRows.length,
        publishedCount,
        draftCount: validRows.length - publishedCount,
        storageUploadCount,
      });

      await onImportSuccess();
      setPhase('done');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to insert questions into the database.');
      setPhase('preview');
    }
  };

  const handleReset = () => {
    setPhase('idle');
    setParseResult(null);
    setParseError('');
    setImportError('');
    setImportSummary(null);
    setImportProgress(null);
    setTemplateError('');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3">
        <p className="font-semibold text-white">ZIP Import</p>
        <p className="mt-1 text-sm text-slate-400">
          Upload a .zip file containing <code className="text-indigo-300">questions.csv</code> plus
          images, masks, and optional reveal images. Questions are imported into the Question Bank only —
          add them to a Game Set separately.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={handleDownloadCsvTemplate}
            className="rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Download CSV Template
          </button>
          <button
            type="button"
            onClick={() => { void handleDownloadZipTemplate(); }}
            disabled={downloadingTemplate === 'zip'}
            className="rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {downloadingTemplate === 'zip' ? 'Downloading ZIP…' : 'Download ZIP Template'}
          </button>
        </div>
        <div className="mt-3 space-y-1 text-xs text-slate-400">
          <p>Use this template to prepare your ZIP import. Keep questions.csv at the root of the ZIP.</p>
          <p>Place question images in images/, masks in masks/, and optional reveal images in reveals/.</p>
        </div>
      </div>

      {/* File picker (always visible unless done) */}
      {phase !== 'done' && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-200">Select ZIP file</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            onChange={(e) => { void handleFileChange(e); }}
            disabled={phase === 'parsing' || phase === 'importing'}
            className="block w-full rounded-xl border border-white/10 bg-slate-900/50 px-3 py-3 text-sm text-slate-200
              file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-white
              disabled:opacity-50"
          />
          <p className="text-xs text-slate-500">
            Expected structure: questions.csv, images/, masks/, reveals/ (optional)
          </p>
        </div>
      )}

      {/* Parse error */}
      {parseError && <FeedbackBox tone="error" message={parseError} />}

      {/* Parsing spinner */}
      {phase === 'parsing' && (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 px-4 py-6 text-center text-slate-300">
          <p className="font-semibold">Reading ZIP…</p>
          <p className="mt-1 text-sm text-slate-400">Validating assets and checking image dimensions.</p>
        </div>
      )}

      {/* Import progress */}
      {phase === 'importing' && importProgress && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-900/20 px-4 py-4 space-y-2">
          <p className="font-semibold text-white">
            Uploading row {importProgress.current} of {importProgress.total}…
          </p>
          <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${Math.round((importProgress.current / importProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Import error */}
      {importError && <FeedbackBox tone="error" message={importError} />}
      {templateError && <FeedbackBox tone="error" message={templateError} />}

      {/* Global CSV/ZIP parse errors */}
      {parseResult && parseResult.globalErrors.length > 0 && (
        <div className="space-y-2">
          {parseResult.globalErrors.map((e, i) => (
            <FeedbackBox key={i} tone="error" message={e} />
          ))}
        </div>
      )}

      {/* Preview table */}
      {(phase === 'preview' || phase === 'importing') && parseResult && parseResult.globalErrors.length === 0 && (
        <div className="space-y-4">
          {/* Summary stats */}
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Total rows" value={String(parseResult.rows.length)} />
            <StatCard label="Valid" value={String(validRows.length)} tone="success" />
            <StatCard label="Invalid" value={String(invalidRows)} tone={invalidRows > 0 ? 'error' : 'neutral'} />
          </div>

          {!allValid && (
            <FeedbackBox
              tone="error"
              message={`Fix ${invalidRows} invalid row${invalidRows === 1 ? '' : 's'} before importing. All rows must be valid.`}
            />
          )}

          {/* Row preview table */}
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/60">
                <tr>
                  <Th>#</Th>
                  <Th>Question text</Th>
                  <Th>Image</Th>
                  <Th>Mask</Th>
                  <Th>Reveal</Th>
                  <Th>Defaults (time / max / min / radius)</Th>
                  <Th>Publish</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {parseResult.rows.map((row) => (
                  <RowPreview key={row.rowNumber} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Import button */}
          <button
            type="button"
            onClick={() => { void handleImport(); }}
            disabled={!allValid || phase === 'importing'}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-50"
          >
            {phase === 'importing' ? 'Importing…' : `Import ${validRows.length} Question${validRows.length === 1 ? '' : 's'} to Question Bank`}
          </button>
        </div>
      )}

      {/* Done / summary */}
      {phase === 'done' && importSummary && (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-900/20 px-4 py-4">
            <p className="font-bold text-emerald-300">Import complete!</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Total rows" value={String(importSummary.totalRows)} />
            <StatCard label="Imported" value={String(importSummary.importedCount)} tone="success" />
            <StatCard label="Skipped (invalid)" value={String(importSummary.failedCount)} tone={importSummary.failedCount > 0 ? 'error' : 'neutral'} />
            <StatCard label="Published" value={String(importSummary.publishedCount)} tone="success" />
            <StatCard label="Draft" value={String(importSummary.draftCount)} />
            <StatCard label="Files uploaded" value={String(importSummary.storageUploadCount)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onViewBank}
              className="rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white"
            >
              View Question Bank
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-xl bg-white/10 px-4 py-3 font-semibold text-white"
            >
              Import Another ZIP
            </button>
          </div>
        </div>
      )}

      {/* CSV format reference */}
      {phase === 'idle' && (
        <details className="rounded-xl border border-white/10 bg-slate-900/40">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-300 select-none">
            CSV format reference
          </summary>
          <div className="px-4 pb-4 pt-2 space-y-2 text-xs text-slate-400">
            <p className="font-semibold text-slate-300">Required columns:</p>
            <code className="block whitespace-pre-wrap break-all text-slate-300 bg-slate-950 rounded-lg p-3">
              {`text,image_file,mask_file,default_time_limit_seconds,default_max_score,default_min_correct_score,default_circle_radius_ratio`}
            </code>
            <p className="font-semibold text-slate-300 mt-3">Optional columns:</p>
            <code className="block text-slate-300 bg-slate-950 rounded-lg p-3">
              {`reveal_file,difficulty,tags,is_published`}
            </code>
            <p className="font-semibold text-slate-300 mt-3">Example row:</p>
            <code className="block whitespace-pre-wrap break-all text-slate-300 bg-slate-950 rounded-lg p-3">
              {buildQuestionImportTemplateCsv()}
            </code>
            <p className="mt-2">
              <span className="text-slate-300">Note:</span> default_* values are recommended settings
              for Game Setup. Runtime values can be adjusted per Game Set.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function RowPreview({ row }: { row: ZipValidatedRow }) {
  const rowClass = row.valid
    ? 'bg-transparent hover:bg-emerald-900/5'
    : 'bg-red-900/10 hover:bg-red-900/15';

  return (
    <tr className={rowClass}>
      <Td>
        <span className="font-mono text-slate-400">{row.rowNumber}</span>
      </Td>
      <Td>
        <p className="max-w-[200px] truncate font-medium text-white" title={row.text}>
          {row.text || <span className="italic text-red-400">empty</span>}
        </p>
        {row.warnings.length > 0 && (
          <p className="mt-0.5 text-xs text-amber-400">⚠ {row.warnings.join('; ')}</p>
        )}
        {!row.valid && row.errors.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-red-300">
            {row.errors.map((e, i) => (
              <li key={i}>• {e}</li>
            ))}
          </ul>
        )}
      </Td>
      <Td>
        <AssetBadge status={row.imageStatus} label={row.imageCsvPath} dims={row.imageWidth !== null ? `${row.imageWidth}×${row.imageHeight}` : undefined} />
      </Td>
      <Td>
        <AssetBadge status={row.maskStatus} label={row.maskCsvPath} dims={row.maskWidth !== null ? `${row.maskWidth}×${row.maskHeight}` : undefined} />
      </Td>
      <Td>
        <AssetBadge status={row.revealStatus} label={row.revealCsvPath ?? '—'} />
      </Td>
      <Td>
        <span className="whitespace-nowrap text-slate-300">
          {row.timeLimitSeconds ?? '—'}s / {row.maxScore ?? '—'} / {row.minCorrectScore ?? '—'} / {row.circleRadiusRatio ?? '—'}
        </span>
      </Td>
      <Td>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
          row.isPublished ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
        }`}>
          {row.isPublished ? 'Published' : 'Draft'}
        </span>
      </Td>
      <Td>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
          row.valid ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
        }`}>
          {row.valid ? 'Valid' : 'Invalid'}
        </span>
      </Td>
    </tr>
  );
}

function AssetBadge({
  status,
  label,
  dims,
}: {
  status: ZipFileStatus;
  label: string;
  dims?: string;
}) {
  const colorClass =
    status === 'found'
      ? 'text-emerald-400'
      : status === 'not_provided'
        ? 'text-slate-500'
        : 'text-red-400';

  const icon =
    status === 'found' ? '✓' : status === 'not_provided' ? '–' : '✗';

  return (
    <div className="space-y-0.5">
      <p className={`flex items-center gap-1 text-xs font-medium ${colorClass}`}>
        <span>{icon}</span>
        <span className="max-w-[120px] truncate" title={label}>{label || '—'}</span>
      </p>
      {dims && <p className="text-xs text-slate-500">{dims}</p>}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3 py-3 align-top">
      {children}
    </td>
  );
}

function FeedbackBox({ tone, message }: { tone: 'success' | 'error'; message: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${
      tone === 'success'
        ? 'border-emerald-500/30 bg-emerald-900/20 text-emerald-200'
        : 'border-red-500/30 bg-red-900/20 text-red-200'
    }`}>
      {message}
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
