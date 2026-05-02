import { useGameStore } from '../store/gameStore';

export function LockedScreen() {
  const submitResult = useGameStore((s) => s.submitResult);
  const question = useGameStore((s) => s.question);

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-slate-900 px-6 py-12 text-center">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="waiting-glow waiting-glow-a" />
        <div className="waiting-glow waiting-glow-b" />
      </div>

      <div className="relative w-full max-w-md space-y-5 rounded-[30px] border border-white/10 bg-white/[0.04] px-6 py-8 shadow-2xl shadow-slate-950/30">
        <div className="text-5xl waiting-float">
          {submitResult ? '✅' : '⏳'}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Round status</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
            {submitResult ? 'ส่งคำตอบเรียบร้อย!' : 'กำลังรอ...'}
          </h2>
          <p className="mt-2 text-slate-400 text-sm">
            {submitResult
              ? 'โปรดรอผู้เล่นคนอื่น และพิธีกรกำลังจะเฉลยคำตอบ'
              : question
              ? 'การตอบคำถามถูกล็อคแล้ว รอให้พิธีกรเฉลยคำตอบ'
              : 'กำลังรอพิธีกรเปิดคำถาม...'}
          </p>
        </div>
      </div>
    </div>
  );
}
