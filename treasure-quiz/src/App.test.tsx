import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import App from './App';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/play');
});

describe('App route shell', () => {
  it('renders the host shell without importing RingQuiz screens', () => {
    window.history.replaceState({}, '', '/host');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Treasure Quiz Host' })).toBeInTheDocument();
  });

  it('renders the player shell for the player route', () => {
    window.history.replaceState({}, '', '/play');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Treasure Quiz' })).toBeInTheDocument();
  });
});
