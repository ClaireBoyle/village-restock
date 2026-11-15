'use client';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';

const HOLD_MS = 2000;

/**
 * The app logo. Pressing and holding it for 2 seconds opens the admin
 * sign-in. There is deliberately no visible link to the admin area.
 */
export function HoldLogo() {
  const router = useRouter();
  const timer = useRef<number | null>(null);
  const start = () => {
    timer.current = window.setTimeout(() => router.push('/admin'), HOLD_MS);
  };
  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <span
      className="logo"
      aria-hidden="true"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo-mark" src="/brand/village-v-white.png" alt="" draggable={false} />
    </span>
  );
}
