'use client';
import { useEffect } from 'react';

/** After saving a product: scroll the list to it and highlight it briefly. */
export function ScrollToRow({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('just-saved');
    const t = window.setTimeout(() => el.classList.remove('just-saved'), 2500);
    return () => window.clearTimeout(t);
  }, [id]);
  return null;
}
