'use client';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ConnectionPill, TopBar, timeLabel } from '@/components/TopBar';
import { useCatalogue } from '@/lib/client/use-catalogue';
import type { CatDepartment } from '@/lib/catalogue-types';

export function HomeScreen({ isAdmin }: { isAdmin: boolean }) {
  const { catalogue, checkedAt, connection, error } = useCatalogue();
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <TopBar crumbs="Staff restocking" right={<ConnectionPill connection={connection} checkedAt={checkedAt} />} />
      <main className="wrap" style={{ display: 'flex', flexDirection: 'column', gap: 26, paddingBlock: '22px 32px' }}>
        <section className="welcome">
          <div>
            <p className="date">{today}</p>
            <h1>Restocking</h1>
            <p className="tagline">Restock smarter. Stay prepared.</p>
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 22 }}>Departments</h2>
            <p className="meta">Choose where you&rsquo;re restocking</p>
          </div>

          {!catalogue && !error ? <p className="meta">Loading product data&hellip;</p> : null}
          {error && !catalogue ? (
            <div className="banner s-warn"><Icon name="wifioff" /><div><b>No product data on this device yet</b><p>{error}</p></div></div>
          ) : null}
          {catalogue && catalogue.departments.length === 0 ? (
            <div className="banner s-none"><Icon name="info" /><div><b>No departments set up yet</b><p>A supervisor can add them in Admin.</p></div></div>
          ) : null}

          <div className="dgrid">
            {catalogue?.departments.map((d) => (
              <DepartmentCard key={d.id} d={d} areaCount={catalogue.areas.filter((a) => a.departmentId === d.id).length}
                productCount={catalogue.products.filter((p) => p.departmentId === d.id).length} />
            ))}
          </div>
        </section>

        <footer className="meta" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{checkedAt ? `Product data checked ${timeLabel(checkedAt)}` : ''}</span>
          <Link className="linkbtn" href="/admin">{isAdmin ? 'Admin' : 'Supervisor sign in'}</Link>
        </footer>
      </main>
    </>
  );
}

function DepartmentCard({ d, areaCount, productCount }: { d: CatDepartment; areaCount: number; productCount: number }) {
  const gold = d.theme === 'gold';
  return (
    <Link href={`/d/${d.id}`} className={`dcard ${gold ? 'gc' : ''}`}>
      <div className="dc-top"><span className="dicon" aria-hidden="true"><Icon name={d.icon} /></span></div>
      <div>
        {d.groupLabel ? <p className="eyebrow">{d.groupLabel}</p> : null}
        <h3>{d.shortName}</h3>
        {d.description ? <p className="dc-desc">{d.description}</p> : null}
      </div>
      <div className="dc-foot">
        <span className="meta" style={{ flex: 1 }}>{areaCount} areas · {productCount} products</span>
        <span className="dc-go" aria-hidden="true"><Icon name="next" /></span>
      </div>
    </Link>
  );
}
