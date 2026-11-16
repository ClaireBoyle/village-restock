'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ActionForm, SubmitButton } from './ActionForm';
import { deleteProduct } from '@/app/actions/admin';

/** Admin: permanently delete a product, behind a fold and an explicit confirmation. */
export function ProductDelete({ id, name, areas }: { id: string; name: string; areas: string[] }) {
  const [sure, setSure] = useState(false);
  return (
    <details className="panel danger-zone">
      <summary><Icon name="x" />Delete product</summary>
      <ActionForm action={deleteProduct} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        <input type="hidden" name="id" value={id} />
        <p>Permanently deletes <b>{name}</b>{areas.length ? <> and removes it from {areas.join(', ')}</> : null}. Staff devices drop it on their next update.</p>
        <p className="meta">Past restocks, shortages and reports keep their record of it. To hide it but keep it for later, use <b>Archive</b> at the top instead.</p>
        <label className="check"><input type="checkbox" name="understand" checked={sure} onChange={(e) => setSure(e.target.checked)} />I understand {name} will be deleted permanently</label>
        <div><SubmitButton className="btn danger" pendingText="Deleting…">Delete {name}</SubmitButton></div>
      </ActionForm>
    </details>
  );
}
