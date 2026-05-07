import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

interface AutoFitTextProps {
  text: string;
  className?: string;
  style?: CSSProperties;
  maxFontSize: number;
  minFontSize: number;
  step?: number;
  maxHeight?: string | number;
}

export function AutoFitText({
  text,
  className,
  style,
  maxFontSize,
  minFontSize,
  step = 1,
  maxHeight,
}: AutoFitTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);
  const [fitVersion, setFitVersion] = useState(0);
  const [isClamped, setIsClamped] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    let nextFontSize = maxFontSize;
    node.style.fontSize = `${nextFontSize}px`;
    node.style.webkitLineClamp = 'unset';
    node.style.display = 'block';

    while (nextFontSize > minFontSize && node.scrollHeight > node.clientHeight + 1) {
      nextFontSize = Math.max(minFontSize, nextFontSize - step);
      node.style.fontSize = `${nextFontSize}px`;
    }

    const stillOverflowing = node.scrollHeight > node.clientHeight + 1;
    setFontSize(nextFontSize);
    setIsClamped(stillOverflowing);
  }, [fitVersion, maxFontSize, minFontSize, step, text]);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof window === 'undefined') return;

    let resizeTimer = 0;
    const rerun = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        setFitVersion((current) => current + 1);
      }, 80);
    };

    const resizeObserver = new ResizeObserver(rerun);
    resizeObserver.observe(node);
    window.addEventListener('resize', rerun);
    window.addEventListener('orientationchange', rerun);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', rerun);
      window.removeEventListener('orientationchange', rerun);
      window.clearTimeout(resizeTimer);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        fontSize,
        maxHeight,
        overflow: 'hidden',
        ...(isClamped
          ? {
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 4,
            }
          : null),
      }}
      title={text}
    >
      {text}
    </div>
  );
}
