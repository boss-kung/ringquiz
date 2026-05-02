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
  frameVariant?: 'default' | 'orb';
}

/**
 * Renders the question image with a draggable circle overlay.
 *
 * Coordinate contract:
 *   - xRatio and yRatio are relative to the RENDERED IMAGE rect (not the container).
 *   - Uses getBoundingClientRect() on the <img> element.
 *   - The <img> uses max-w-full + h-auto: no letterboxing, rect == image pixels.
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
  frameVariant = 'default',
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [imageBox, setImageBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const isDragging = useRef(false);

  useEffect(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return;

    const updateImageBox = () => {
      const stageRect = stage.getBoundingClientRect();

      if (frameVariant === 'orb' && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const scale = Math.min(stageRect.width / img.naturalWidth, stageRect.height / img.naturalHeight);
        const width = img.naturalWidth * scale;
        const height = img.naturalHeight * scale;
        setImageBox({
          left: (stageRect.width - width) / 2,
          top: (stageRect.height - height) / 2,
          width,
          height,
        });
        return;
      }

      setImageBox({
        left: 0,
        top: 0,
        width: stageRect.width,
        height: stageRect.height,
      });
    };

    const ro = new ResizeObserver(() => {
      updateImageBox();
    });
    ro.observe(stage);

    if (img.complete) updateImageBox();

    return () => ro.disconnect();
  }, [frameVariant]);

  const coordsFromEvent = useCallback((clientX: number, clientY: number): CirclePosition | null => {
    const stage = stageRef.current;
    if (!stage || imageBox.width <= 0 || imageBox.height <= 0) return null;
    const stageRect = stage.getBoundingClientRect();
    const x = clientX - stageRect.left - imageBox.left;
    const y = clientY - stageRect.top - imageBox.top;

    if (x < 0 || y < 0 || x > imageBox.width || y > imageBox.height) {
      return null;
    }

    return {
      xRatio: Math.max(0, Math.min(1, x / imageBox.width)),
      yRatio: Math.max(0, Math.min(1, y / imageBox.height)),
    };
  }, [imageBox]);

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

  const circlePx = imageBox.width * circleRadiusRatio;

  const renderCircle = (pos: CirclePosition, style?: React.CSSProperties) => (
    <div
      style={{
        position: 'absolute',
        left: `${imageBox.left + pos.xRatio * imageBox.width}px`,
        top: `${imageBox.top + pos.yRatio * imageBox.height}px`,
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
      className={`relative inline-block w-full no-select ${frameVariant === 'orb' ? 'question-orb-shell max-w-[26rem] mx-auto' : ''}`}
      style={{ touchAction: 'none' }}
    >
      {frameVariant === 'orb' && (
        <>
          <div className="question-orb-glow" aria-hidden />
          <div className="question-orb-offset-ring" aria-hidden />
          <div className="question-orb-main-ring" aria-hidden />
        </>
      )}
      <div
        ref={stageRef}
        className={frameVariant === 'orb' ? 'question-orb-stage' : 'relative'}
      >
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Question"
        className={frameVariant === 'orb' ? 'question-orb-image' : 'block w-full h-auto'}
        draggable={false}
        onLoad={() => {
          const stage = stageRef.current;
          const img = imgRef.current;
          if (!stage || !img) return;

          const stageRect = stage.getBoundingClientRect();
          if (frameVariant === 'orb' && img.naturalWidth > 0 && img.naturalHeight > 0) {
            const scale = Math.min(stageRect.width / img.naturalWidth, stageRect.height / img.naturalHeight);
            const width = img.naturalWidth * scale;
            const height = img.naturalHeight * scale;
            setImageBox({
              left: (stageRect.width - width) / 2,
              top: (stageRect.height - height) / 2,
              width,
              height,
            });
            return;
          }

          setImageBox({
            left: 0,
            top: 0,
            width: stageRect.width,
            height: stageRect.height,
          });
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
            left: `${imageBox.left}px`,
            top: `${imageBox.top}px`,
            width: `${imageBox.width}px`,
            height: `${imageBox.height}px`,
            objectFit: 'contain',
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
