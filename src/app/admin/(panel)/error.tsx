'use client';
import { Icon } from '@/components/Icon';

// Shown instead of a blank "Application error" page when an admin page fails to load.
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="banner s-bad" role="alert" style={{ alignItems: 'flex-start' }}>
      <Icon name="warn" />
      <div>
        <b>This page couldn&rsquo;t load.</b>
        <p>
          If the app was just updated, the database may need its latest update: in Supabase, open SQL Editor and run the
          newest file from the project&rsquo;s <code>db/migrations</code> folder, then try again. If that doesn&rsquo;t help, check the
          Vercel logs{error.digest ? <> for error code <b>{error.digest}</b></> : null}.
        </p>
      </div>
      <button className="btn small" onClick={reset}>Try again</button>
    </div>
  );
}
