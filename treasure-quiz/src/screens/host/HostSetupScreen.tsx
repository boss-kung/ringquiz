import { useMemo, useState } from 'react';
import type { ChestDraft, HostActionCaller, QuestionDraft, RewardDraft } from '../../domain/types';
import QuestionEditor, { questionEditorHasErrors } from './QuestionEditor';
import ChestSettingsEditor from './ChestSettingsEditor';
import RewardCatalogEditor from './RewardCatalogEditor';

interface HostSetupScreenProps {
  initialQuestions: QuestionDraft[];
  initialChests: ChestDraft[];
  initialRewards?: RewardDraft[];
  pinError?: string;
  action: HostActionCaller;
  onCreated?: (game: { id: string }) => void;
}

export default function HostSetupScreen({ initialQuestions, initialChests, initialRewards = [], pinError, action, onCreated }: HostSetupScreenProps) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [chests] = useState(initialChests);
  const [rewards] = useState(initialRewards);
  const [saving, setSaving] = useState(false);
  const chestInvalid = chests.some((chest) => chest.rewardTable.reduce((sum, reward) => sum + reward.weight, 0) !== 100);
  const questionInvalid = questionEditorHasErrors(questions);
  const invalid = questionInvalid || chestInvalid;
  const summary = useMemo(() => `${questions.length} คำถาม · ${chests.length} หีบ · ${rewards.length} รางวัล`, [questions.length, chests.length, rewards.length]);

  const createGame = async () => {
    if (invalid || saving) return;
    setSaving(true);
    try {
      const response = await action<{ game?: { id: string } }>('create_game', { questions, chests, rewards });
      if (response.game) onCreated?.(response.game);
    } finally { setSaving(false); }
  };

  const saveQuestions = async () => {
    if (questionInvalid || saving) return;
    setSaving(true);
    try {
      for (const question of questions) await action('save_question', question);
      for (const chest of chests) await action('save_chest_type', chest);
      for (const reward of rewards) await action('save_reward_item', reward);
    } finally { setSaving(false); }
  };

  return <main className="host-screen setup-screen">
    <header className="screen-header"><div><p className="eyebrow">TREASURE QUIZ · SETUP</p><h1>จัดโต๊ะสมบัติ</h1><p className="lead">{summary}</p></div><span className="live-badge">PRIVATE DUEL</span></header>
    {pinError ? <p className="inline-error banner-error" role="alert">{pinError}</p> : null}
    <div className="setup-stack"><QuestionEditor questions={questions} onChange={setQuestions} /><ChestSettingsEditor chests={chests} /><RewardCatalogEditor rewards={rewards} /></div>
    <footer className="setup-footer"><p className="muted">ตรวจครบแล้วจึงบันทึกและสร้างเกม</p><button className="primary-button" onClick={createGame} disabled={invalid || saving}>{saving ? 'กำลังสร้าง…' : 'สร้างเกม'}</button><button className="secondary-button" onClick={saveQuestions} disabled={questionInvalid || saving}>บันทึกคำถาม</button></footer>
  </main>;
}
