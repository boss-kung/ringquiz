import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { useGameStore } from './store/gameStore';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Expose store in dev for preview/debugging only
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useGameStore;
}
