const imageStatusCache = new Map<string, 'loading' | 'loaded' | 'error'>();
const imagePromiseCache = new Map<string, Promise<'loaded' | 'error'>>();

function normalizeUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  return trimmed ? trimmed : null;
}

export function getImagePreloadStatus(url: string | null | undefined): 'idle' | 'loading' | 'loaded' | 'error' {
  const normalized = normalizeUrl(url);
  if (!normalized) return 'idle';
  return imageStatusCache.get(normalized) ?? 'idle';
}

export function preloadImage(url: string | null | undefined, timeoutMs = 6000): Promise<'loaded' | 'error'> {
  const normalized = normalizeUrl(url);
  if (!normalized) return Promise.resolve('error');

  const cachedStatus = imageStatusCache.get(normalized);
  if (cachedStatus === 'loaded' || cachedStatus === 'error') {
    return Promise.resolve(cachedStatus);
  }

  const cachedPromise = imagePromiseCache.get(normalized);
  if (cachedPromise) return cachedPromise;

  imageStatusCache.set(normalized, 'loading');

  const promise = new Promise<'loaded' | 'error'>((resolve) => {
    const img = new Image();
    let settled = false;

    const finalize = (status: 'loaded' | 'error') => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      imageStatusCache.set(normalized, status);
      imagePromiseCache.delete(normalized);
      resolve(status);
    };

    const timeoutId = window.setTimeout(() => finalize('error'), timeoutMs);
    img.onload = () => finalize('loaded');
    img.onerror = () => finalize('error');
    img.decoding = 'async';
    img.src = normalized;
  });

  imagePromiseCache.set(normalized, promise);
  return promise;
}
