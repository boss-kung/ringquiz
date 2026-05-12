import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { CirclePosition } from '../lib/types';

export interface HeatmapPoint {
  xRatio: number;
  yRatio: number;
  correct: boolean;
}

interface Props {
  imageUrl: string | null;
  circleRadiusRatio: number;
  circle: CirclePosition | null;
  onCircleChange: (pos: CirclePosition) => void;
  onInteractionStart?: (clientX: number, clientY: number) => void;
  locked: boolean;
  revealCircle?: CirclePosition | null;
  maskOverlayUrl?: string;
  maskOverlayClassName?: string;
  shellClassName?: string;
  /** Extra class(es) to apply to the answer circle div */
  circleClassName?: string;
  /** Answer heatmap dots rendered on canvas over the image */
  heatmapPoints?: HeatmapPoint[];
}

// ── Coordinate helpers ───────────────────────────────────────────────────────
//
// Coordinate convention: xRatio and yRatio are normalised to the FULL image
// pixel dimensions [0, 1] — NOT to the CSS container box.
//
// The .quiz-image-shell container is always a 1:1 square, but the image now
// uses object-fit: contain so the full source image stays visible. We compute
// the actual rendered image rect inside the square and map pointer coords into
// that contained rect. This keeps taps, circles, and reveal overlays aligned
// with the same full-image coordinate space the backend scores against.

interface ContainedImageRect {
  renderedWidth: number;
  renderedHeight: number;
  offsetX: number;
  offsetY: number;
}

function getContainedImageRect(
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): ContainedImageRect {
  if (containerWidth === 0 || containerHeight === 0 || naturalWidth === 0 || naturalHeight === 0) {
    return { renderedWidth: 0, renderedHeight: 0, offsetX: 0, offsetY: 0 };
  }

  const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight);
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;

  return {
    renderedWidth,
    renderedHeight,
    offsetX: (containerWidth - renderedWidth) / 2,
    offsetY: (containerHeight - renderedHeight) / 2,
  };
}

function containerToImageRatio(
  clickX: number,     // pixels from container left edge
  clickY: number,     // pixels from container top edge
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  clampToImage: boolean,
): CirclePosition {
  if (containerWidth === 0 || containerHeight === 0 || naturalWidth === 0 || naturalHeight === 0) {
    return {
      xRatio: Math.max(0, Math.min(1, clickX / (containerWidth || 1))),
      yRatio: Math.max(0, Math.min(1, clickY / (containerHeight || 1))),
    };
  }

  const containedRect = getContainedImageRect(
    containerWidth,
    containerHeight,
    naturalWidth,
    naturalHeight,
  );

  const localX = clampToImage
    ? Math.max(containedRect.offsetX, Math.min(containedRect.offsetX + containedRect.renderedWidth, clickX))
    : clickX;
  const localY = clampToImage
    ? Math.max(containedRect.offsetY, Math.min(containedRect.offsetY + containedRect.renderedHeight, clickY))
    : clickY;

  if (
    !clampToImage &&
    (localX < containedRect.offsetX ||
      localX > containedRect.offsetX + containedRect.renderedWidth ||
      localY < containedRect.offsetY ||
      localY > containedRect.offsetY + containedRect.renderedHeight)
  ) {
    return {
      xRatio: Number.NaN,
      yRatio: Number.NaN,
    };
  }

  return {
    xRatio: Math.max(0, Math.min(1, (localX - containedRect.offsetX) / (containedRect.renderedWidth || 1))),
    yRatio: Math.max(0, Math.min(1, (localY - containedRect.offsetY) / (containedRect.renderedHeight || 1))),
  };
}

// ── Drag trail ───────────────────────────────────────────────────────────────

interface TrailPoint {
  id: number;
  /** pixel offset from container left, within the quiz-image-circle */
  x: number;
  /** pixel offset from container top, within the quiz-image-circle */
  y: number;
  createdAt: number;
}

const TRAIL_MAX_AGE_MS = 450;
const TRAIL_THROTTLE_MS = 50;

let trailNextId = 1;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

export function QuestionImage({
  imageUrl,
  circleRadiusRatio,
  circle,
  onCircleChange,
  onInteractionStart,
  locked,
  revealCircle,
  maskOverlayUrl,
  maskOverlayClassName,
  shellClassName = '',
  circleClassName = '',
  heatmapPoints,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [stableNaturalSize, setStableNaturalSize] = useState({ width: 0, height: 0 });
  const [loadFailed, setLoadFailed] = useState(false);
  const isDragging = useRef(false);
  const reducedMotion = useReducedMotion();

  // Trail state
  const [trailPoints, setTrailPoints] = useState<TrailPoint[]>([]);
  const lastTrailTime = useRef(0);

  // Purge old trail points every 100 ms when active
  useEffect(() => {
    if (trailPoints.length === 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setTrailPoints((pts) => pts.filter((p) => now - p.createdAt < TRAIL_MAX_AGE_MS));
    }, 80);
    return () => window.clearInterval(id);
  }, [trailPoints.length]);

  useEffect(() => {
    setLoadFailed(false);
  }, [imageUrl]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !imageUrl || loadFailed) {
      return;
    }

    const ro = new ResizeObserver(() => {
      const rect = img.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    });

    ro.observe(img);

    if (img.complete) {
      const rect = img.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    }

    return () => ro.disconnect();
  }, [imageUrl, loadFailed]);

  const coordsFromEvent = useCallback((
    clientX: number,
    clientY: number,
    clampToImage: boolean,
  ): CirclePosition | null => {
    const img = imgRef.current;
    if (!img) return null;

    const rect = img.getBoundingClientRect();
    const pos = containerToImageRatio(
      clientX - rect.left,
      clientY - rect.top,
      rect.width,
      rect.height,
      img.naturalWidth,
      img.naturalHeight,
      clampToImage,
    );
    if (Number.isNaN(pos.xRatio) || Number.isNaN(pos.yRatio)) return null;
    return pos;
  }, []);

  /** Returns container-local pixel coords (within the quiz-image-circle) for a pointer event, clamped to image rect. */
  const containerCoordsFromEvent = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const cr = getContainedImageRect(rect.width, rect.height, img.naturalWidth, img.naturalHeight);
    const x = Math.max(cr.offsetX, Math.min(cr.offsetX + cr.renderedWidth, clientX - rect.left));
    const y = Math.max(cr.offsetY, Math.min(cr.offsetY + cr.renderedHeight, clientY - rect.top));
    return { x, y };
  }, []);

  // Heatmap canvas rendering
  useEffect(() => {
    const canvas = heatmapCanvasRef.current;
    if (!canvas || !heatmapPoints || heatmapPoints.length === 0) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const nw = stableNaturalSize.width || (imgRef.current?.naturalWidth ?? 0);
    const nh = stableNaturalSize.height || (imgRef.current?.naturalHeight ?? 0);
    const cr = getContainedImageRect(containerSize.width, containerSize.height, nw, nh);
    if (cr.renderedWidth === 0 || cr.renderedHeight === 0) return;

    canvas.width = containerSize.width;
    canvas.height = containerSize.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const radius = Math.max(10, cr.renderedWidth * 0.038);

    for (const pt of heatmapPoints) {
      const cx = cr.offsetX + pt.xRatio * cr.renderedWidth;
      const cy = cr.offsetY + pt.yRatio * cr.renderedHeight;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      if (pt.correct) {
        grad.addColorStop(0, 'rgba(52,211,153,.42)');
        grad.addColorStop(1, 'rgba(52,211,153,0)');
      } else {
        grad.addColorStop(0, 'rgba(251,113,133,.36)');
        grad.addColorStop(1, 'rgba(251,113,133,0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [heatmapPoints, containerSize, stableNaturalSize]);

  const addTrailPoint = useCallback((clientX: number, clientY: number) => {
    if (reducedMotion || locked) return;
    const now = Date.now();
    if (now - lastTrailTime.current < TRAIL_THROTTLE_MS) return;
    lastTrailTime.current = now;
    const coords = containerCoordsFromEvent(clientX, clientY);
    if (!coords) return;
    const id = trailNextId++;
    setTrailPoints((pts) => [
      ...pts.slice(-4), // keep at most 5 points (4 old + 1 new)
      { id, x: coords.x, y: coords.y, createdAt: now },
    ]);
  }, [reducedMotion, locked, containerCoordsFromEvent]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    if (locked) {
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    onInteractionStart?.(e.clientX, e.clientY);

    const pos = coordsFromEvent(e.clientX, e.clientY, false);
    if (pos) {
      onCircleChange(pos);
    }
  }, [locked, coordsFromEvent, onCircleChange, onInteractionStart]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    if (!isDragging.current || locked) {
      return;
    }

    addTrailPoint(e.clientX, e.clientY);

    const pos = coordsFromEvent(e.clientX, e.clientY, true);
    if (pos) {
      onCircleChange(pos);
    }
  }, [locked, coordsFromEvent, onCircleChange, addTrailPoint]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const containedRect = getContainedImageRect(
    containerSize.width,
    containerSize.height,
    imgRef.current?.naturalWidth || stableNaturalSize.width,
    imgRef.current?.naturalHeight || stableNaturalSize.height,
  );
  const circlePx = containedRect.renderedWidth * circleRadiusRatio;
  const canRenderImage = Boolean(imageUrl) && !loadFailed;

  const renderCircle = (pos: CirclePosition, style?: CSSProperties, extraClass?: string) => (
    <div
      className={extraClass}
      style={{
        position: 'absolute',
        left: `${containedRect.offsetX + pos.xRatio * containedRect.renderedWidth}px`,
        top: `${containedRect.offsetY + pos.yRatio * containedRect.renderedHeight}px`,
        width: `${circlePx * 2}px`,
        height: `${circlePx * 2}px`,
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        border: '3px solid rgba(255, 255, 255, 0.95)',
        backgroundColor: 'rgba(255, 255, 255, 0.18)',
        boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.55)',
        pointerEvents: 'none',
        ...style,
      }}
    />
  );

  const wrapperClassName = ['quiz-image-shell', 'no-select', shellClassName]
    .filter(Boolean)
    .join(' ');

  const now = Date.now();

  return (
    <div className={wrapperClassName} style={{ touchAction: 'none' }}>
      <div className="quiz-image-circle">
        {canRenderImage ? (
          <img
            ref={imgRef}
            src={imageUrl ?? undefined}
            alt="Question"
            className="quiz-image-media"
            draggable={false}
            onLoad={() => {
              if (imgRef.current) {
                const rect = imgRef.current.getBoundingClientRect();
                setStableNaturalSize({
                  width: imgRef.current.naturalWidth,
                  height: imgRef.current.naturalHeight,
                });
                setContainerSize({ width: rect.width, height: rect.height });
              }
            }}
            onError={() => {
              setLoadFailed(true);
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              cursor: locked ? 'default' : 'crosshair',
              touchAction: 'none',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              textAlign: 'center',
              color: 'var(--text-2)',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            ไม่มีภาพสำหรับคำถามนี้
          </div>
        )}

        {canRenderImage && maskOverlayUrl && (
          <img
            key={maskOverlayUrl}
            src={maskOverlayUrl}
            alt=""
            aria-hidden
            className={maskOverlayClassName}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
              opacity: 1,
            }}
          />
        )}

        {canRenderImage && heatmapPoints && heatmapPoints.length > 0 && (
          <canvas
            ref={heatmapCanvasRef}
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Drag trail dots — local only, never written to Supabase */}
        {!reducedMotion && !locked && trailPoints.map((pt) => {
          const age = now - pt.createdAt;
          const alpha = Math.max(0, 1 - age / TRAIL_MAX_AGE_MS);
          const scale = 0.35 + alpha * 0.65;
          return (
            <div
              key={pt.id}
              className="quiz-drag-trail-dot"
              style={{
                left: pt.x,
                top: pt.y,
                opacity: alpha * 0.55,
                transform: `translate(-50%, -50%) scale(${scale})`,
              } as CSSProperties}
            />
          );
        })}

        {circle && renderCircle(circle, undefined, circleClassName || undefined)}
        {revealCircle && revealCircle !== circle && renderCircle(revealCircle, {
          borderColor: 'rgba(250, 204, 21, 0.95)',
          backgroundColor: 'rgba(250, 204, 21, 0.15)',
        })}
      </div>
    </div>
  );
}
