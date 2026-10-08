import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PlayerBriefingScreen from './PlayerBriefingScreen';
import PlayerQuestionScreen from './PlayerQuestionScreen';

afterEach(() => cleanup());

it('briefing shows keywords but not question text and disables unaffordable bets', () => {
  render(<PlayerBriefingScreen gameId="game-1" roundNo={3} gold={50} gems={0} questions={[{ id: 'q1', keyword: 'แมว', prompt: 'ความลับไม่ควรเห็น', choices: ['A', 'B'] }]} action={vi.fn()} />);
  expect(screen.getByText('แมว')).toBeInTheDocument();
  expect(screen.queryByText('ความลับไม่ควรเห็น')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /เดิมพัน Gold/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /เดิมพัน Diamond/i })).toBeDisabled();
});

it('briefing sends one bet even on double tap', async () => {
  const action = vi.fn().mockResolvedValue({ ok: true });
  render(<PlayerBriefingScreen gameId="game-1" roundNo={1} gold={200} gems={0} questions={[]} action={action} />);
  const button = screen.getByRole('button', { name: /เดิมพัน Gold/i });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(action).toHaveBeenCalledTimes(1);
});

it('question screen does not submit after the deadline and hides correctness details', () => {
  const action = vi.fn();
  render(<PlayerQuestionScreen gameId="game-1" roundNo={1} question={{ id: 'q1', prompt: 'เลือก', choices: ['A', 'B'] }} deadline={Date.now() - 1} action={action} />);
  expect(screen.getByText(/หมดเวลา/)).toBeInTheDocument();
  expect(screen.queryByText(/เฉลย/)).not.toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
});
