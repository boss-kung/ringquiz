import { useEffect, useState } from 'react';
import { isSoundFxEnabled, setSoundFxEnabled, triggerFeedbackFx, unlockFeedbackAudio } from '../lib/feedbackFx';

interface Props {
  /** Compact mode: icon-only button for HUD use */
  compact?: boolean;
}

export function SoundFxToggle({ compact = false }: Props) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isSoundFxEnabled());
  }, []);

  const handleClick = () => {
    const next = !enabled;
    setSoundFxEnabled(next);
    setEnabled(next);
    if (next) {
      // Must happen inside user gesture for iOS Safari AudioContext unlock
      void unlockFeedbackAudio().then(() => {
        triggerFeedbackFx('joinSuccess');
      });
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`gr-sound-toggle${enabled ? ' gr-sound-toggle-on' : ''}`}
        aria-label={enabled ? 'ปิดเสียงเอฟเฟกต์' : 'เปิดเสียงเอฟเฟกต์'}
        title={enabled ? 'ปิดเสียงเอฟเฟกต์' : 'เปิดเสียงเอฟเฟกต์'}
      >
        {enabled ? '🔊' : '🔇'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`gr-sound-toggle gr-sound-toggle-full${enabled ? ' gr-sound-toggle-on' : ''}`}
    >
      <span className="gr-sound-toggle-icon">{enabled ? '🔊' : '🔇'}</span>
      <span className="gr-sound-toggle-label">
        {enabled ? 'เสียงเปิดอยู่' : 'เปิดเสียงเอฟเฟกต์'}
      </span>
    </button>
  );
}
