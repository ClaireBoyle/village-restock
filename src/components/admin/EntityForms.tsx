// Small forms shared by the admin pages. Server components that render
// <ActionForm> (a client component) around plain inputs.
import { ActionForm, SubmitButton } from './ActionForm';
import { saveArea, saveCategory, saveDepartment, saveLocation, savePrepTask } from '@/app/actions/admin';

const grid2: React.CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' };
const stack: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };

export interface DepartmentRow {
  id: string; name: string; shortName: string; groupLabel: string; theme: 'village' | 'gold';
  icon: 'bar' | 'kitchen' | 'candy' | 'box'; description: string; active: boolean;
  /** Each area restocked on its own (needs migration 009). */
  restockByArea?: boolean;
  /** Short is Low stock, even at zero; "None on display" marks it Out of stock (needs migration 013). */
  noneOnDisplay?: boolean;
  /** Email managers after every finished restock, even a clean one (needs migration 014). */
  emailEveryRestock?: boolean;
}

export function DepartmentForm({ d }: { d?: DepartmentRow }) {
  const k = d?.id ?? 'new';
  return (
    <ActionForm action={saveDepartment} style={stack} resetOnSuccess={!d}>
      {d ? <input type="hidden" name="id" value={d.id} /> : null}
      <div style={grid2}>
        <div className="field"><label htmlFor={`dn-${k}`}>Full name</label><input id={`dn-${k}`} name="name" defaultValue={d?.name} required maxLength={60} placeholder="e.g. Gold Class Kitchen" /></div>
        <div className="field"><label htmlFor={`ds-${k}`}>Short name on cards</label><input id={`ds-${k}`} name="shortName" defaultValue={d?.shortName} required maxLength={30} placeholder="e.g. Kitchen" /></div>
        <div className="field"><label htmlFor={`dg-${k}`}>Label above the name</label><input id={`dg-${k}`} name="groupLabel" defaultValue={d?.groupLabel} maxLength={30} placeholder="e.g. Gold Class or Trad" /></div>
        <div className="field"><label htmlFor={`dd-${k}`}>Short description</label><input id={`dd-${k}`} name="description" defaultValue={d?.description} maxLength={160} /></div>
        <div className="field"><label htmlFor={`dt-${k}`}>Style</label>
          <select id={`dt-${k}`} name="theme" defaultValue={d?.theme ?? 'village'}><option value="village">Village blue</option><option value="gold">Gold Class</option></select></div>
        <div className="field"><label htmlFor={`di-${k}`}>Icon</label>
          <select id={`di-${k}`} name="icon" defaultValue={d?.icon ?? 'box'}><option value="bar">Cocktail glass (bar)</option><option value="kitchen">Chef&rsquo;s hat (kitchen)</option><option value="candy">Popcorn (candy bar)</option><option value="box">Box (general)</option></select></div>
      </div>
      <label className="check"><input type="checkbox" name="active" defaultChecked={d ? d.active : true} />Show to staff</label>
      <label className="check"><input type="checkbox" name="restockByArea" defaultChecked={d?.restockByArea ?? false} />Restock each area separately
        <span className="meta" style={{ fontWeight: 400 }}>&nbsp;Staff pick one area, enter what it needs, collect and finish it, at any time and in any order (e.g. Candy Bar). Otherwise every area is checked in one full restock.</span></label>
      <label className="check"><input type="checkbox" name="noneOnDisplay" defaultChecked={d?.noneOnDisplay ?? false} />Ask &ldquo;None on display?&rdquo; when nothing is collected
        <span className="meta" style={{ fontWeight: 400 }}>&nbsp;Collecting less than needed shows as Low stock, even when none was collected. Staff tap &ldquo;None on display&rdquo; to mark it Out of stock (e.g. Candy Bar). Otherwise none collected is Out of stock.</span></label>
      <label className="check"><input type="checkbox" name="emailEveryRestock" defaultChecked={d?.emailEveryRestock ?? false} />Email managers after every finished restock
        <span className="meta" style={{ fontWeight: 400 }}>&nbsp;Also when everything was collected (e.g. Candy Bar). Otherwise only when there&rsquo;s something to act on: shortages, comments or exceptions. Uses the address in Settings.</span></label>
      <div><SubmitButton>{d ? 'Save department' : 'Add department'}</SubmitButton></div>
    </ActionForm>
  );
}

export function AreaForm({ departmentId, a, parents = [] }: {
  departmentId: string;
  a?: { id: string; name: string; guideText: string; active: boolean; parentAreaId?: string | null; sectionMode?: string };
  /** Areas this one could be shown inside (top-level areas of the department, not itself). */
  parents?: { id: string; name: string }[];
}) {
  const k = a?.id ?? `new-${departmentId}`;
  return (
    <ActionForm action={saveArea} style={stack} resetOnSuccess={!a}>
      <input type="hidden" name="departmentId" value={departmentId} />
      {a ? <input type="hidden" name="id" value={a.id} /> : null}
      <div className="field"><label htmlFor={`an-${k}`}>Area name</label><input id={`an-${k}`} name="name" defaultValue={a?.name} required maxLength={60} placeholder="e.g. Fridge 1" /></div>
      <div className="field"><label htmlFor={`ag-${k}`}>Stocking guide (optional)</label>
        <textarea id={`ag-${k}`} name="guideText" defaultValue={a?.guideText} maxLength={600} placeholder="What a well-stocked area looks like, e.g. Dairy on the top shelf, oldest stock at the front." /></div>
      {parents.length ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor={`ap-${k}`}>Show as</label>
            <select id={`ap-${k}`} name="parentAreaId" defaultValue={a?.parentAreaId ?? ''}>
              <option value="">Its own area (own tab)</option>
              {parents.filter((p) => p.id !== a?.id).map((p) => <option key={p.id} value={p.id}>A section of {p.name}</option>)}
            </select></div>
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor={`am-${k}`}>If it&rsquo;s a section</label>
            <select id={`am-${k}`} name="sectionMode" defaultValue={a?.sectionMode ?? 'collapsed'}>
              <option value="open">Shown open</option>
              <option value="collapsed">Collapsed (tap to show)</option>
              <option value="optional">Optional and collapsed (never required)</option>
            </select></div>
        </div>
      ) : null}
      {a ? <label className="check"><input type="checkbox" name="active" defaultChecked={a.active} />Show to staff</label> : <input type="hidden" name="active" value="on" />}
      <div><SubmitButton>{a ? 'Save area' : 'Add area'}</SubmitButton></div>
    </ActionForm>
  );
}

export function CategoryForm({ departmentId, c }: { departmentId: string; c?: { id: string; name: string; active: boolean } }) {
  const k = c?.id ?? `new-${departmentId}`;
  return (
    <ActionForm action={saveCategory} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }} resetOnSuccess={!c}>
      <input type="hidden" name="departmentId" value={departmentId} />
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor={`cn-${k}`}>{c ? 'Category name' : 'New category'}</label>
        <input id={`cn-${k}`} name="name" defaultValue={c?.name} required maxLength={40} placeholder="e.g. Dairy" /></div>
      {c ? <label className="check"><input type="checkbox" name="active" defaultChecked={c.active} />In use</label> : <input type="hidden" name="active" value="on" />}
      <SubmitButton className="btn">{c ? 'Save' : 'Add'}</SubmitButton>
    </ActionForm>
  );
}

export function LocationForm({ l }: { l?: { id: string; name: string; active: boolean; collectNote?: string } }) {
  const k = l?.id ?? 'new';
  return (
    <ActionForm action={saveLocation} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }} resetOnSuccess={!l}>
      {l ? <input type="hidden" name="id" value={l.id} /> : null}
      <div className="field" style={{ flex: '1 1 240px' }}><label htmlFor={`ln-${k}`}>{l ? 'Storeroom name' : 'New storeroom'}</label>
        <input id={`ln-${k}`} name="name" defaultValue={l?.name} required maxLength={60} placeholder="e.g. Alcohol Storeroom" /></div>
      {l ? <div className="field" style={{ flex: '2 1 320px' }}><label htmlFor={`lc-${k}`}>Collection reminder (optional)</label>
        <input id={`lc-${k}`} name="collectNote" defaultValue={l.collectNote ?? ''} maxLength={200} placeholder="Shown once under this storeroom on collection lists, e.g. Use opened boxes first." /></div> : null}
      {l ? <label className="check"><input type="checkbox" name="active" defaultChecked={l.active} />In use</label> : <input type="hidden" name="active" value="on" />}
      <SubmitButton className="btn">{l ? 'Save' : 'Add storeroom'}</SubmitButton>
    </ActionForm>
  );
}

/** One morning prep task (Admin → Morning prep): name, group, in use. */
export function PrepTaskForm({ departmentId, t }: { departmentId: string; t?: { id: string; name: string; group: string; active: boolean } }) {
  const k = t?.id ?? 'new';
  return (
    <ActionForm action={savePrepTask} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }} resetOnSuccess={!t}>
      {t ? <input type="hidden" name="id" value={t.id} /> : null}
      <input type="hidden" name="departmentId" value={departmentId} />
      <div className="field" style={{ flex: '2 1 260px' }}><label htmlFor={`pt-${k}`}>{t ? 'Task' : 'New task'}</label>
        <input id={`pt-${k}`} name="name" defaultValue={t?.name} required maxLength={80} placeholder="e.g. Cut lettuce for burgers" /></div>
      <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor={`pg-${k}`}>Group</label>
        <select id={`pg-${k}`} name="group" defaultValue={t?.group ?? 'vegetables'}>
          <option value="vegetables">Vegetables</option><option value="proteins">Proteins</option><option value="sauces">Sauces</option><option value="other">Other</option>
        </select></div>
      {t ? <label className="check"><input type="checkbox" name="active" defaultChecked={t.active} />On the checklist</label> : <input type="hidden" name="active" value="on" />}
      <SubmitButton className="btn">{t ? 'Save' : 'Add task'}</SubmitButton>
    </ActionForm>
  );
}
