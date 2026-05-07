import { useMemo } from 'react';
import { useDisplayAudioController } from '../lib/displayAudio';

const VOLUME_PRESETS = [
  { label: 'Low', value: 0.35 },
  { label: 'Mid', value: 0.55 },
  { label: 'High', value: 0.75 },
];

export function DisplayAudioControls() {
  const audio = useDisplayAudioController();
  const enabled = audio.isEnabled();
  const muted = audio.isMuted();
  const volume = audio.getVolume();

  const volumePercent = useMemo(() => Math.round(volume * 100), [volume]);

  const handleEnable = async () => {
    await audio.enable();
    audio.play('uiClick', { restart: true });
  };

  return (
    <div className="display-audio-controls">
      {!enabled ? (
        <button
          type="button"
          className="display-audio-enable"
          onClick={handleEnable}
        >
          <span>Enable Audio</span>
          <small>Click once to allow show sounds</small>
        </button>
      ) : (
        <>
          <div className="display-audio-row">
            <button
              type="button"
              className={`display-audio-muted${muted ? ' is-muted' : ''}`}
              onClick={() => {
                audio.setMuted(!muted);
                if (!muted) return;
                audio.play('uiClick', { restart: true });
              }}
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              className="display-audio-test"
              onClick={() => audio.play('uiClick', { restart: true })}
            >
              Test
            </button>
          </div>

          <label className="display-audio-volume">
            <span>Volume {volumePercent}%</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={volumePercent}
              onChange={(event) => audio.setVolume(Number(event.target.value) / 100)}
            />
          </label>

          <div className="display-audio-presets">
            {VOLUME_PRESETS.map((preset) => {
              const active = Math.abs(volume - preset.value) < 0.03;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={active ? 'is-active' : ''}
                  onClick={() => audio.setVolume(preset.value)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
