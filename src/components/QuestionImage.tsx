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
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [loadFailed, setLoadFailed] = useState(false);
  const isDragging = useRef(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [imageUrl]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !imageUrl || loadFailed) {
      setContainerSize({ width: 0, height: 0 });
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

    const pos = coordsFromEvent(e.clientX, e.clientY, true);
    if (pos) {
      onCircleChange(pos);
    }
  }, [locked, coordsFromEvent, onCircleChange]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const containedRect = getContainedImageRect(
    containerSize.width,
    containerSize.height,
    imgRef.current?.naturalWidth ?? 0,
    imgRef.current?.naturalHeight ?? 0,
  );
  const circlePx = containedRect.renderedWidth * circleRadiusRatio;
  const canRenderImage = Boolean(imageUrl) && !loadFailed;

  const renderCircle = (pos: CirclePosition, style?: CSSProperties) => (
    <div
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
                setContainerSize({ width: rect.width, height: rect.height });
              }
            }}
            onError={() => {
              setLoadFailed(true);
              setContainerSize({ width: 0, height: 0 });
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
              objectFit: 'contain',
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
