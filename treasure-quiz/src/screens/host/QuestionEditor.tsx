import type { QuestionDraft } from '../../domain/types';

interface QuestionEditorProps {
  questions: QuestionDraft[];
  onChange: (questions: QuestionDraft[]) => void;
}

const required = (roundNo: number) => roundNo <= 2 ? 10 : 5;

export default function QuestionEditor({ questions, onChange }: QuestionEditorProps) {
  const roundCounts = new Map<number, number>();
  for (const question of questions) roundCounts.set(question.roundNo, (roundCounts.get(question.roundNo) ?? 0) + 1);
  const invalidQuestions = questions.flatMap((question) => {
    const errors: string[] = [];
    if (!question.keyword.trim()) errors.push(`ข้อ ${question.position} ต้องมี keyword`);
    if (new Set(question.choices).size !== question.choices.length) errors.push(`ข้อ ${question.position} มีตัวเลือกซ้ำ`);
    if (!question.choices.includes(question.correctAnswer)) errors.push(`ข้อ ${question.position} ต้องมีคำตอบที่ถูกในตัวเลือก`);
    return errors;
  });

  const updateQuestion = (index: number, field: keyof QuestionDraft, value: string) => {
    const next = [...questions];
    next[index] = { ...next[index], [field]: value } as QuestionDraft;
    onChange(next);
  };

  const updateChoices = (index: number, value: string) => {
    const next = [...questions];
    next[index] = { ...next[index], choices: value.split('|').map((choice) => choice.trim()) };
    onChange(next);
  };

  return (
    <section className="setup-section" aria-labelledby="questions-title">
      <div className="section-heading"><div><p className="eyebrow">01 · QUESTION BANK</p><h2 id="questions-title">คำถาม 8 รอบ</h2></div><span className="count-pill">{`${questions.length}/50`}</span></div>
      <div className="round-grid">
        {Array.from({ length: 8 }, (_, index) => index + 1).map((roundNo) => <div className="round-chip" key={roundNo}><span>{`รอบ ${roundNo} · ${roundCounts.get(roundNo) ?? 0} ข้อ`}</span><small>เป้า {required(roundNo)}</small></div>)}
      </div>
      <div className="validation-list" aria-live="polite">
        {questions.length !== 50 ? <p className="inline-error">{`ต้องมีคำถามครบ 50 ข้อ (ตอนนี้ ${questions.length}/50)`}</p> : null}
        {invalidQuestions.slice(0, 4).map((error) => <p className="inline-error" key={error}>{error}</p>)}
      </div>
      <div className="question-list">
        {questions.map((question, index) => <details key={question.id ?? `${question.roundNo}-${question.position}`} open={index === 0}>
          <summary><span>ข้อ {index + 1} · รอบ {question.roundNo}</span><small>{question.keyword || 'ยังไม่มี keyword'}</small></summary>
          <div className="question-fields">
            <label>โจทย์<input value={question.prompt} onChange={(event) => updateQuestion(index, 'prompt', event.target.value)} /></label>
            <label>Keyword<input value={question.keyword} onChange={(event) => updateQuestion(index, 'keyword', event.target.value)} /></label>
            <label>ตัวเลือก (คั่นด้วย |)<input value={question.choices.join(' | ')} onChange={(event) => updateChoices(index, event.target.value)} /></label>
            <label>คำตอบที่ถูก<input value={question.correctAnswer} onChange={(event) => updateQuestion(index, 'correctAnswer', event.target.value)} /></label>
          </div>
        </details>)}
      </div>
    </section>
  );
}

export function questionEditorHasErrors(questions: QuestionDraft[]): boolean {
  const requiredByRound = (roundNo: number) => roundNo <= 2 ? 10 : 5;
  const counts = new Map<number, number>();
  for (const question of questions) counts.set(question.roundNo, (counts.get(question.roundNo) ?? 0) + 1);
  return questions.length !== 50 || Array.from({ length: 8 }, (_, index) => index + 1).some((roundNo) => (counts.get(roundNo) ?? 0) !== requiredByRound(roundNo)) || questions.some((question) => !question.keyword.trim() || new Set(question.choices).size !== question.choices.length || !question.choices.includes(question.correctAnswer));
}
