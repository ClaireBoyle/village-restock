'use client';
import { useState } from 'react';
import { ActionForm, SubmitButton } from './ActionForm';
import { saveProduct } from '@/app/actions/admin';

export interface ProductFormData {
  id?: string; name: string; categoryId: string | null; unitSingular: string; unitPlural: string;
  method: 'par' | 'manual' | 'routine'; allowDecimal: boolean; instructions: string; defaultLocationId: string | null;
  affects: string[];
  placements: { areaId: string; par: number | null; locationId: string | null; defrost?: DefrostFormData }[];
}

/** Defrost details for one area (all text as typed; blank = not set). */
export interface DefrostFormData { grab: string; fallback: string; put: string; readySingular: string; readyPlural: string; readyPer: string; targets: string }

/** Grab / If empty / Put, and the admits targets, for a "staff enter" product in an area (e.g. Gold Class Kitchen → Defrost). */
function DefrostFields({ areaId, d, unitPlural }: { areaId: string; d?: DefrostFormData; unitPlural: string }) {
  const any = !!d && Object.values(d).some((v) => v.trim());
  const f = (k: string) => `${k}_${areaId}`;
  return (
    <details className="defrost-fields" open={any} style={{ gridColumn: '1 / -1' }}>
      <summary><b>Defrost details</b> <span className="meta">(optional: where to grab it, where it goes, admits targets)</span></summary>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', marginTop: 10 }}>
        <div className="field"><label htmlFor={f('grab')}>Grab from</label>
          <input id={f('grab')} name={f('grab')} defaultValue={d?.grab} maxLength={300} placeholder="e.g. Freezer 1, lower-left door" /></div>
        <div className="field"><label htmlFor={f('fallback')}>If that&rsquo;s empty</label>
          <input id={f('fallback')} name={f('fallback')} defaultValue={d?.fallback} maxLength={300} placeholder="e.g. Downstairs walk-in freezer" /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor={f('put')}>Put it (where it defrosts)</label>
          <input id={f('put')} name={f('put')} defaultValue={d?.put} maxLength={300} placeholder="e.g. Upstairs walk-in fridge" /></div>
        <div className="field"><label htmlFor={f('rus')}>What&rsquo;s ready is counted in (one)</label>
          <input id={f('rus')} name={f('rus')} defaultValue={d?.readySingular} maxLength={30} placeholder="Same as the unit" /></div>
        <div className="field"><label htmlFor={f('rup')}>(more than one)</label>
          <input id={f('rup')} name={f('rup')} defaultValue={d?.readyPlural} maxLength={30} placeholder="e.g. portions" /></div>
        <div className="field"><label htmlFor={f('rper')}>How many of those in one {unitPlural ? unitPlural.replace(/s$/, '') : 'unit'}</label>
          <input id={f('rper')} name={f('rper')} defaultValue={d?.readyPer} inputMode="decimal" className="tabular" placeholder="e.g. 8 portions a bag" /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor={f('tgt')}>Ready-stock targets by tomorrow&rsquo;s admits</label>
          <textarea id={f('tgt')} name={f('tgt')} defaultValue={d?.targets} maxLength={400} style={{ minHeight: 70 }} placeholder={'One range per line, e.g.\n0-150: 24\n151+: 36'} />
          <small>Staff enter tomorrow&rsquo;s admits once and count what&rsquo;s ready; the amount to pull is suggested (target minus ready, rounded up). Leave blank for staff to enter it themselves.</small></div>
      </div>
    </details>
  );
}

const METHODS = [
  { v: 'par', title: 'Target level', help: 'Staff count what’s there; the app works out how many to collect.' },
  { v: 'manual', title: 'Staff enter what they need', help: 'For things without a fixed target, e.g. packets to fill the stand.' },
  { v: 'routine', title: 'Routine task', help: 'An instruction to tick off, e.g. bring out the choc-top boxes.' },
] as const;

export function ProductForm({ departmentId, product, areas, categories, locations }: {
  departmentId: string;
  product?: ProductFormData;
  areas: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}) {
  const [method, setMethod] = useState<ProductFormData['method']>(product?.method ?? 'par');
  const [ticked, setTicked] = useState<Set<string>>(new Set(product?.placements.map((p) => p.areaId) ?? []));
  const [unitPlural, setUnitPlural] = useState(product?.unitPlural ?? '');
  const placement = new Map(product?.placements.map((p) => [p.areaId, p]));
  const toggle = (id: string) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
  const grid: React.CSSProperties = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' };

  return (
    <ActionForm action={saveProduct} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <input type="hidden" name="departmentId" value={departmentId} />
      {product?.id ? <input type="hidden" name="id" value={product.id} /> : null}

      <section className="panel" style={section}>
        <h2>Product</h2>
        <div style={grid}>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="name">Name staff will see</label>
            <input id="name" name="name" defaultValue={product?.name} required maxLength={80} placeholder="e.g. Stone & Wood Pacific Ale" /></div>
          <div className="field"><label htmlFor="unitSingular">Unit (one)</label>
            <input id="unitSingular" name="unitSingular" defaultValue={product?.unitSingular} required maxLength={30} placeholder="e.g. bottle" /></div>
          <div className="field"><label htmlFor="unitPlural">Unit (more than one)</label>
            <input id="unitPlural" name="unitPlural" value={unitPlural} onChange={(e) => setUnitPlural(e.target.value)} required maxLength={30} placeholder="e.g. bottles" /></div>
          <div className="field"><label htmlFor="categoryId">Category</label>
            <select id="categoryId" name="categoryId" defaultValue={product?.categoryId ?? ''}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="defaultLocationId">Collect from (storeroom)</label>
            <select id="defaultLocationId" name="defaultLocationId" defaultValue={product?.defaultLocationId ?? ''}>
              <option value="">Choose a storeroom</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></div>
        </div>
        <div className="field"><label htmlFor="instructions">Instructions for staff (optional)</label>
          <textarea id="instructions" name="instructions" defaultValue={product?.instructions} maxLength={400}
            placeholder={method === 'routine' ? 'e.g. Bring out the choc-top flavour boxes and replenish the display.' : 'e.g. Check the use-by label. Rotate older stock to the front.'} /></div>
        <div className="field"><label htmlFor="affects">Menu items affected if this runs out (optional)</label>
          <textarea id="affects" name="affects" defaultValue={product?.affects.join('\n')} maxLength={800} style={{ minHeight: 70 }}
            placeholder={'One per line, e.g.\nGolden Harvest Burger'} />
          <small>Shown to staff and in the manager email as &ldquo;Set as sold out&rdquo; when this product is out of stock.</small></div>
      </section>

      <section className="panel" style={section}>
        <h2>How staff restock it</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))' }}>
          {METHODS.map((m) => (
            <label key={m.v} className={`placement ${method === m.v ? 'on' : ''}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="radio" name="method" value={m.v} checked={method === m.v} onChange={() => setMethod(m.v)} style={{ width: 22, height: 22, marginTop: 2, accentColor: 'var(--accent)' }} />
              <span><b style={{ fontWeight: 600 }}>{m.title}</b><br /><span className="meta">{m.help}</span></span>
            </label>
          ))}
        </div>
        {method !== 'routine' ? (
          <label className="check"><input type="checkbox" name="allowDecimal" defaultChecked={product?.allowDecimal} />Allow part quantities (e.g. 0.5 kg, half a bottle)</label>
        ) : null}
      </section>

      <section className="panel" style={section}>
        <h2>Where staff check it</h2>
        <p className="meta">Tick every area this product is kept in. {method === 'par' ? 'Each area has its own target level.' : ''} Leave &ldquo;storeroom&rdquo; as default unless this area restocks from somewhere else.</p>
        {areas.length === 0 ? <p className="meta">This department has no areas yet. Add them under Departments &amp; areas.</p> : null}
        <div className="placements">
          {areas.map((a) => {
            const on = ticked.has(a.id);
            const pl = placement.get(a.id);
            return (
              <div key={a.id} className={`placement ${on ? 'on' : ''}`}>
                <label className="check"><input type="checkbox" name="area" value={a.id} checked={on} onChange={() => toggle(a.id)} /><b style={{ fontWeight: 600 }}>{a.name}</b></label>
                {on && method === 'par' ? (
                  <div className="field"><label htmlFor={`par_${a.id}`}>Target{unitPlural ? ` (${unitPlural})` : ''}</label>
                    <input id={`par_${a.id}`} name={`par_${a.id}`} inputMode="decimal" defaultValue={pl?.par ?? ''} required className="tabular" /></div>
                ) : <span />}
                {on ? (
                  <div className="field"><label htmlFor={`loc_${a.id}`}>Storeroom for this area</label>
                    <select id={`loc_${a.id}`} name={`loc_${a.id}`} defaultValue={pl?.locationId ?? ''}>
                      <option value="">Same as product</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select></div>
                ) : <span />}
                {on && method === 'manual' ? <DefrostFields areaId={a.id} d={pl?.defrost} unitPlural={unitPlural} /> : null}
              </div>
            );
          })}
        </div>
      </section>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <SubmitButton className="btn primary">{product?.id ? 'Save changes' : 'Add product'}</SubmitButton>
      </div>
    </ActionForm>
  );
}
