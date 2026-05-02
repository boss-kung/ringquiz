import { useRef, useEffect, useState, useCallback } from 'react';
import type { CirclePosition } from '../lib/types';

interface Props {
  imageUrl: string;
  circleRadiusRatio: number;   // fraction of image width, e.g. 0.08
  circle: CirclePosition | null;
  onCircleChange: (pos: CirclePosition) => void;
  locked: boolean;             // disable drag/tap after submission
  revealCircle?: CirclePosition | null;
  maskOverlayUrl?: string;     // Edge Function URL that returns mask PNG during reveal
  maskOverlayClassName?: string;
}

/**
 * Renders the question image with a draggable circle overlay.
 *
 * Coordinate contract:
 *   - xRatio and yRatio are relative to the RENDERED IMAGE rect (not the container).
 *   - Uses getBoundingClientRect() on the rendered circular media element.
 *   - The media is visually cropped by CSS, while answer selection ratios remain normalized to the rendered image area.
 */
export function QuestionImage({
  imageUrl,
  circleRadiusRatio,
  circle,
  onCircleChange,
  locked,
  revealCircle,
  maskOverlayUrl,
  maskOverlayClassName,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const isDragging = useRef(false);

  // Track rendered image width for pixel-accurate circle radius
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const ro = new ResizeObserver(() => {
      setRenderedWidth(img.getBoundingClientRect().width);
    });
    ro.observe(img);

    // Set immediately if already loaded
    if (img.complete) setRenderedWidth(img.getBoundingClientRect().width);

    return () => ro.disconnect();
  }, []);

  const coordsFromEvent = useCallback((clientX: number, clientY: number): CirclePosition | null => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const xRatio = (clientX - rect.left) / rect.width;
    const yRatio = (clientY - rect.top) / rect.height;
    // Clamp strictly inside the image
    return {
      xRatio: Math.max(0, Math.min(1, xRatio)),
      yRatio: Math.max(0, Math.min(1, yRatio)),
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    const pos = coordsFromEvent(e.clientX, e.clientY);
    if (pos) onCircleChange(pos);
  }, [locked, coordsFromEvent, onCircleChange]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current || locked) return;
    const pos = coordsFromEvent(e.clientX, e.clientY);
    if (pos) onCircleChange(pos);
  }, [locked, coordsFromEvent, onCircleChange]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const circlePx = renderedWidth * circleRadiusRatio;

  const renderCircle = (pos: CirclePosition, style?: React.CSSProperties) => (
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

  return (
    <div
      className="quiz-image-shell no-select"
      style={{ touchAction: 'none' }}
    >
      <div className="quiz-image-circle">
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Question"
          className="quiz-image-media"
          draggable={false}
          onLoad={() => {
            if (imgRef.current) setRenderedWidth(imgRef.current.getBoundingClientRect().width);
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
        {revealCircle && revealCircle !== circle &&
          renderCircle(revealCircle, { borderColor: 'rgba(250, 204, 21, 0.95)', backgroundColor: 'rgba(250,204,21,0.15)' })}
      </div>
    </div>
  );
}
