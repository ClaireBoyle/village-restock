'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { setPhoto } from '@/app/actions/admin';

const MAX_SIDE = 1200;

/** Shrink a photo on this device before upload: phone photos are often 3-8 MB. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file); // also reads iPhone HEIC photos in Safari
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  for (const q of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size < 400_000) return blob;
    if (blob && q === 0.55) return blob;
  }
  throw new Error('Could not read that photo.');
}

export function PhotoField({ kind, id, current, hint }: { kind: 'product' | 'area'; id: string; current: string | null; hint: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const send = (fd: FormData) => start(async () => {
    fd.set('kind', kind); fd.set('id', id);
    const r = await setPhoto(undefined, fd);
    setMsg(r?.error ? { ok: false, text: r.error } : { ok: true, text: r?.message ?? 'Saved.' });
    if (!r?.error) { setPreview(null); router.refresh(); }
  });

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const blob = await shrink(f);
      setPreview(URL.createObjectURL(blob));
      const fd = new FormData();
      fd.set('photo', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
      send(fd);
    } catch {
      setMsg({ ok: false, text: 'That file couldn’t be read as a photo. Try a JPEG or PNG.' });
    }
    if (input.current) input.current.value = '';
  };

  const shown = preview ?? current;
  return (
    <div className="photo-field">
      <div className={`photo-frame ${shown ? '' : 'empty'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shown ? <img src={shown} alt="" /> : <Icon name="camera" />}
      </div>
      <div className="photo-side">
        <p className="meta">{hint}</p>
        <div className="row-actions">
          <label className={`btn small ${pending ? 'disabled' : ''}`}>
            <Icon name="camera" />{pending ? 'Saving…' : current ? 'Change photo' : 'Add photo'}
            <input ref={input} type="file" accept="image/*" hidden disabled={pending} onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          {current && !pending ? (
            <button type="button" className="btn small" onClick={() => { const fd = new FormData(); fd.set('remove', '1'); send(fd); }}>Remove</button>
          ) : null}
        </div>
        {msg ? <p className={`meta ${msg.ok ? 'ok-text' : 'bad-text'}`} role="status">{msg.text}</p> : null}
      </div>
    </div>
  );
}
