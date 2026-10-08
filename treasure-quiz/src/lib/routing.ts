export type AppPath = '/host' | '/play';

export function getAppPath(pathname = typeof window === 'undefined' ? '/play' : window.location.pathname): AppPath {
  return pathname === '/host' ? '/host' : '/play';
}
