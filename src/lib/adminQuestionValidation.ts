import type {
  AdminQuestionPayload,
  AdminQuestionPreviewItem,
  AdminQuestionValidationIssue,
} from './adminTypes';

type RawQuestionInput = Partial<Record<keyof AdminQuestionPayload, unknown>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTrimmedString(
  input: RawQuestionInput,
  field: keyof AdminQuestionPayload,
  label: string,
  errors: AdminQuestionValidationIssue[],
  options?: { optional?: boolean; nullable?: boolean },
): string | null {
  const value = input[field];

  if (value == null || value === '') {
    if (options?.optional) return options?.nullable ? null : '';
    errors.push({ field, message: `${label} is required.` });
    return null;
  }

  if (typeof value !== 'string') {
    errors.push({ field, message: `${label} must be a string.` });
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    if (options?.optional) return options?.nullable ? null : '';
    errors.push({ field, message: `${label} must not be empty.` });
    return null;
  }

  return trimmed;
}

function readNumber(
  input: RawQuestionInput,
  field: keyof AdminQuestionPayload,
  label: string,
  errors: AdminQuestionValidationIssue[],
  options?: {
    optional?: boolean;
    integer?: boolean;
    min?: number;
    max?: number;
  },
): number | null {
  const value = input[field];

  if (value == null || value === '') {
    if (options?.optional) return null;
    errors.push({ field, message: `${label} is required.` });
    return null;
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    errors.push({ field, message: `${label} must be a valid number.` });
    return null;
  }

  if (options?.integer && !Number.isInteger(parsed)) {
    errors.push({ field, message: `${label} must be an integer.` });
    return null;
  }

  if (options?.min != null && parsed < options.min) {
    errors.push({ field, message: `${label} must be at least ${options.min}.` });
  }

  if (options?.max != null && parsed > options.max) {
    errors.push({ field, message: `${label} must be at most ${options.max}.` });
  }

  return parsed;
}

export function validateAdminQuestionInput(input: unknown): {
  normalizedQuestion?: AdminQuestionPayload;
  errors: AdminQuestionValidationIssue[];
} {
  const errors: AdminQuestionValidationIssue[] = [];

  if (!isPlainObject(input)) {
    return {
      errors: [{ field: 'question', message: 'Question must be a JSON object.' }],
    };
  }

  const raw = input as RawQuestionInput;
  const text = readTrimmedString(raw, 'text', 'Question text', errors);
  const imageUrl = readTrimmedString(raw, 'image_url', 'Image URL', errors);
  const maskStoragePath = readTrimmedString(raw, 'mask_storage_path', 'Mask storage path', errors);
  const revealImageUrl = readTrimmedString(
    raw,
    'reveal_image_url',
    'Reveal image URL',
    errors,
    { optional: true, nullable: true },
  );
  const circleRadiusRatio = readNumber(raw, 'circle_radius_ratio', 'Circle radius ratio', errors, {
    min: 0.0001,
    max: 0.5,
  });
  const timeLimitSeconds = readNumber(raw, 'time_limit_seconds', 'Time limit (seconds)', errors, {
    integer: true,
    min: 1,
  });
  const maxScore = readNumber(raw, 'max_score', 'Max score', errors, {
    integer: true,
    min: 1,
  });
  const minCorrectScore = readNumber(raw, 'min_correct_score', 'Minimum correct score', errors, {
    integer: true,
    min: 0,
  });
  const imageWidth = readNumber(raw, 'image_width', 'Image width', errors, {
    integer: true,
    min: 1,
  });
  const imageHeight = readNumber(raw, 'image_height', 'Image height', errors, {
    integer: true,
    min: 1,
  });
  const maskWidth = readNumber(raw, 'mask_width', 'Mask width', errors, {
    integer: true,
    min: 1,
  });
  const maskHeight = readNumber(raw, 'mask_height', 'Mask height', errors, {
    integer: true,
    min: 1,
  });
  const orderIndex = readNumber(raw, 'order_index', 'Order index', errors, {
    optional: true,
    integer: true,
    min: 1,
  });

  const isPublishedValue = raw.is_published;
  const isPublished =
    typeof isPublishedValue === 'boolean'
      ? isPublishedValue
      : isPublishedValue == null
        ? true
        : null;

  if (isPublished === null) {
    errors.push({ field: 'is_published', message: 'Published must be true or false.' });
  }

  if (
    maxScore != null &&
    minCorrectScore != null &&
    minCorrectScore > maxScore
  ) {
    errors.push({
      field: 'min_correct_score',
      message: 'Minimum correct score must not exceed max score.',
    });
  }

  if (
    imageWidth != null &&
    maskWidth != null &&
    imageWidth !== maskWidth
  ) {
    errors.push({
      field: 'mask_width',
      message: 'Mask width must match image width.',
    });
  }

  if (
    imageHeight != null &&
    maskHeight != null &&
    imageHeight !== maskHeight
  ) {
    errors.push({
      field: 'mask_height',
      message: 'Mask height must match image height.',
    });
  }

  if (errors.length > 0 || text == null || imageUrl == null || maskStoragePath == null || circleRadiusRatio == null ||
    timeLimitSeconds == null || maxScore == null || minCorrectScore == null ||
    imageWidth == null || imageHeight == null || maskWidth == null || maskHeight == null ||
    isPublished == null
  ) {
    return { errors };
  }

  return {
    errors: [],
    normalizedQuestion: {
      text,
      image_url: imageUrl,
      mask_storage_path: maskStoragePath,
      circle_radius_ratio: circleRadiusRatio,
      time_limit_seconds: timeLimitSeconds,
      max_score: maxScore,
      min_correct_score: minCorrectScore,
      image_width: imageWidth,
      image_height: imageHeight,
      mask_width: maskWidth,
      mask_height: maskHeight,
      is_published: isPublished,
      reveal_image_url: revealImageUrl,
      ...(orderIndex != null ? { order_index: orderIndex } : {}),
    },
  };
}

export function validateBulkAdminQuestionInputs(input: unknown): {
  items: AdminQuestionPreviewItem[];
  validQuestions: AdminQuestionPayload[];
  globalErrors: string[];
} {
  if (!Array.isArray(input)) {
    return {
      items: [],
      validQuestions: [],
      globalErrors: ['Bulk import JSON must be an array of question objects.'],
    };
  }

  const items = input.map((item, index) => {
    const result = validateAdminQuestionInput(item);
    return {
      index,
      input: item,
      valid: result.errors.length === 0 && !!result.normalizedQuestion,
      normalizedQuestion: result.normalizedQuestion,
      errors: result.errors,
    } satisfies AdminQuestionPreviewItem;
  });

  const seenOrderIndexes = new Map<number, number>();
  for (const item of items) {
    const orderIndex = item.normalizedQuestion?.order_index;
    if (orderIndex == null) continue;

    const firstSeenAt = seenOrderIndexes.get(orderIndex);
    if (firstSeenAt == null) {
      seenOrderIndexes.set(orderIndex, item.index);
      continue;
    }

    item.valid = false;
    item.errors.push({
      field: 'order_index',
      message: `Order index ${orderIndex} duplicates row ${firstSeenAt + 1}.`,
    });
  }

  return {
    items,
    validQuestions: items
      .filter((item) => item.valid && item.normalizedQuestion)
      .map((item) => item.normalizedQuestion as AdminQuestionPayload),
    globalErrors: [],
  };
}

export function parseBulkQuestionJson(text: string): {
  parsed?: unknown;
  error?: string;
} {
  if (!text.trim()) {
    return { error: 'Paste JSON before validating.' };
  }

  try {
    return { parsed: JSON.parse(text) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid JSON.',
    };
  }
}
