import { useState, useEffect } from 'react';
import { usePlayerSession } from '../hooks/usePlayerSession';
import { DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH } from '../lib/constants';

export function JoinScreen() {
  const { join, loading, error, savedName } = usePlayerSession();
  const [name, setName] = useState(savedName);

  useEffect(() => { setName(savedName); }, [savedName]);

  const canSubmit = name.trim().length >= DISPLAY_NAME_MIN_LENGTH && !loading;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) join(name.trim());
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-12 bg-slate-900">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white tracking-tight">Quiz Game</h1>
          <p className="mt-2 text-slate-400">Enter your name to join</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoFocus
            className="w-full rounded-xl bg-white/10 text-white placeholder-slate-500
              px-4 py-4 text-lg border border-white/10 focus:outline-none
              focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-xl bg-indigo-600 text-white font-bold text-lg py-4
              disabled:opacity-40 disabled:cursor-not-allowed
              active:scale-95 transition-transform"
          >
            {loading ? 'Joining…' : 'Join Game'}
          </button>
        </form>
      </div>
    </div>
  );
}
