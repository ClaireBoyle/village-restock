import { Icon } from '@/components/Icon';
import { moveItem } from '@/app/actions/admin';

type Kind = 'department' | 'area' | 'category' | 'location' | 'product' | 'placement';

/** Up/down reorder buttons. Plain forms, so they work without JavaScript too. */
export function MoveButtons({ kind, id, first, last, label }: { kind: Kind; id: string; first: boolean; last: boolean; label: string }) {
  return (
    <span className="move">
      <form action={moveItem}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="dir" value="up" />
        <button disabled={first} aria-label={`Move ${label} up`}><Icon name="up" /></button>
      </form>
      <form action={moveItem}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="dir" value="down" />
        <button disabled={last} aria-label={`Move ${label} down`}><Icon name="down" /></button>
      </form>
    </span>
  );
}
