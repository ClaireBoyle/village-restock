'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';

/** Copies text for pasting into a message or the shift log, with a fallback that selects it. */
export function CopyButton({ text, label = 'Copy', targetId }: { text: string; label?: string; targetId?: string }) {
  const [msg, setMsg] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('Copied');
    } catch {
      const el = targetId ? (document.getElementById(targetId) as HTMLTextAreaElement | null) : null;
      el?.focus(); el?.select();
      setMsg('Text selected. Use Copy from the menu.');
    }
    window.setTimeout(() => setMsg(''), 2500);
  };
  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
      <button type="button" className="btn small" onClick={() => void copy()}><Icon name="copy" />{label}</button>
      {msg ? <span className="meta" role="status">{msg}</span> : null}
    </span>
  );
}
