import { supabase } from './supabase';

export interface LocalImageDimensions {
  width: number;
  height: number;
}

const QUESTION_IMAGE_BUCKET = 'question-images';

function extractQuestionImagePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const normalized = trimmed.replace(/^\/+/, '');
  const bucketPattern = new RegExp(`(?:^|/)${QUESTION_IMAGE_BUCKET}/(.+)$`, 'i');
  const bucketMatch = bucketPattern.exec(normalized);
  if (bucketMatch?.[1]) return bucketMatch[1];

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const pathMatch = bucketPattern.exec(url.pathname);
      if (pathMatch?.[1]) return pathMatch[1];
      return trimmed;
    } catch {
      return trimmed;
    }
  }

  return normalized;
}

export function resolveQuestionImageUrl(path: string | null | undefined): string | null {
  if (!path?.trim()) return null;

  const normalized = extractQuestionImagePath(path);
  if (!normalized) return null;
  if (/^(https?:|data:|blob:)/i.test(normalized)) return normalized;

  return supabase.storage.from(QUESTION_IMAGE_BUCKET).getPublicUrl(normalized).data.publicUrl;
}

export function resolveRevealImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return resolveQuestionImageUrl(path);
}

export async function getLocalImageDimensions(file: File): Promise<LocalImageDimensions> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const dimensions = await new Promise<LocalImageDimensions>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error(`Failed to read image dimensions for ${file.name}.`));
      image.src = objectUrl;
    });

    return dimensions;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
