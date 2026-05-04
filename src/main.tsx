import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { useGameStore } from './store/gameStore';

function getAppPath() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const pathname = window.location.pathname;

  if (basePath && basePath !== '/' && pathname.startsWith(basePath)) {
    const stripped = pathname.slice(basePath.length);
    return stripped.startsWith('/') ? stripped : `/${stripped || ''}`;
  }

  return pathname;
}

function isHostRoute() {
  const appPath = getAppPath();
  return appPath === '/host' || appPath.startsWith('/host/');
}

function preventZoom() {
  const block = (event: Event) => event.preventDefault();

  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('gesturechange', block, { passive: false });
  document.addEventListener('gestureend', block, { passive: false });

  document.addEventListener('touchmove', (event) => {
    if ((event as TouchEvent).touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('wheel', (event) => {
    if ((event as WheelEvent).ctrlKey) {
      event.preventDefault();
    }
  }, { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}

const hostRoute = isHostRoute();
const viewportMeta = document.querySelector('meta[name="viewport"]');
if (viewportMeta) {
  viewportMeta.setAttribute(
    'content',
    hostRoute
      ? 'width=device-width, initial-scale=1.0'
      : 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no',
  );
}

document.documentElement.classList.toggle('host-route', hostRoute);
document.body.classList.toggle('host-route', hostRoute);
document.getElementById('root')?.classList.toggle('host-route', hostRoute);

if (!hostRoute) {
  preventZoom();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Expose store in dev for preview/debugging only
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useGameStore;
}
