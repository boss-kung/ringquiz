import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface PracticeCircle {
  x: number;
  y: number;
  r: number;
}

interface PracticeMaskData {
  width: number;
  height: number;
  imageData: ImageData;
}

interface PracticeQuestionConfig {
  id: string;
  title: string;
  prompt: string;
  instruction: string;
  imageUrl: string;
  maskUrl: string;
  revealOverlayUrl?: string;
  answerRadius: number;
}

interface ContainedImageRect {
  renderedWidth: number;
  renderedHeight: number;
  offsetX: number;
  offsetY: number;
}

const PRACTICE_MASK_ALPHA_THRESHOLD = 10;

function withBaseUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${path.replace(/^\//, '')}`;
}

const PRACTICE_QUESTION: PracticeQuestionConfig = {
  id: 'local-practice-1',
  title: 'Practice Question',
  prompt: 'ลองแตะตำแหน่งที่คิดว่า “วงแหวนทอง” ซ่อนอยู่ในภาพ',
  instruction: 'ฝึกวางวงคำตอบก่อนเกมจริง คำตอบนี้ตรวจเฉพาะในเครื่องของคุณเท่านั้น',
  imageUrl: withBaseUrl('practice/practice-demo-image.svg'),
  maskUrl: withBaseUrl('practice/practice-demo-mask.svg'),
  revealOverlayUrl: withBaseUrl('practice/practice-demo-reveal.svg'),
  answerRadius: 0.085,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getContainedImageRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): ContainedImageRect {
  if (!containerWidth || !containerHeight || !imageWidth || !imageHeight) {
    return { renderedWidth: 0, renderedHeight: 0, offsetX: 0, offsetY: 0 };
  }

  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;

  return {
    renderedWidth,
    renderedHeight,
    offsetX: (containerWidth - renderedWidth) / 2,
    offsetY: (containerHeight - renderedHeight) / 2,
  };
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
  answer: PracticeCircle,
  mask: PracticeMaskData,
  alphaThreshold: number,
): boolean {
  const centerX = answer.x * mask.width;
  const centerY = answer.y * mask.height;
  const radiusPx = answer.r * mask.width;

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

export function PlayerPracticeCard() {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragPointerId = useRef<number | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [maskData, setMaskData] = useState<PracticeMaskData | null>(null);
  const [maskError, setMaskError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<PracticeCircle | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const containedRect = useMemo(
    () => getContainedImageRect(frameSize.width, frameSize.height, imageSize.width, imageSize.height),
    [frameSize.height, frameSize.width, imageSize.height, imageSize.width],
  );

  useEffect(() => {
    loadMaskData(PRACTICE_QUESTION.maskUrl)
      .then((loaded) => {
        setMaskData(loaded);
        setMaskError(null);
      })
      .catch(() => {
        setMaskData(null);
        setMaskError('โหลดพื้นที่เฉลยสำหรับโหมดฝึกซ้อมไม่สำเร็จ');
      });
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const sync = () => {
      const rect = frame.getBoundingClientRect();
      setFrameSize({ width: rect.width, height: rect.height });
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!maskData || !imageSize.width || !imageSize.height) return;
    if (maskData.width !== imageSize.width || maskData.height !== imageSize.height) {
      console.warn(
        '[PracticeMode] Practice image and mask dimensions differ.',
        {
          imageWidth: imageSize.width,
          imageHeight: imageSize.height,
          maskWidth: maskData.width,
          maskHeight: maskData.height,
        },
      );
    }
  }, [imageSize.height, imageSize.width, maskData]);

  const answerPxRadius = containedRect.renderedWidth * PRACTICE_QUESTION.answerRadius;

  const resetPractice = useCallback(() => {
    setAnswer(null);
    setSubmitted(false);
    setIsCorrect(null);
    setMessage(null);
  }, []);

  const getCircleFromPointer = useCallback((clientX: number, clientY: number, clampToImage: boolean): PracticeCircle | null => {
    const frame = frameRef.current;
    if (!frame) return null;

    const frameRect = frame.getBoundingClientRect();
    const localX = clientX - frameRect.left;
    const localY = clientY - frameRect.top;

    const minX = containedRect.offsetX;
    const minY = containedRect.offsetY;
    const maxX = minX + containedRect.renderedWidth;
    const maxY = minY + containedRect.renderedHeight;

    const isOutside = localX < minX || localX > maxX || localY < minY || localY > maxY;
    if (isOutside && !clampToImage) return null;

    const safeX = clamp(localX, minX, maxX);
    const safeY = clamp(localY, minY, maxY);

    return {
      x: containedRect.renderedWidth > 0 ? (safeX - minX) / containedRect.renderedWidth : 0,
      y: containedRect.renderedHeight > 0 ? (safeY - minY) / containedRect.renderedHeight : 0,
      r: PRACTICE_QUESTION.answerRadius,
    };
  }, [containedRect.offsetX, containedRect.offsetY, containedRect.renderedHeight, containedRect.renderedWidth]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (submitted || !containedRect.renderedWidth || !containedRect.renderedHeight) return;
    const next = getCircleFromPointer(e.clientX, e.clientY, false);
    if (!next) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragPointerId.current = e.pointerId;
    setMessage(null);
    setAnswer(next);
  }, [containedRect.renderedHeight, containedRect.renderedWidth, getCircleFromPointer, submitted]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (submitted || dragPointerId.current !== e.pointerId) return;
    const next = getCircleFromPointer(e.clientX, e.clientY, true);
    if (!next) return;
    e.preventDefault();
    setAnswer(next);
  }, [getCircleFromPointer, submitted]);

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragPointerId.current === e.pointerId) {
      dragPointerId.current = null;
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!answer) {
      setMessage('วางวงคำตอบบนภาพก่อน แล้วค่อยส่งคำตอบฝึกซ้อม');
      return;
    }
    if (!maskData) {
      setMessage(maskError ?? 'ยังโหลดพื้นที่เฉลยไม่พร้อม ลองใหม่อีกครั้ง');
      return;
    }

    // Local-only practice mode:
    // This evaluation must never call submit-answer and must never write to
    // Supabase or affect any live game state, stats, scores, or answers rows.
    const correct = evaluateMaskOverlap(answer, maskData, PRACTICE_MASK_ALPHA_THRESHOLD);

    setSubmitted(true);
    setIsCorrect(correct);
    setMessage(
      correct
        ? 'ถูกต้อง! วงของคุณแตะพื้นที่เฉลยแล้ว'
        : 'ยังไม่โดนพื้นที่เฉลย ลองกดเริ่มใหม่แล้วหาตำแหน่งอีกครั้ง',
    );
  }, [answer, maskData, maskError]);

  const answerStyle = answer
    ? {
        left: containedRect.offsetX + answer.x * containedRect.renderedWidth,
        top: containedRect.offsetY + answer.y * containedRect.renderedHeight,
        width: answerPxRadius * 2,
        height: answerPxRadius * 2,
        marginLeft: -answerPxRadius,
        marginTop: -answerPxRadius,
      }
    : null;

  return (
    <section className="pw-practice-zone gr-card">
      <div className="pw-practice-head">
        <div>
          <div className="pw-practice-label">{PRACTICE_QUESTION.title}</div>
          <h2 className="pw-practice-title">{PRACTICE_QUESTION.prompt}</h2>
        </div>
        <div className="pw-practice-chip">Local only</div>
      </div>

      <p className="pw-practice-tip">{PRACTICE_QUESTION.instruction}</p>

      <div
        ref={frameRef}
        className={`pw-practice-frame${submitted ? ' is-submitted' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{ touchAction: 'none' }}
      >
        <img
          src={PRACTICE_QUESTION.imageUrl}
          alt="Practice question"
          className="pw-practice-image"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
          }}
        />

        {!answer && !submitted && (
          <div className="pw-practice-hint">แตะหรือเลื่อนเพื่อวางวงคำตอบ</div>
        )}

        {submitted && PRACTICE_QUESTION.revealOverlayUrl ? (
          <img
            src={PRACTICE_QUESTION.revealOverlayUrl}
            alt=""
            aria-hidden
            className="pw-practice-overlay"
            style={{
              left: containedRect.offsetX,
              top: containedRect.offsetY,
              width: containedRect.renderedWidth,
              height: containedRect.renderedHeight,
            }}
          />
        ) : null}

        {submitted && !PRACTICE_QUESTION.revealOverlayUrl ? (
          <img
            src={PRACTICE_QUESTION.maskUrl}
            alt=""
            aria-hidden
            className="pw-practice-overlay pw-practice-overlay-mask"
            style={{
              left: containedRect.offsetX,
              top: containedRect.offsetY,
              width: containedRect.renderedWidth,
              height: containedRect.renderedHeight,
            }}
          />
        ) : null}

        {answerStyle && (
          <div
            className={`pw-circle${submitted ? ' is-locked' : ''}${submitted && isCorrect ? ' is-correct' : ''}${submitted && isCorrect === false ? ' is-wrong' : ''}`}
            style={answerStyle}
          />
        )}
      </div>

      <div className="pw-practice-actions">
        <button type="button" className="pw-submit-btn" onClick={handleSubmit} disabled={submitted}>
          {submitted ? 'ส่งคำตอบแล้ว' : 'ส่งคำตอบฝึกซ้อม'}
        </button>
        <button type="button" className="pw-reset-btn" onClick={resetPractice}>
          {submitted ? 'ลองใหม่อีกครั้ง' : 'รีเซ็ตวง'}
        </button>
      </div>

      {message && (
        <div className={`pw-practice-feedback${submitted && isCorrect ? ' is-correct' : ''}${submitted && isCorrect === false ? ' is-wrong' : ''}`}>
          {message}
        </div>
      )}

      {maskError && <div className="pw-practice-note">{maskError}</div>}
      {!maskError && (
        <div className="pw-practice-note">
          โหมดฝึกซ้อมนี้ทำงานเฉพาะในเครื่องของคุณ และจะหายไปทันทีเมื่อ Host เริ่มเกมจริง
        </div>
      )}
    </section>
  );
}
