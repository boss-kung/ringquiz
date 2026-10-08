import { useState } from 'react';

interface TrueFalseQuestionProps { prompt: string; onAnswer: (answer: string) => void | Promise<void>; disabled?: boolean; }

export default function TrueFalseQuestion({ prompt, onAnswer, disabled = false }: TrueFalseQuestionProps) {
  const [answered, setAnswered] = useState(false);
  const choose = (answer: string) => { if (answered || disabled) return; setAnswered(true); void onAnswer(answer); };
  return <div className="question-card"><p className="question-prompt">{prompt}</p><div className="answer-grid two"><button type="button" disabled={disabled || answered} onClick={() => choose('ใช่')}>ใช่</button><button type="button" disabled={disabled || answered} onClick={() => choose('ไม่ใช่')}>ไม่ใช่</button></div></div>;
}
