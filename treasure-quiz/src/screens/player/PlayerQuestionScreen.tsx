import { useMemo, useState } from 'react';
import type { PlayerActionCaller } from '../../domain/types';
import TrueFalseQuestion from '../../components/questions/TrueFalseQuestion';
import MultipleChoiceQuestion from '../../components/questions/MultipleChoiceQuestion';
import TimeBankRunner, { type RuntimeQuestion } from '../../components/questions/TimeBankRunner';
import NoMistakeRunner from '../../components/questions/NoMistakeRunner';
import ServerTimer from '../../components/ServerTimer';

interface PlayerQuestion { id: string; prompt: string; choices: string[]; questions?: RuntimeQuestion[]; }
interface PlayerQuestionScreenProps { gameId: string; roundNo: number; question: PlayerQuestion; deadline: string | number; action: PlayerActionCaller; onComplete?: () => void; }

interface SequentialRunnerProps {
  questions: RuntimeQuestion[];
  deadline: string | number;
  trueFalse?: boolean;
  onAnswer: (question: RuntimeQuestion, answer: string) => Promise<{ is_correct?: boolean } | void>;
  onComplete?: () => void;
}

function SequentialRunner({ questions, deadline, trueFalse = false, onAnswer, onComplete }: SequentialRunnerProps) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const question = questions[index];
  const complete = () => { if (stopped) return; setStopped(true); onComplete?.(); };
  if (!question || stopped) return <div className="question-card"><p>รอบจบแล้ว รอ Host เปิดผล</p></div>;
  const answer = async (value: string) => {
    await onAnswer(question, value);
    if (index >= questions.length - 1) complete(); else setIndex((current) => current + 1);
  };
  return <div className="runner"><ServerTimer deadline={deadline} onExpire={complete} />{trueFalse
    ? <TrueFalseQuestion key={question.id} prompt={question.prompt} onAnswer={answer} />
    : <MultipleChoiceQuestion key={question.id} prompt={question.prompt} choices={question.choices} onAnswer={answer} />}</div>;
}

export default function PlayerQuestionScreen({ gameId, roundNo, question, deadline, action, onComplete }: PlayerQuestionScreenProps) {
  const [expired, setExpired] = useState(() => (typeof deadline === 'number' ? deadline : Date.parse(deadline)) <= Date.now());
  const [error, setError] = useState('');
  const questions = useMemo(() => question.questions?.length ? question.questions : [{ id: question.id, prompt: question.prompt, choices: question.choices }], [question]);
  const submit = async (current: RuntimeQuestion, answer: string) => {
    const response = await action<{ answer?: { is_correct?: boolean } }>('submit_answer', { gameId, roundNo, questionId: current.id, answer });
    return { is_correct: response?.answer?.is_correct };
  };
  if (expired) return <main className="player-screen question-screen"><p className="eyebrow">ROUND {roundNo}</p><h1>หมดเวลา</h1><p className="lead">รอ Host เปิดผลรอบนี้</p></main>;
  const onExpire = () => setExpired(true);
  return <main className="player-screen question-screen"><header className="screen-header"><div><p className="eyebrow">ROUND {roundNo} · PLAY</p><h1>ตอบให้ไวและแม่น</h1></div><ServerTimer deadline={deadline} onExpire={onExpire} /></header>{error ? <p role="alert" className="inline-error">{error}</p> : null}{roundNo <= 2 ? <SequentialRunner questions={questions} deadline={deadline} trueFalse onAnswer={submit} onComplete={onComplete} /> : roundNo <= 4 ? <SequentialRunner questions={questions} deadline={deadline} onAnswer={submit} onComplete={onComplete} /> : roundNo <= 6 ? <TimeBankRunner questions={questions} deadline={deadline} onAnswer={submit} onComplete={onComplete} /> : <NoMistakeRunner questions={questions} deadline={deadline} onAnswer={submit} onComplete={() => onComplete?.()} />}</main>;
}
