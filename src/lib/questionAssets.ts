import { supabase } from './supabase';

export interface LocalImageDimensions {
  width: number;
  height: number;
}

export function resolveQuestionImageUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return supabase.storage.from('question-images').getPublicUrl(path).data.publicUrl;
}

export function resolveRevealImageUrl(path: string | null): string | null {
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
