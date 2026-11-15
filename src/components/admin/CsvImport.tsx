'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { checkProductsCsv, importProductsCsv } from '@/app/actions/admin';
import type { ImportPreview } from '@/lib/server/catalogue-csv';

export function CsvImport() {
  const router = useRouter();
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportPreview | null>(null);
  const [pending, start] = useTransition();

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setDone(null); setPreview(null); setFileName(f.name);
    const t = await f.text();
    setText(t);
    start(async () => setPreview(await checkProductsCsv(t)));
  };
  const apply = () => text && start(async () => {
    const r = await importProductsCsv(text);
    if (r.errors.length) setPreview(r); else { setDone(r); setPreview(null); setText(null); router.refresh(); }
  });

  const changes = preview ? preview.newProducts.length + preview.updated.length + preview.newCategories.length : 0;
  return (
    <div className="csv-import">
      <label className={`btn primary ${pending ? 'disabled' : ''}`}>
        <Icon name="up" />{pending ? 'Checking…' : 'Upload a spreadsheet (CSV)'}
        <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <p className="meta">In Excel or Numbers, use <b>File &rsaquo; Save As / Export &rsaquo; CSV</b>.</p>

      {done ? (
        <div className="banner s-ok" role="status"><Icon name="check" /><div><b>Import saved.</b>
          <p>{done.newProducts.length} new, {done.updated.length} updated, {done.unchanged} unchanged. Devices get the changes next time they connect.</p></div></div>
      ) : null}

      {preview ? (
        <div className="csv-preview">
          <h3>{fileName}: {preview.rows} rows</h3>
          {preview.errors.length ? (
            <div className="banner s-bad"><Icon name="warn" /><div><b>Fix {preview.errors.length === 1 ? 'this' : `these ${preview.errors.length}`} first. Nothing has been changed.</b>
              <ul>{preview.errors.map((e, i) => <li key={i}><b>Row {e.row}:</b> {e.message}</li>)}</ul></div></div>
          ) : changes === 0 ? (
            <div className="banner s-info"><Icon name="info" /><div><b>No changes.</b><p>Everything in this file already matches the app.</p></div></div>
          ) : (
            <>
              {preview.newProducts.length ? <div><b>New products ({preview.newProducts.length})</b><ul>{preview.newProducts.map((n) => <li key={n}>{n}</li>)}</ul></div> : null}
              {preview.updated.length ? <div><b>Changed ({preview.updated.length})</b><ul>{preview.updated.map((u) => <li key={u.name}>{u.name}: {u.changes.join('; ')}</li>)}</ul></div> : null}
              {preview.newCategories.length ? <div><b>New categories</b><ul>{preview.newCategories.map((n) => <li key={n}>{n}</li>)}</ul></div> : null}
              <p className="meta">{preview.unchanged} other products unchanged.</p>
              <div className="row-actions">
                <button className="btn" onClick={() => { setPreview(null); setText(null); }}>Cancel</button>
                <button className="btn primary" disabled={pending} onClick={apply}><Icon name="check" />{pending ? 'Saving…' : `Save ${changes} change${changes === 1 ? '' : 's'}`}</button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
