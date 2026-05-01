import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { useGameStore } from './store/gameStore';

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

preventZoom();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Expose store in dev for preview/debugging only
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useGameStore;
}
