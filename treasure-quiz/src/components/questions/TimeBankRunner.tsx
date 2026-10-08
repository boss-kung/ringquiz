import { useState } from 'react';
import ServerTimer from '../ServerTimer';
import MultipleChoiceQuestion from './MultipleChoiceQuestion';

export interface RuntimeQuestion { id: string; prompt: string; keyword?: string; choices: string[]; }
export interface SubmitResult { is_correct?: boolean; }
interface TimeBankRunnerProps { questions: RuntimeQuestion[]; deadline: string | number; onAnswer: (question: RuntimeQuestion, answer: string) => Promise<SubmitResult | void>; onComplete?: () => void; }

export default function TimeBankRunner({ questions, deadline, onAnswer, onComplete }: TimeBankRunnerProps) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const question = questions[index];
  const complete = () => { if (stopped) return; setStopped(true); onComplete?.(); };
  if (!question || stopped) return <div className="question-card"><p>รอบจบแล้ว</p></div>;
  const answer = async (value: string) => {
    await onAnswer(question, value);
    if (index >= questions.length - 1) complete(); else setIndex((current) => current + 1);
  };
  return <div className="runner"><ServerTimer deadline={deadline} onExpire={complete} /><MultipleChoiceQuestion key={question.id} prompt={question.prompt} choices={question.choices} onAnswer={answer} /></div>;
}
