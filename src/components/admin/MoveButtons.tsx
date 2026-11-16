'use client';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/Icon';
import { moveItem } from '@/app/actions/admin';

type Kind = 'department' | 'area' | 'category' | 'location' | 'product' | 'placement';

/** The arrow shows it's working (and can't be tapped twice) until the move is saved. */
function Arrow({ dir, disabled, label }: { dir: 'up' | 'down'; disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={disabled || pending} aria-busy={pending} aria-label={`Move ${label} ${dir}`} className={pending ? 'pending' : ''}>
      <Icon name={pending ? 'sync' : dir} />
    </button>
  );
}

/** Up/down reorder buttons. Plain forms, so they work without JavaScript too. */
export function MoveButtons({ kind, id, first, last, label }: { kind: Kind; id: string; first: boolean; last: boolean; label: string }) {
  return (
    <span className="move">
      <form action={moveItem}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="dir" value="up" />
        <Arrow dir="up" disabled={first} label={label} />
      </form>
      <form action={moveItem}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="dir" value="down" />
        <Arrow dir="down" disabled={last} label={label} />
      </form>
    </span>
  );
}
