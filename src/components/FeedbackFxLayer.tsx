import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { subscribeFeedbackFx } from '../lib/feedbackFx';

interface RippleFx {
  id: number;
  x: number;
  y: number;
}

interface BurstFx {
  id: number;
  mode: 'correct' | 'wrong' | 'timeout';
}

function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  return reduced;
}

export function FeedbackFxLayer() {
  const reducedMotion = useReducedMotionPreference();
  const [flashMode, setFlashMode] = useState<string | null>(null);
  const [shakeMode, setShakeMode] = useState<string | null>(null);
  const [lockPulse, setLockPulse] = useState(false);
  const [ripples, setRipples] = useState<RippleFx[]>([]);
  const [bursts, setBursts] = useState<BurstFx[]>([]);

  useEffect(() => {
    let nextId = 1;

    return subscribeFeedbackFx((event, detail) => {
      const addFlash = (mode: string, durationMs = 480) => {
        setFlashMode(mode);
        window.setTimeout(() => setFlashMode((current) => (current === mode ? null : current)), durationMs);
      };

      const addShake = (mode: string, durationMs = 450) => {
        if (reducedMotion) return;
        setShakeMode(mode);
        window.setTimeout(() => setShakeMode((current) => (current === mode ? null : current)), durationMs);
      };

      const addRipple = () => {
        if (reducedMotion) return;
        const id = nextId++;
        setRipples((current) => [
          ...current,
          {
            id,
            x: detail.clientX ?? window.innerWidth / 2,
            y: detail.clientY ?? window.innerHeight * 0.72,
          },
        ]);
        window.setTimeout(() => {
          setRipples((current) => current.filter((item) => item.id !== id));
        }, 700);
      };

      const addBurst = (mode: BurstFx['mode']) => {
        if (reducedMotion && mode === 'correct') return;
        const id = nextId++;
        setBursts((current) => [...current, { id, mode }]);
        window.setTimeout(() => {
          setBursts((current) => current.filter((item) => item.id !== id));
        }, 1100);
      };

      switch (event) {
        case 'countdownStart':
          addShake('fx-shake-countdown');
          break;
        case 'answerOpen':
          addFlash('fx-screen-flash fx-screen-flash-gold');
          break;
        case 'answerTap':
          addRipple();
          break;
        case 'answerLocked':
          if (!reducedMotion) {
            setLockPulse(true);
            window.setTimeout(() => setLockPulse(false), 520);
          }
          addFlash('fx-screen-flash fx-screen-flash-gold fx-screen-flash-lock', 360);
          break;
        case 'answerCorrect':
          addFlash('fx-screen-flash fx-screen-flash-correct');
          addBurst('correct');
          break;
        case 'answerWrong':
          addFlash('fx-screen-flash fx-screen-flash-wrong');
          addBurst('wrong');
          break;
        case 'timeout':
          addFlash('fx-screen-flash fx-screen-flash-timeout');
          addShake('fx-shake-timeout');
          addBurst('timeout');
          break;
        case 'reveal':
          addFlash('fx-screen-flash fx-screen-flash-reveal');
          break;
        case 'leaderboardShow':
          addFlash('fx-screen-flash fx-screen-flash-gold');
          break;
        case 'timerTickUrgent':
          // haptic-only; handled in feedbackFx.ts vibrate — no visual
          break;
        default:
          break;
      }
    });
  }, [reducedMotion]);

  const burstParticles = useMemo(() => Array.from({ length: 12 }, (_, i) => i), []);

  return (
    <div className={`fx-layer${shakeMode ? ` ${shakeMode}` : ''}`} aria-hidden>
      {flashMode && <div className={flashMode} />}

      {lockPulse && <div className="fx-lock-pulse" />}

      {ripples.map((ripple) => (
        <div
          key={ripple.id}
          className="fx-answer-ripple"
          style={{ left: ripple.x, top: ripple.y }}
        />
      ))}

      {bursts.map((burst) => (
        <div
          key={burst.id}
          className={`fx-correct-burst${burst.mode === 'wrong' ? ' fx-wrong-pulse' : ''}${burst.mode === 'timeout' ? ' fx-timeout-pulse' : ''}`}
        >
          {burstParticles.map((index) => (
            <span
              key={index}
              className="fx-burst-particle"
              style={{ '--fx-angle': `${index * 30}deg` } as CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
