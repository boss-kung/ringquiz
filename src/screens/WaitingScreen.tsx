import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';

// ── Practice board ────────────────────────────────────────────────────────────
// Local-only: never writes to Supabase, never affects score or live answers.

const PRACTICE_RADIUS_RATIO = 0.12; // circle as fraction of board width

interface PracticePos { x: number; y: number }

function PracticeBoard() {
  const boardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PracticePos | null>(null);
  const isDragging = useRef(false);

  const coordsFromEvent = useCallback((clientX: number, clientY: number): PracticePos | null => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    const p = coordsFromEvent(e.clientX, e.clientY);
    if (p) setPos(p);
  }, [coordsFromEvent]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const p = coordsFromEvent(e.clientX, e.clientY);
    if (p) setPos(p);
  }, [coordsFromEvent]);

  const onPointerUp = useCallback(() => { isDragging.current = false; }, []);

  // Prevent page scroll while dragging
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (isDragging.current) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const boardWidth = boardRef.current?.getBoundingClientRect().width ?? 0;
  const circlePx = boardWidth * PRACTICE_RADIUS_RATIO;

  return (
    <div className="pw-practice-zone">
      <div className="pw-practice-label">โหมดฝึกซ้อม</div>
      <p className="pw-practice-tip">แตะบนภาพเพื่อวางวง หรือเลื่อนวงไปยังตำแหน่งที่ต้องการ</p>

      {/* Board */}
      <div
        ref={boardRef}
        className="pw-board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: 'none', cursor: 'crosshair' }}
      >
        {/* Grid pattern overlay */}
        <div className="pw-board-grid" aria-hidden />

        {/* Center crosshair hint */}
        {!pos && (
          <div className="pw-board-hint">แตะเพื่อวางวง</div>
        )}

        {/* Circle */}
        {pos && boardWidth > 0 && (
          <div
            className="pw-circle"
            style={{
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              width: circlePx * 2,
              height: circlePx * 2,
              marginLeft: -circlePx,
              marginTop: -circlePx,
            }}
          />
        )}
      </div>

      {/* Reset */}
      <button
        className="pw-reset-btn"
        onClick={() => setPos(null)}
        disabled={!pos}
      >
        รีเซ็ตวง
      </button>
    </div>
  );
}

// ── Main waiting screen ────────────────────────────────────────────────────────
const PARTICLES = [
  { w: 6, h: 6, top: '18%', left: '12%', bg: 'rgba(245,199,74,.5)',   dur: '5.2s', delay: '0s' },
  { w: 4, h: 4, top: '72%', left: '8%',  bg: 'rgba(245,199,74,.35)',  dur: '6.8s', delay: '1.1s' },
  { w: 5, h: 5, top: '45%', left: '88%', bg: 'rgba(129,140,248,.5)',  dur: '4.9s', delay: '0.6s' },
  { w: 3, h: 3, top: '82%', left: '80%', bg: 'rgba(245,199,74,.4)',   dur: '7.2s', delay: '2s' },
  { w: 4, h: 4, top: '25%', left: '78%', bg: 'rgba(167,139,250,.45)', dur: '5.8s', delay: '0.3s' },
];

export function WaitingScreen() {
  const displayName = useGameStore((s) => s.displayName);

  return (
    <div style={{ minHeight: '100%', background: 'var(--navy)', color: 'var(--text)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Background glows */}
      <div className="gr-glow gr-glow-a" />
      <div className="gr-glow gr-glow-b" />

      {/* Floating particles */}
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="gr-wait-particle"
          style={{
            width: p.w, height: p.h,
            top: p.top, left: p.left,
            background: p.bg,
            boxShadow: `0 0 ${p.w * 2}px ${p.bg}`,
            '--dur': p.dur, '--delay': p.delay,
          } as React.CSSProperties}
        />
      ))}

      {/* Header */}
      <div className="gr-header">
        <div>
          <div className="gr-label-xs" style={{ marginBottom: 4 }}>Golden Ring · Lobby</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>สวัสดี, {displayName}! 👋</div>
        </div>
        <div className="gr-badge gr-badge-live">Live</div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 28px', display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', zIndex: 1 }}>

        {/* Status card */}
        <div className="gr-card-gold pw-status-card">
          <div className="pw-ready-icon">✓</div>
          <div className="pw-ready-label">พร้อมแล้ว!</div>
          <div className="pw-player-name">ผู้เล่น: <strong>{displayName}</strong></div>
          <div className="pw-waiting-msg">
            <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginBottom: 8 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', animation: `grBlink 1.3s ${i * 0.22}s ease-in-out infinite` }} />
              ))}
            </div>
            กำลังรอ Host เริ่มเกม...
          </div>
          <div className="pw-auto-note">เมื่อเกมเริ่ม หน้านี้จะเปลี่ยนอัตโนมัติ</div>
        </div>

        {/* Practice zone */}
        <PracticeBoard />
      </div>
    </div>
  );
}
