// Small forms shared by the admin pages. Server components that render
// <ActionForm> (a client component) around plain inputs.
import { ActionForm, SubmitButton } from './ActionForm';
import { saveArea, saveCategory, saveDepartment, saveLocation } from '@/app/actions/admin';

const grid2: React.CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' };
const stack: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };

export interface DepartmentRow {
  id: string; name: string; shortName: string; groupLabel: string; theme: 'village' | 'gold';
  icon: 'bar' | 'kitchen' | 'candy' | 'box'; description: string; active: boolean;
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

export function LocationForm({ l }: { l?: { id: string; name: string; active: boolean } }) {
  const k = l?.id ?? 'new';
  return (
    <ActionForm action={saveLocation} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }} resetOnSuccess={!l}>
      {l ? <input type="hidden" name="id" value={l.id} /> : null}
      <div className="field" style={{ flex: '1 1 240px' }}><label htmlFor={`ln-${k}`}>{l ? 'Storeroom name' : 'New storeroom'}</label>
        <input id={`ln-${k}`} name="name" defaultValue={l?.name} required maxLength={60} placeholder="e.g. Alcohol Storeroom" /></div>
      {l ? <label className="check"><input type="checkbox" name="active" defaultChecked={l.active} />In use</label> : <input type="hidden" name="active" value="on" />}
      <SubmitButton className="btn">{l ? 'Save' : 'Add storeroom'}</SubmitButton>
    </ActionForm>
  );
}
