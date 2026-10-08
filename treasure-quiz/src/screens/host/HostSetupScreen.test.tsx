import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import HostSetupScreen from './HostSetupScreen';
import type { ChestDraft, QuestionDraft } from '../../domain/types';

afterEach(() => cleanup());

function questions(count = 50): QuestionDraft[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `q-${index + 1}`,
    roundNo: index < 20 ? Math.floor(index / 10) + 1 : Math.floor((index - 20) / 5) + 3,
    position: index < 20 ? (index % 10) + 1 : (index % 5) + 1,
    questionType: index < 20 ? 'true_false' : 'multiple_choice',
    prompt: `Question ${index + 1}`,
    keyword: `Keyword ${index + 1}`,
    choices: index < 20 ? ['ใช่', 'ไม่ใช่'] : ['A', 'B', 'C'],
    correctAnswer: index < 20 ? 'ใช่' : 'A',
    difficulty: 1,
  }));
}

const chests: ChestDraft[] = [{
  key: 'copper', name: 'ทองแดง', goldCost: 100, gemCost: 0,
  rewardTable: [{ amountSatang: 1, weight: 60 }, { amountSatang: 10, weight: 30 }, { amountSatang: 50, weight: 10 }],
}];

describe('HostSetupScreen', () => {
  it('keeps a Host PIN error visible', () => {
    render(<HostSetupScreen pinError="PIN ไม่ถูกต้อง" initialQuestions={questions()} initialChests={chests} action={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('PIN ไม่ถูกต้อง');
  });

  it('shows the required question count for every round', () => {
    render(<HostSetupScreen initialQuestions={questions()} initialChests={chests} action={vi.fn()} />);
    expect(screen.getByText('รอบ 1 · 10 ข้อ')).toBeInTheDocument();
    expect(screen.getByText('รอบ 3 · 5 ข้อ')).toBeInTheDocument();
    expect(screen.getByText('รอบ 8 · 5 ข้อ')).toBeInTheDocument();
  });

  it('blocks Save when a question has duplicate choices or no keyword', () => {
    const invalid = questions();
    invalid[0] = { ...invalid[0], keyword: '', choices: ['ใช่', 'ใช่'] };
    render(<HostSetupScreen initialQuestions={invalid} initialChests={chests} action={vi.fn()} />);
    expect(screen.getByText(/duplicate|ซ้ำ/i)).toBeInTheDocument();
    expect(screen.getByText('ข้อ 1 ต้องมี keyword')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /บันทึกคำถาม/i })).toBeDisabled();
  });

  it('disables Create Game when there are only 49 questions', () => {
    render(<HostSetupScreen initialQuestions={questions(49)} initialChests={chests} action={vi.fn()} />);
    expect(screen.getByRole('button', { name: /สร้างเกม/i })).toBeDisabled();
    expect(screen.getByText('49/50')).toBeInTheDocument();
  });

  it('shows an inline error when chest weights total 99', () => {
    const invalidChests = [{ ...chests[0], rewardTable: [{ amountSatang: 1, weight: 99 }] }];
    render(<HostSetupScreen initialQuestions={questions()} initialChests={invalidChests} action={vi.fn()} />);
    expect(screen.getByText(/น้ำหนักรางวัลต้องรวม 100%/)).toBeInTheDocument();
  });

  it('calls create_game once on a double tap when setup is valid', () => {
    const action = vi.fn().mockResolvedValue({ ok: true, game: { id: 'game-1' } });
    render(<HostSetupScreen initialQuestions={questions()} initialChests={chests} action={action} />);
    const button = screen.getByRole('button', { name: /สร้างเกม/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith('create_game', expect.any(Object));
  });
});
