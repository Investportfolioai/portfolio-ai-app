'use client';
import { useEffect } from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';

export default function CustomCursor() {
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);
  const springConfig = { damping: 25, stiffness: 150 };
  const cursorXSpring = useSpring(cursorX, springConfig);
  const cursorYSpring = useSpring(cursorY, springConfig);

  useEffect(() => {
    const moveCursor = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
    };
    window.addEventListener('mousemove', moveCursor);
    return () => window.removeEventListener('mousemove', moveCursor);
  }, [cursorX, cursorY]);

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 99999 }}>
      {/* Soft warm glow only — no solid dot, no hard edges. Felt, not seen. */}
      <motion.div
        className="absolute top-0 left-0"
        style={{ x: cursorXSpring, y: cursorYSpring, width: 180, height: 180, marginLeft: -90, marginTop: -90 }}
      >
        <div className="w-full h-full rounded-full" style={{
          background: 'radial-gradient(circle, rgba(212,175,55,0.15) 0%, rgba(212,175,55,0.06) 45%, transparent 72%)',
          filter: 'blur(28px)'
        }} />
      </motion.div>
    </div>
  );
}
