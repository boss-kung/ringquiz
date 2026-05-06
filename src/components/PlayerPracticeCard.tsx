import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { supabase } from '../lib/supabase';
import { resolveQuestionImageUrl } from '../lib/questionAssets';
import type { CirclePosition, PracticeContent } from '../lib/types';
import { QuestionImage } from './QuestionImage';

interface PracticeMaskData {
  width: number;
  height: number;
  imageData: ImageData;
}

interface PracticeQuestionConfig extends PracticeContent {
  id: string;
  title: string;
  prompt: string;
  instruction: string;
  imageUrl: string;
  maskUrl: string;
  revealOverlayUrl?: string;
  answerRadius: number;
}

type FeedbackKind = 'idle' | 'correct' | 'close' | 'wrong';

const PRACTICE_MASK_ALPHA_THRESHOLD = 10;
// Multiplier for "close" check — expand search radius without counting as correct
const CLOSE_RADIUS_MULTIPLIER = 1.9;
// Number of local confetti particles on correct
const CONFETTI_COUNT = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function withBaseUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${path.replace(/^\//, '')}`;
}

const PRACTICE_QUESTION: PracticeQuestionConfig = {
  key: 'waiting_practice',
  id: 'local-practice-1',
  title: 'มาซ้อมก่อนเริ่มเกมกันเถอะ!',
  prompt: 'ซ้อมก่อนเริ่ม',
  instruction: 'วิธีเล่น: อ่านโจทย์ → วางวงกลมที่คิดว่าเป็นคำตอบ → กดปุ่มยืนยันคำตอบ',
  imageUrl: withBaseUrl('practice/practice-demo-image.svg'),
  maskUrl: withBaseUrl('practice/practice-demo-mask.svg'),
  revealOverlayUrl: withBaseUrl('practice/practice-demo-reveal.svg'),
  answerRadius: 0.085,
  image_url: 'practice/practice-demo-image.svg',
  mask_url: 'practice/practice-demo-mask.svg',
  reveal_image_url: 'practice/practice-demo-reveal.svg',
  circle_radius_ratio: 0.085,
  image_width: 1200,
  image_height: 900,
  mask_width: 1200,
  mask_height: 900,
};

function resolvePracticeAssetUrl(path: string | null | undefined): string | null {
  if (!path?.trim()) return null;
  const trimmed = path.trim();
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('practice/') || trimmed.startsWith('/practice/')) return withBaseUrl(trimmed);
  return resolveQuestionImageUrl(trimmed);
}

async function loadMaskData(url: string): Promise<PracticeMaskData> {
  const img = new Image();
  img.decoding = 'async';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load practice mask image'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Mask canvas context unavailable');
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  return {
    width: canvas.width,
    height: canvas.height,
    imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
  };
}

function evaluateMaskOverlap(
  answer: CirclePosition,
  answerRadius: number,
  mask: PracticeMaskData,
  alphaThreshold: number,
  radiusMultiplier = 1,
): boolean {
  const centerX = answer.xRatio * mask.width;
  const centerY = answer.yRatio * mask.height;
  const radiusPx = answerRadius * mask.width * radiusMultiplier;

  const minX = clamp(Math.floor(centerX - radiusPx), 0, mask.width - 1);
  const maxX = clamp(Math.ceil(centerX + radiusPx), 0, mask.width - 1);
  const minY = clamp(Math.floor(centerY - radiusPx), 0, mask.height - 1);
  const maxY = clamp(Math.ceil(centerY + radiusPx), 0, mask.height - 1);

  const radiusSq = radiusPx * radiusPx;
  const data = mask.imageData.data;

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px + 0.5 - centerX;
      const dy = py + 0.5 - centerY;
      if (dx * dx + dy * dy > radiusSq) continue;

      const alpha = data[(py * mask.width + px) * 4 + 3];
      if (alpha > alphaThreshold) {
        return true;
      }
    }
  }

  return false;
}

// Lightweight confetti particle data (static per render)
const CONFETTI_COLORS = ['#F5C74A', '#34D399', '#818CF8', '#FB7185', '#FFF8E7'];
interface ConfettiParticle {
  id: number;
  color: string;
  angle: number;  // degrees
  distance: number; // px
  size: number;
}
function makeConfetti(): ConfettiParticle[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    angle: (360 / CONFETTI_COUNT) * i + Math.random() * 14 - 7,
    distance: 38 + Math.random() * 28,
    size: 4 + Math.random() * 4,
  }));
}

export function PlayerPracticeCard() {
  const [practiceQuestion, setPracticeQuestion] = useState<PracticeQuestionConfig>(PRACTICE_QUESTION);
  const [maskData, setMaskData] = useState<PracticeMaskData | null>(null);
  const [maskError, setMaskError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<CirclePosition | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('idle');
  const [confetti, setConfetti] = useState<ConfettiParticle[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadPracticeContent = async () => {
      const { data, error } = await supabase
        .from('practice_content')
        .select('*')
        .eq('key', 'waiting_practice')
        .maybeSingle();

      if (cancelled || error || !data) return;

      setPracticeQuestion({
        key: data.key,
        id: data.key,
        title: data.title,
        prompt: data.prompt,
        instruction: data.instruction,
        imageUrl: resolvePracticeAssetUrl(data.image_url) ?? PRACTICE_QUESTION.imageUrl,
        maskUrl: resolvePracticeAssetUrl(data.mask_url) ?? PRACTICE_QUESTION.maskUrl,
        revealOverlayUrl: resolvePracticeAssetUrl(data.reveal_image_url) ?? undefined,
        answerRadius: data.circle_radius_ratio,
        image_url: data.image_url,
        mask_url: data.mask_url,
        reveal_image_url: data.reveal_image_url,
        circle_radius_ratio: data.circle_radius_ratio,
        image_width: data.image_width,
        image_height: data.image_height,
        mask_width: data.mask_width,
        mask_height: data.mask_height,
        created_at: data.created_at,
        updated_at: data.updated_at,
      });
    };

    void loadPracticeContent();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadMaskData(practiceQuestion.maskUrl)
      .then((loaded) => {
        setMaskData(loaded);
        setMaskError(null);
      })
      .catch(() => {
        setMaskData(null);
        setMaskError('โหลดโหมดซ้อมไม่สำเร็จ');
      });
  }, [practiceQuestion.maskUrl]);

  const resetPractice = useCallback(() => {
    setAnswer(null);
    setSubmitted(false);
    setFeedbackKind('idle');
    setConfetti([]);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!answer) {
      setFeedbackKind('idle');
      return;
    }
    if (!maskData) {
      return;
    }

    // Local-only practice mode:
    // This evaluation must never call submit-answer and must never write to
    // Supabase or affect any live game state, stats, scores, or answers rows.
    const correct = evaluateMaskOverlap(answer, practiceQuestion.answerRadius, maskData, PRACTICE_MASK_ALPHA_THRESHOLD, 1);
    const close = !correct && evaluateMaskOverlap(answer, practiceQuestion.answerRadius, maskData, PRACTICE_MASK_ALPHA_THRESHOLD, CLOSE_RADIUS_MULTIPLIER);

    setSubmitted(true);

    if (correct) {
      setFeedbackKind('correct');
      setConfetti(makeConfetti());
    } else if (close) {
      setFeedbackKind('close');
    } else {
      setFeedbackKind('wrong');
    }
  }, [answer, maskData, practiceQuestion.answerRadius]);

  const feedbackMessage = (): string | null => {
    if (!submitted) return null;
    switch (feedbackKind) {
      case 'correct': return 'โดนแล้ว!';
      case 'close': return 'ใกล้มาก ลองขยับอีกนิด';
      case 'wrong': return 'ยังไม่โดน ลองใหม่';
      default: return null;
    }
  };

  const frameClass = [
    'pw-practice-frame',
    submitted ? `is-${feedbackKind}` : '',
  ].filter(Boolean).join(' ');

  const msg = feedbackMessage() ?? maskError;

  return (
    <section className="pw-practice-zone gr-card">
      <div className="pw-practice-head">
        <div>
          <h2 className="pw-practice-title">{practiceQuestion.title}</h2>
          <p className="pw-practice-note" style={{ fontSize: 14 }}>
            ไม่นับคะแนนในเกมจริง
          </p>
        </div>
      </div>

      <p className="pw-practice-tip">{practiceQuestion.instruction}</p>
      <div className="pw-practice-prompt gr-card">
        <div className="gr-label-xs" style={{ marginBottom: 6 }}>Practice Question</div>
        <p className="gr-qtext" style={{ margin: 0, textAlign: 'left' }}>{practiceQuestion.prompt}</p>
      </div>

      <div
        className={frameClass}
        style={{ touchAction: 'none', position: 'relative' }}
      >
        <div className="quiz-image-stage pw-practice-stage">
          <QuestionImage
            imageUrl={practiceQuestion.imageUrl}
            circleRadiusRatio={practiceQuestion.answerRadius}
            circle={answer}
            onCircleChange={(pos) => {
              if (submitted) return;
              setFeedbackKind('idle');
              setAnswer(pos);
            }}
            locked={submitted}
            maskOverlayUrl={submitted ? (practiceQuestion.revealOverlayUrl ?? practiceQuestion.maskUrl) : undefined}
            maskOverlayClassName={submitted ? 'reveal-mask-static' : undefined}
            shellClassName="quiz-image-shell--question pw-practice-shell"
            circleClassName={[
              'pw-circle',
              submitted ? 'is-locked' : '',
              submitted && feedbackKind === 'correct' ? 'is-correct' : '',
              submitted && feedbackKind === 'close' ? 'is-close' : '',
              submitted && feedbackKind === 'wrong' ? 'is-wrong' : '',
            ].filter(Boolean).join(' ')}
          />
        </div>

        {!answer && !submitted && (
          <div className="pw-practice-hint">แตะแล้วลากได้</div>
        )}

        {/* Local confetti on correct — never writes to Supabase */}
        {feedbackKind === 'correct' && confetti.map((p) => (
          <div
            key={p.id}
            className="pw-confetti-dot"
            style={{
              '--pw-angle': `${p.angle}deg`,
              '--pw-distance': `${p.distance}px`,
              width: p.size,
              height: p.size,
              background: p.color,
              left: answer ? `${answer.xRatio * 100}%` : '50%',
              top: answer ? `${answer.yRatio * 100}%` : '50%',
            } as CSSProperties}
          />
        ))}
      </div>

      <div className="pw-practice-actions">
        <button type="button" className="pw-submit-btn" onClick={handleSubmit} disabled={submitted || !answer}>
          {submitted ? 'ส่งแล้ว' : 'ยืนยันคำตอบ'}
        </button>
        <button type="button" className="pw-reset-btn" onClick={resetPractice}>
          {submitted ? 'ลองใหม่' : 'เริ่มใหม่'}
        </button>
      </div>
      <div
        className={[
          'pw-practice-feedback',
          submitted && feedbackKind !== 'idle' ? `is-${feedbackKind}` : '',
          !msg ? 'is-empty' : '',
        ].filter(Boolean).join(' ')}
      >
        {msg ?? ' '}
      </div>
    </section>
  );
}
