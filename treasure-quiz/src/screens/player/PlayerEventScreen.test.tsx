import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PlayerEventScreen from './PlayerEventScreen';

afterEach(() => cleanup());

it('disables event choices that the Player cannot afford', () => {
  render(<PlayerEventScreen gameId="game-1" roundNo={2} gold={100} gems={0} action={vi.fn()} />);
  expect(screen.getByRole('button', { name: /Gold Event/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Diamond Event/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /Skip/i })).toBeEnabled();
});

it('sends only one event purchase and reveals the returned effect', async () => {
  const action = vi.fn().mockResolvedValue({ event: { code: 'mistake_shield', durationRounds: 1 } });
  render(<PlayerEventScreen gameId="game-1" roundNo={4} gold={300} gems={1} action={action} />);
  const button = screen.getByRole('button', { name: /Gold Event/i });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(action).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/mistake_shield/)).toBeInTheDocument();
});
