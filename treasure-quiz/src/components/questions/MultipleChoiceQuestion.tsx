import { useState } from 'react';

interface MultipleChoiceQuestionProps { prompt: string; choices: string[]; onAnswer: (answer: string) => void | Promise<void>; disabled?: boolean; }

export default function MultipleChoiceQuestion({ prompt, choices, onAnswer, disabled = false }: MultipleChoiceQuestionProps) {
  const [answered, setAnswered] = useState(false);
  const choose = (answer: string) => { if (answered || disabled) return; setAnswered(true); void onAnswer(answer); };
  return <div className="question-card"><p className="question-prompt">{prompt}</p><div className="answer-grid">{choices.map((choice) => <button type="button" key={choice} disabled={disabled || answered} onClick={() => choose(choice)}>ตัวเลือก {choice}</button>)}</div></div>;
}
