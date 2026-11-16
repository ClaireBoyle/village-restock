'use client';
import { ActionForm, SubmitButton } from './ActionForm';
import { saveDefrostItem } from '@/app/actions/admin';

export interface DefrostItemData {
  id?: string; name: string; unitSingular: string; unitPlural: string; expectedDemand: number; weekdayDemand: Record<string, number>;
  buffer: number; packSize: number; minQty: number; thawMethod: string; thawHours: number | null; shelfLifeHours: number | null;
  safetyNotes: string; active: boolean;
}
const DAYS: [string, string][] = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

export function DefrostItemForm({ departmentId, item }: { departmentId: string; item?: DefrostItemData }) {
  const v = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
  const grid: React.CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))' };
  return (
    <ActionForm action={saveDefrostItem} style={{ display: 'flex', flexDirection: 'column', gap: 14 }} resetOnSuccess={!item}>
      <input type="hidden" name="departmentId" value={departmentId} />
      {item?.id ? <input type="hidden" name="id" value={item.id} /> : null}
      <div style={grid}>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Name staff will see</label><input name="name" defaultValue={item?.name} required maxLength={80} placeholder="e.g. Beef patties" /></div>
        <div className="field"><label>Unit (one)</label><input name="unitSingular" defaultValue={item?.unitSingular ?? 'portion'} required maxLength={30} /></div>
        <div className="field"><label>Unit (more than one)</label><input name="unitPlural" defaultValue={item?.unitPlural ?? 'portions'} required maxLength={30} /></div>
      </div>
      <fieldset className="df-set"><legend>How much is usually needed</legend>
        <div style={grid}>
          <div className="field"><label>Expected demand per service</label><input name="expectedDemand" inputMode="decimal" defaultValue={v(item?.expectedDemand ?? 0)} required /></div>
          <div className="field"><label>Safety buffer</label><input name="buffer" inputMode="decimal" defaultValue={v(item?.buffer ?? 0)} required /></div>
          <div className="field"><label>Pack size (round up to)</label><input name="packSize" inputMode="decimal" defaultValue={v(item?.packSize ?? 1)} required /></div>
          <div className="field"><label>Minimum practical amount</label><input name="minQty" inputMode="decimal" defaultValue={v(item?.minQty ?? 0)} required /></div>
        </div>
        <p className="meta" style={{ margin: '10px 0 6px' }}>Different on some days? Leave blank to use the expected demand above.</p>
        <div className="df-days">
          {DAYS.map(([k, l]) => <label key={k} className="field"><span>{l}</span><input name={`wd_${k}`} inputMode="decimal" defaultValue={v(item?.weekdayDemand?.[k])} placeholder="–" /></label>)}
        </div>
      </fieldset>
      <fieldset className="df-set"><legend>Approved thawing (from your food-safety procedures)</legend>
        <div style={grid}>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Approved thawing method</label><input name="thawMethod" defaultValue={item?.thawMethod} maxLength={120} placeholder="e.g. Coolroom, sealed tray on the bottom shelf" /></div>
          <div className="field"><label>Minimum thaw time (hours)</label><input name="thawHours" inputMode="decimal" defaultValue={v(item?.thawHours)} placeholder="Required for suggestions" /></div>
          <div className="field"><label>Usable life after thawing (hours)</label><input name="shelfLifeHours" inputMode="decimal" defaultValue={v(item?.shelfLifeHours)} placeholder="e.g. 72" /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>Food-safety notes for staff (optional)</label><textarea name="safetyNotes" defaultValue={item?.safetyNotes} maxLength={400} style={{ minHeight: 60 }} placeholder="e.g. Label with date and time when moved to thaw." /></div>
        </div>
        <p className="meta" style={{ marginTop: 8 }}>The planner won&rsquo;t suggest a quantity without a thaw time, and warns when stock can&rsquo;t be thawed safely before the next service.</p>
      </fieldset>
      {item ? <label className="check"><input type="checkbox" name="active" defaultChecked={item.active} />Show in the Defrost Planner</label> : <input type="hidden" name="active" value="true" />}
      <div><SubmitButton>{item ? 'Save' : 'Add item'}</SubmitButton></div>
    </ActionForm>
  );
}
