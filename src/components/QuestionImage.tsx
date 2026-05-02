import { useRef, useEffect, useState, useCallback } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { CirclePosition } from '../lib/types';

interface Props {
  imageUrl: string;
  circleRadiusRatio: number;
  circle: CirclePosition | null;
  onCircleChange: (pos: CirclePosition) => void;
  locked: boolean;
  revealCircle?: CirclePosition | null;
  maskOverlayUrl?: string;
  maskOverlayClassName?: string;
  shellClassName?: string;
  fitToParent?: boolean;
}

function readCssPx(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function QuestionImage({
  imageUrl,
  circleRadiusRatio,
  circle,
  onCircleChange,
  locked,
  revealCircle,
  maskOverlayUrl,
  maskOverlayClassName,
  shellClassName = '',
  fitToParent = false,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const [shellSize, setShellSize] = useState<number | null>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) {
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

  useEffect(() => {
    if (!fitToParent) {
      setShellSize(null);
      return;
    }

    const wrapper = wrapperRef.current;
    const parent = wrapper?.parentElement;
    if (!wrapper || !parent) {
      return;
    }

    const updateShellSize = () => {
      const parentRect = parent.getBoundingClientRect();
      const styles = getComputedStyle(wrapper);
      const offset = readCssPx(styles.getPropertyValue('--quiz-image-offset'));
      const stroke = readCssPx(styles.getPropertyValue('--quiz-image-stroke'));
      const ringGap = readCssPx(styles.getPropertyValue('--quiz-image-ring-gap'));
      const outerDecoration = offset + stroke + ringGap;
      const safeInset = Math.ceil((outerDecoration * 2) + 4);
      const availableWidth = Math.max(0, parentRect.width - safeInset * 2);
      const availableHeight = Math.max(0, parentRect.height - safeInset * 2);
      const nextSize = Math.floor(Math.max(0, Math.min(availableWidth, availableHeight)));
      setShellSize(nextSize > 0 ? nextSize : null);
    };

    updateShellSize();

    const ro = new ResizeObserver(updateShellSize);
    ro.observe(parent);

    return () => ro.disconnect();
  }, [fitToParent, shellClassName]);

  const coordsFromEvent = useCallback((clientX: number, clientY: number): CirclePosition | null => {
    const img = imgRef.current;
    if (!img) {
      return null;
    }

    const rect = img.getBoundingClientRect();
    const xRatio = (clientX - rect.left) / rect.width;
    const yRatio = (clientY - rect.top) / rect.height;

    return {
      xRatio: Math.max(0, Math.min(1, xRatio)),
      yRatio: Math.max(0, Math.min(1, yRatio)),
    };
  }, []);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    if (locked) {
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;

    const pos = coordsFromEvent(e.clientX, e.clientY);
    if (pos) {
      onCircleChange(pos);
    }
  }, [locked, coordsFromEvent, onCircleChange]);

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
        boxShadow: '0 0 0 2px rgba(0,0,0,0.55)',
        pointerEvents: 'none',
        ...style,
      }}
    />
  );

  const wrapperClassName = ['quiz-image-shell', 'no-select', shellClassName]
    .filter(Boolean)
    .join(' ');

  const wrapperStyle: CSSProperties = {
    touchAction: 'none',
  };

  if (shellSize) {
    wrapperStyle.width = `${shellSize}px`;
    wrapperStyle.height = `${shellSize}px`;
  }

  return (
    <div ref={wrapperRef} className={wrapperClassName} style={wrapperStyle}>
      <div className="quiz-image-circle">
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Question"
          className="quiz-image-media"
          draggable={false}
          onLoad={() => {
            if (imgRef.current) {
              setRenderedWidth(imgRef.current.getBoundingClientRect().width);
            }
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ cursor: locked ? 'default' : 'crosshair', touchAction: 'none' }}
        />

        {maskOverlayUrl && (
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
          backgroundColor: 'rgba(250,204,21,0.15)',
        })}
      </div>
    </div>
  );
}
