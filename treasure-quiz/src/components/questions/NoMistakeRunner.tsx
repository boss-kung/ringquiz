import { useState } from 'react';
import ServerTimer from '../ServerTimer';
import MultipleChoiceQuestion from './MultipleChoiceQuestion';
import type { RuntimeQuestion, SubmitResult } from './TimeBankRunner';

interface NoMistakeRunnerProps { questions: RuntimeQuestion[]; deadline: string | number; mistakeShield?: boolean; onAnswer: (question: RuntimeQuestion, answer: string) => Promise<SubmitResult | void>; onShieldConsumed?: () => void; onComplete?: (result: { failed: boolean }) => void; }

export default function NoMistakeRunner({ questions, deadline, mistakeShield = false, onAnswer, onShieldConsumed, onComplete }: NoMistakeRunnerProps) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [shieldUsed, setShieldUsed] = useState(false);
  const question = questions[index];
  const finish = (failed: boolean) => { if (stopped) return; setStopped(true); onComplete?.({ failed }); };
  if (!question || stopped) return <div className="question-card"><p>รอบจบแล้ว</p></div>;
  const answer = async (value: string) => {
    const result = await onAnswer(question, value);
    if (result?.is_correct === false) {
      if (mistakeShield && !shieldUsed) { setShieldUsed(true); onShieldConsumed?.(); setIndex((current) => current + 1); }
      else finish(true);
    } else if (index >= questions.length - 1) finish(false);
    else setIndex((current) => current + 1);
  };
  return <div className="runner"><ServerTimer deadline={deadline} onExpire={() => finish(true)} /><MultipleChoiceQuestion key={question.id} prompt={question.prompt} choices={question.choices} onAnswer={answer} /></div>;
}
