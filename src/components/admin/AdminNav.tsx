'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icon';

const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: '/admin', label: 'Overview', icon: 'grid' },
  { href: '/admin/restocks', label: 'Restocks', icon: 'list' },
  { href: '/admin/shortages', label: 'Shortages', icon: 'warn' },
  { href: '/admin/insights', label: 'Stock Insights', icon: 'grid' },
  { href: '/admin/products', label: 'Products', icon: 'tag' },
  { href: '/admin/photos', label: 'Product photos', icon: 'camera' },
  { href: '/admin/departments', label: 'Departments & areas', icon: 'layers' },
  { href: '/admin/storerooms', label: 'Storerooms', icon: 'box' },
  { href: '/admin/defrost', label: 'Defrost Planner', icon: 'clock' },
  { href: '/admin/prep', label: 'Morning prep', icon: 'task' },
  { href: '/admin/import', label: 'Spreadsheets', icon: 'copy' },
  { href: '/admin/settings', label: 'Access & settings', icon: 'cog' },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin sections">
      {LINKS.map((l) => {
        const active = l.href === '/admin' ? path === '/admin' : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}>
            <Icon name={l.icon} />{l.label}
          </Link>
        );
      })}
    </nav>
  );
}
