'use client';
import { useRef } from 'react';

/** Department / search / status filters. Choosing from a dropdown updates the list straight away. */
export function ProductFilters({ departments, dept, q, status }: {
  departments: { id: string; name: string }[]; dept: string; q: string; status: 'active' | 'archived';
}) {
  const form = useRef<HTMLFormElement>(null);
  const submit = () => form.current?.requestSubmit();
  return (
    <form ref={form} className="panel" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="dept">Department</label>
        <select id="dept" name="dept" defaultValue={dept} onChange={submit} key={dept}>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></div>
      <div className="field" style={{ flex: '2 1 240px' }}><label htmlFor="q">Search</label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Product name" key={`q-${q}`} /></div>
      <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="status">Showing</label>
        <select id="status" name="status" defaultValue={status} onChange={submit} key={`s-${status}`}>
          <option value="active">Active products</option><option value="archived">Archived products</option>
        </select></div>
      <button className="btn">Search</button>
    </form>
  );
}
