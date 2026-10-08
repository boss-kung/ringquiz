import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TrueFalseQuestion from './TrueFalseQuestion';
import MultipleChoiceQuestion from './MultipleChoiceQuestion';
import TimeBankRunner from './TimeBankRunner';
import NoMistakeRunner from './NoMistakeRunner';

afterEach(() => cleanup());

const questions = [
  { id: 'q1', prompt: 'ข้อหนึ่ง', keyword: 'แมว', choices: ['A', 'B'] },
  { id: 'q2', prompt: 'ข้อสอง', keyword: 'เพลง', choices: ['A', 'B'] },
  { id: 'q3', prompt: 'ข้อสาม', keyword: 'กาแฟ', choices: ['A', 'B'] },
  { id: 'q4', prompt: 'ข้อสี่', keyword: 'ทะเล', choices: ['A', 'B'] },
  { id: 'q5', prompt: 'ข้อห้า', keyword: 'บ้าน', choices: ['A', 'B'] },
];

it('True/False locks both answers after one tap', () => {
  const onAnswer = vi.fn();
  render(<TrueFalseQuestion prompt="จริงไหม" onAnswer={onAnswer} />);
  const yes = screen.getByRole('button', { name: 'ใช่' });
  const no = screen.getByRole('button', { name: 'ไม่ใช่' });
  fireEvent.click(yes);
  expect(onAnswer).toHaveBeenCalledWith('ใช่');
  expect(yes).toBeDisabled();
  expect(no).toBeDisabled();
});

it('multiple choice exposes keyboard-friendly named buttons and locks after one tap', () => {
  const onAnswer = vi.fn();
  render(<MultipleChoiceQuestion prompt="เลือกคำตอบ" choices={['A', 'B', 'C']} onAnswer={onAnswer} />);
  const option = screen.getByRole('button', { name: 'ตัวเลือก A' });
  fireEvent.keyDown(option, { key: 'Enter' });
  fireEvent.click(option);
  expect(onAnswer).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'ตัวเลือก B' })).toBeDisabled();
});

it('time bank keeps the same deadline while moving through five questions', async () => {
  const onAnswer = vi.fn().mockResolvedValue({ is_correct: true });
  render(<TimeBankRunner questions={questions} deadline={Date.now() + 30_000} onAnswer={onAnswer} />);
  for (const question of questions) {
    fireEvent.click(screen.getByRole('button', { name: `ตัวเลือก ${question.choices[0]}` }));
    await waitFor(() => expect(screen.queryByText(question.prompt)).not.toBeInTheDocument());
  }
  expect(onAnswer).toHaveBeenCalledTimes(5);
});

it('no-mistake stops on wrong answer and mistake shield is consumed once', async () => {
  const onAnswer = vi.fn()
    .mockResolvedValueOnce({ is_correct: false })
    .mockResolvedValueOnce({ is_correct: false });
  const onShieldConsumed = vi.fn();
  render(<NoMistakeRunner questions={questions.slice(0, 3)} deadline={Date.now() + 30_000} mistakeShield onAnswer={onAnswer} onShieldConsumed={onShieldConsumed} />);
  fireEvent.click(screen.getByRole('button', { name: 'ตัวเลือก A' }));
  await waitFor(() => expect(onShieldConsumed).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'ตัวเลือก A' }));
  await waitFor(() => expect(screen.getByText(/รอบจบแล้ว/)).toBeInTheDocument());
  expect(onAnswer).toHaveBeenCalledTimes(2);
});
