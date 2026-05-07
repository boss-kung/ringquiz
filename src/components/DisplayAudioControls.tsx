import { useMemo, useState } from 'react';
import { useDisplayAudioController } from '../lib/displayAudio';

export function DisplayAudioControls() {
  const audio = useDisplayAudioController();
  const enabled = audio.isEnabled();
  const muted = audio.isMuted();
  const volume = audio.getVolume();
  const [collapsed, setCollapsed] = useState(false);

  const volumePercent = useMemo(() => Math.round(volume * 100), [volume]);

  const handleEnable = async () => {
    await audio.enable();
    audio.play('uiClick', { restart: true });
  };

  return (
    <div className={`display-audio-controls${collapsed ? ' is-collapsed' : ''}`}>
      <button
        type="button"
        className="display-audio-toggle"
        onClick={() => setCollapsed((prev) => !prev)}
      >
        {collapsed ? 'Audio' : 'Hide'}
      </button>

      {!collapsed && (
        <>
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
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={volumePercent}
                  onChange={(event) => audio.setVolume(Number(event.target.value) / 100)}
                />
              </label>
            </>
          )}
        </>
      )}
    </div>
  );
}
