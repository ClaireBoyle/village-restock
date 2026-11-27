'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ActionForm, SubmitButton } from './ActionForm';
import { finishRestockLate } from '@/app/actions/admin';

/** An Unfinished restock: finish it now, after a confirm. */
export function FinishLateForm({ id }: { id: string }) {
  const [sure, setSure] = useState(false);
  return (
    <ActionForm action={finishRestockLate} className="finish-late">
      <input type="hidden" name="id" value={id} />
      {sure ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <SubmitButton className="btn primary" pendingText="Finishing…"><Icon name="check" />Yes, finish it</SubmitButton>
          <button type="button" className="btn" onClick={() => setSure(false)}>Cancel</button>
        </div>
      ) : <button type="button" className="btn primary" onClick={() => setSure(true)}><Icon name="check" />Finish this restock</button>}
    </ActionForm>
  );
}
