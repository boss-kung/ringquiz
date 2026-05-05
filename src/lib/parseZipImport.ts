import JSZip from 'jszip';
import Papa from 'papaparse';
import { getLocalImageDimensions } from './questionAssets';
import type { ZipFileStatus, ZipParseResult, ZipValidatedRow } from './zipImportTypes';

// ── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// Server only accepts image/png for masks; keep client consistent
const ALLOWED_MASK_EXTS = new Set(['.png']);
const MAX_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB — matches Edge Function limit

const REQUIRED_CSV_COLUMNS = [
  'text',
  'image_file',
  'mask_file',
  'default_time_limit_seconds',
  'default_max_score',
  'default_min_correct_score',
  'default_circle_radius_ratio',
] as const;

// ── Path helpers ─────────────────────────────────────────────────────────────

function isIgnoredPath(path: string): boolean {
  return (
    path.includes('__MACOSX/') ||
    path.endsWith('.DS_Store') ||
    /thumbs\.db$/i.test(path)
  );
}

function isSafePath(path: string): boolean {
  return (
    !path.startsWith('/') &&
    !path.includes('../') &&
    !path.includes('..\\')
  );
}

function getExtension(filename: string): string {
  const match = /\.([^./\\]+)$/.exec(filename.toLowerCase());
  return match ? `.${match[1]}` : '';
}

function getMimeType(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

// Resolve an asset path from a CSV value against a folder in the ZIP.
// Tries (in order):
//   1. Exact path as written in CSV
//   2. folder/csvValue
//   3. folder/basename(csvValue)
function resolvePath(
  csvValue: string,
  folderPath: string,
  zipEntries: Map<string, JSZip.JSZipObject>,
): string | null {
  const trimmed = csvValue.trim();
  if (!trimmed) return null;

  if (zipEntries.has(trimmed)) return trimmed;

  const withFolder = `${folderPath}/${trimmed}`;
  if (zipEntries.has(withFolder)) return withFolder;

  const basename = trimmed.split('/').pop();
  if (basename && basename !== trimmed) {
    const withFolderBasename = `${folderPath}/${basename}`;
    if (zipEntries.has(withFolderBasename)) return withFolderBasename;
  }

  return null;
}

// ── Numeric parsers ──────────────────────────────────────────────────────────

function parsePositiveInt(value: string | undefined, label: string, errors: string[]): number | null {
  if (value === undefined || value === '') {
    errors.push(`${label} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    errors.push(`${label} must be a positive integer (got "${value}").`);
    return null;
  }
  return n;
}

function parseNonNegativeInt(value: string | undefined, label: string, errors: string[]): number | null {
  if (value === undefined || value === '') {
    errors.push(`${label} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    errors.push(`${label} must be a non-negative integer (got "${value}").`);
    return null;
  }
  return n;
}

function parseCircleRatio(value: string | undefined, label: string, errors: string[]): number | null {
  if (value === undefined || value === '') {
    errors.push(`${label} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 0.5) {
    errors.push(`${label} must be > 0 and ≤ 0.5 (got "${value}").`);
    return null;
  }
  return n;
}

function parseIsPublished(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(v)) return true;
  if (['false', '0', 'no'].includes(v)) return false;
  return true; // unrecognized → default true
}

// ── Asset extraction helper ──────────────────────────────────────────────────

type AssetResult =
  | { status: 'found'; file: File }
  | { status: 'missing' | 'invalid_type'; file: null; error: string };

async function extractAsset(
  csvValue: string,
  folderPath: string,
  allowedExts: Set<string>,
  label: string,
  zipEntries: Map<string, JSZip.JSZipObject>,
): Promise<AssetResult> {
  const resolvedPath = resolvePath(csvValue, folderPath, zipEntries);

  if (!resolvedPath) {
    return {
      status: 'missing',
      file: null,
      error: `${label} not found in ZIP: "${csvValue}"`,
    };
  }

  const ext = getExtension(resolvedPath);
  if (!allowedExts.has(ext)) {
    const allowed = [...allowedExts].join(', ');
    return {
      status: 'invalid_type',
      file: null,
      error: `${label} has unsupported type "${ext}". Allowed: ${allowed}`,
    };
  }

  const entry = zipEntries.get(resolvedPath)!;
  const blob = await entry.async('blob');

  if (blob.size > MAX_ASSET_BYTES) {
    return {
      status: 'invalid_type',
      file: null,
      error: `${label} exceeds 10 MB limit (${(blob.size / 1024 / 1024).toFixed(1)} MB).`,
    };
  }

  const filename = resolvedPath.split('/').pop() ?? csvValue;
  const mimeType = getMimeType(ext);
  const file = new File([blob], filename, { type: mimeType });
  return { status: 'found', file };
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function parseZipImport(zipFile: File): Promise<ZipParseResult> {
  // 1. Load ZIP
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipFile);
  } catch {
    return { rows: [], globalErrors: ['Failed to read ZIP file. Is it a valid .zip archive?'] };
  }

  // 2. Build safe, clean file map and locate questions.csv
  const zipEntries = new Map<string, JSZip.JSZipObject>();
  let csvPath: string | null = null;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (isIgnoredPath(path)) continue;
    if (!isSafePath(path)) continue;
    zipEntries.set(path, entry);

    // Prefer the shortest (shallowest) questions.csv path
    if (path === 'questions.csv' || path.endsWith('/questions.csv')) {
      if (!csvPath || path.length < csvPath.length) {
        csvPath = path;
      }
    }
  }

  if (!csvPath) {
    return { rows: [], globalErrors: ['questions.csv not found in ZIP.'] };
  }

  // 3. Determine base directory from the CSV location
  const baseDir = csvPath.includes('/')
    ? csvPath.slice(0, csvPath.lastIndexOf('/'))
    : '';
  const imagesDir = baseDir ? `${baseDir}/images` : 'images';
  const masksDir = baseDir ? `${baseDir}/masks` : 'masks';
  const revealsDir = baseDir ? `${baseDir}/reveals` : 'reveals';

  // 4. Read and parse CSV
  let csvText: string;
  try {
    csvText = await zipEntries.get(csvPath)!.async('string');
  } catch {
    return { rows: [], globalErrors: ['Failed to read questions.csv from ZIP.'] };
  }

  if (!csvText.trim()) {
    return { rows: [], globalErrors: ['questions.csv is empty.'] };
  }

  const parseResult = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h: string) => h.trim(),
  });

  const fields = parseResult.meta.fields ?? [];
  const missingCols = REQUIRED_CSV_COLUMNS.filter((col) => !fields.includes(col));
  if (missingCols.length > 0) {
    return {
      rows: [],
      globalErrors: [
        `questions.csv is missing required columns: ${missingCols.join(', ')}`,
      ],
    };
  }

  if (parseResult.data.length === 0) {
    return { rows: [], globalErrors: ['questions.csv has no data rows.'] };
  }

  // 5. Process each row
  const rows: ZipValidatedRow[] = [];

  for (let i = 0; i < parseResult.data.length; i++) {
    const raw = parseResult.data[i];
    const rowNumber = i + 1;
    const errors: string[] = [];
    const warnings: string[] = [];

    // Text
    const text = (raw['text'] ?? '').trim();
    if (!text) errors.push('Question text is required.');

    // CSV asset paths
    const imageCsvPath = (raw['image_file'] ?? '').trim();
    const maskCsvPath = (raw['mask_file'] ?? '').trim();
    const revealCsvPath = (raw['reveal_file'] ?? '').trim() || null;

    if (!imageCsvPath) errors.push('image_file is required.');
    if (!maskCsvPath) errors.push('mask_file is required.');

    // Extract image
    let imageStatus: ZipFileStatus = imageCsvPath ? 'missing' : 'not_provided';
    let imageFile: File | null = null;
    if (imageCsvPath) {
      const result = await extractAsset(imageCsvPath, imagesDir, ALLOWED_IMAGE_EXTS, 'Image file', zipEntries);
      imageStatus = result.status as ZipFileStatus;
      if (result.status === 'found') {
        imageFile = result.file;
      } else {
        errors.push(result.error);
      }
    }

    // Extract mask
    let maskStatus: ZipFileStatus = maskCsvPath ? 'missing' : 'not_provided';
    let maskFile: File | null = null;
    if (maskCsvPath) {
      const result = await extractAsset(maskCsvPath, masksDir, ALLOWED_MASK_EXTS, 'Mask file', zipEntries);
      maskStatus = result.status as ZipFileStatus;
      if (result.status === 'found') {
        maskFile = result.file;
      } else {
        errors.push(result.error);
      }
    }

    // Extract reveal (optional — only error if specified but missing)
    let revealStatus: ZipFileStatus = revealCsvPath ? 'missing' : 'not_provided';
    let revealFile: File | null = null;
    if (revealCsvPath) {
      const result = await extractAsset(revealCsvPath, revealsDir, ALLOWED_IMAGE_EXTS, 'Reveal file', zipEntries);
      revealStatus = result.status as ZipFileStatus;
      if (result.status === 'found') {
        revealFile = result.file;
      } else {
        errors.push(result.error);
      }
    }

    // Load dimensions client-side
    let imageWidth: number | null = null;
    let imageHeight: number | null = null;
    let maskWidth: number | null = null;
    let maskHeight: number | null = null;

    if (imageFile) {
      try {
        const dims = await getLocalImageDimensions(imageFile);
        imageWidth = dims.width;
        imageHeight = dims.height;
      } catch {
        errors.push('Could not read image dimensions.');
      }
    }

    if (maskFile) {
      try {
        const dims = await getLocalImageDimensions(maskFile);
        maskWidth = dims.width;
        maskHeight = dims.height;
      } catch {
        errors.push('Could not read mask dimensions.');
      }
    }

    // Dimension match
    if (imageWidth !== null && maskWidth !== null) {
      if (imageWidth !== maskWidth || imageHeight !== maskHeight) {
        errors.push(
          `Image (${imageWidth}×${imageHeight}) and mask (${maskWidth}×${maskHeight}) dimensions must match.`,
        );
      }
    }

    // Numeric defaults
    const timeLimitSeconds = parsePositiveInt(
      raw['default_time_limit_seconds']?.trim(),
      'default_time_limit_seconds',
      errors,
    );
    const maxScore = parsePositiveInt(raw['default_max_score']?.trim(), 'default_max_score', errors);
    const minCorrectScore = parseNonNegativeInt(
      raw['default_min_correct_score']?.trim(),
      'default_min_correct_score',
      errors,
    );
    const circleRadiusRatio = parseCircleRatio(
      raw['default_circle_radius_ratio']?.trim(),
      'default_circle_radius_ratio',
      errors,
    );

    if (maxScore !== null && minCorrectScore !== null && minCorrectScore > maxScore) {
      errors.push('default_min_correct_score must not exceed default_max_score.');
    }

    const isPublished = parseIsPublished(raw['is_published']?.trim());

    rows.push({
      rowNumber,
      text,
      imageCsvPath,
      maskCsvPath,
      revealCsvPath,
      imageStatus,
      maskStatus,
      revealStatus,
      imageFile,
      maskFile,
      revealFile,
      imageWidth,
      imageHeight,
      maskWidth,
      maskHeight,
      timeLimitSeconds,
      maxScore,
      minCorrectScore,
      circleRadiusRatio,
      isPublished,
      valid: errors.length === 0,
      errors,
      warnings,
    });
  }

  // Warn on duplicate image paths within the CSV (same file used multiple times is OK but warn)
  const imagePaths = rows.map((r) => r.imageCsvPath).filter(Boolean);
  const seenImagePaths = new Map<string, number>();
  for (const row of rows) {
    if (!row.imageCsvPath) continue;
    const first = seenImagePaths.get(row.imageCsvPath);
    if (first !== undefined) {
      row.warnings.push(`image_file "${row.imageCsvPath}" is also used in row ${first}.`);
    } else {
      seenImagePaths.set(row.imageCsvPath, row.rowNumber);
    }
  }
  void imagePaths; // suppress unused warning

  return { rows, globalErrors: [] };
}
