'use client';
import { useState } from 'react';
import { ActionForm, SubmitButton } from './ActionForm';
import { saveProduct } from '@/app/actions/admin';

export interface ProductFormData {
  id?: string; name: string; categoryId: string | null; unitSingular: string; unitPlural: string;
  method: 'par' | 'manual' | 'routine'; allowDecimal: boolean; instructions: string; defaultLocationId: string | null;
  placements: { areaId: string; par: number | null; locationId: string | null }[];
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
