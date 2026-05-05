// Types for ZIP bulk import feature (Phase 1–2).

export type ZipFileStatus = 'found' | 'missing' | 'invalid_type' | 'not_provided';

export interface ZipValidatedRow {
  rowNumber: number;       // 1-based
  text: string;

  // Paths as written in CSV
  imageCsvPath: string;
  maskCsvPath: string;
  revealCsvPath: string | null;

  // Status of each asset inside ZIP
  imageStatus: ZipFileStatus;
  maskStatus: ZipFileStatus;
  revealStatus: ZipFileStatus;

  // Extracted File objects (ready to upload)
  imageFile: File | null;
  maskFile: File | null;
  revealFile: File | null;

  // Dimensions detected client-side
  imageWidth: number | null;
  imageHeight: number | null;
  maskWidth: number | null;
  maskHeight: number | null;

  // Parsed default/recommended gameplay values
  timeLimitSeconds: number | null;
  maxScore: number | null;
  minCorrectScore: number | null;
  circleRadiusRatio: number | null;
  isPublished: boolean;

  // Validation outcome
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ZipParseResult {
  rows: ZipValidatedRow[];
  globalErrors: string[];
}

export interface ZipImportSummary {
  totalRows: number;
  importedCount: number;
  failedCount: number;
  publishedCount: number;
  draftCount: number;
  storageUploadCount: number;
}
