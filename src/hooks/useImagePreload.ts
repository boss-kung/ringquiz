import { useEffect, useMemo, useState } from 'react';
import { getImagePreloadStatus, preloadImage } from '../lib/imagePreload';

export function useImagePreloadStatus(url: string | null | undefined, timeoutMs = 6000) {
  const normalizedUrl = useMemo(() => {
    const trimmed = url?.trim();
    return trimmed ? trimmed : null;
  }, [url]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>(() => getImagePreloadStatus(normalizedUrl));

  useEffect(() => {
    if (!normalizedUrl) {
      setStatus('idle');
      return;
    }

    const cachedStatus = getImagePreloadStatus(normalizedUrl);
    if (cachedStatus === 'loaded' || cachedStatus === 'error') {
      setStatus(cachedStatus);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    preloadImage(normalizedUrl, timeoutMs).then((nextStatus) => {
      if (!cancelled) setStatus(nextStatus);
    });

    return () => {
      cancelled = true;
    };
  }, [normalizedUrl, timeoutMs]);

  return status;
}

export function usePrimeImages(urls: Array<string | null | undefined>, timeoutMs = 6000) {
  const urlKey = useMemo(
    () => urls.map((url) => url?.trim() ?? '').filter(Boolean).join('\0'),
    [urls],
  );

  useEffect(() => {
    if (!urlKey) return;
    urlKey.split('\0').forEach((url) => {
      void preloadImage(url, timeoutMs);
    });
  }, [timeoutMs, urlKey]);
}
