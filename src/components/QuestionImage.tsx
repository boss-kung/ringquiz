import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { CirclePosition } from '../lib/types';

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
}

// ── Coordinate helpers ───────────────────────────────────────────────────────
//
// Coordinate convention: xRatio and yRatio are normalised to the FULL image
// pixel dimensions [0, 1] — NOT to the CSS container box.
//
// The .quiz-image-shell container is always a 1:1 square, and the <img> uses
// object-fit: cover, which center-crops non-square images. Without correction,
// a raw getBoundingClientRect() ratio would be in container-box space and
// would disagree with the scoring backend (mask-check.ts), which maps
// xRatio * mask.width → pixel coordinate in the original image.
//
// For a 16:9 image in a square: scale = containerSize / imgH (height fills),
// renderedW > containerSize, so offsetX > 0 (left/right cropped).
// For a portrait image: scale = containerSize / imgW (width fills),
// renderedH > containerSize, so offsetY > 0 (top/bottom cropped).
// For a 1:1 image: offsets are both 0 — no change in behaviour.

function containerToImageRatio(
  clickX: number,     // pixels from container left edge
  clickY: number,     // pixels from container top edge
  containerSize: number,
  naturalWidth: number,
  naturalHeight: number,
): CirclePosition {
  if (containerSize === 0 || naturalWidth === 0 || naturalHeight === 0) {
    return {
      xRatio: Math.max(0, Math.min(1, clickX / (containerSize || 1))),
      yRatio: Math.max(0, Math.min(1, clickY / (containerSize || 1))),
    };
  }

  // object-fit: cover in a square container
  const scale = Math.max(containerSize / naturalWidth, containerSize / naturalHeight);
  const renderedW = naturalWidth * scale;
  const renderedH = naturalHeight * scale;

  // How much of the rendered image extends beyond each container edge (per side)
  const offsetX = (renderedW - containerSize) / 2;
  const offsetY = (renderedH - containerSize) / 2;

  return {
    xRatio: Math.max(0, Math.min(1, (clickX + offsetX) / renderedW)),
    yRatio: Math.max(0, Math.min(1, (clickY + offsetY) / renderedH)),
  };
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
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const isDragging = useRef(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [imageUrl]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !imageUrl || loadFailed) {
      setRenderedWidth(0);
      return;
    }

    const ro = new ResizeObserver(() => {
      setRenderedWidth(img.getBoundingClientRect().width);
    });

    ro.observe(img);

    if (img.complete) {
      setRenderedWidth(img.getBoundingClientRect().width);
    }

    return () => ro.disconnect();
  }, []);

  const coordsFromEvent = useCallback((clientX: number, clientY: number): CirclePosition | null => {
    const img = imgRef.current;
    if (!img) return null;

    const rect = img.getBoundingClientRect();
    // Container is square; rect.width === rect.height (or close enough)
    return containerToImageRatio(
      clientX - rect.left,
      clientY - rect.top,
      rect.width,
      img.naturalWidth,
      img.naturalHeight,
    );
  }, []);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    if (locked) {
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    onInteractionStart?.(e.clientX, e.clientY);

    const pos = coordsFromEvent(e.clientX, e.clientY);
    if (pos) {
      onCircleChange(pos);
    }
  }, [locked, coordsFromEvent, onCircleChange, onInteractionStart]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    if (!isDragging.current || locked) {
      return;
    }

    const pos = coordsFromEvent(e.clientX, e.clientY);
    if (pos) {
      onCircleChange(pos);
    }
  }, [locked, coordsFromEvent, onCircleChange]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const circlePx = renderedWidth * circleRadiusRatio;
  const canRenderImage = Boolean(imageUrl) && !loadFailed;

  const renderCircle = (pos: CirclePosition, style?: CSSProperties) => (
    <div
      style={{
        position: 'absolute',
        left: `${pos.xRatio * 100}%`,
        top: `${pos.yRatio * 100}%`,
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
                setRenderedWidth(imgRef.current.getBoundingClientRect().width);
              }
            }}
            onError={() => {
              setLoadFailed(true);
              setRenderedWidth(0);
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
            src={maskOverlayUrl}
            alt=""
            aria-hidden
            className={maskOverlayClassName}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
              opacity: 1,
            }}
          />
        )}

        {circle && renderCircle(circle)}
        {revealCircle && revealCircle !== circle && renderCircle(revealCircle, {
          borderColor: 'rgba(250, 204, 21, 0.95)',
          backgroundColor: 'rgba(250, 204, 21, 0.15)',
        })}
      </div>
    </div>
  );
}
