import { Icon } from '@/components/Icon';
import { ActionForm, SubmitButton } from '@/components/admin/ActionForm';
import { addAdmin, changeMyPassword, setAdminActive } from '@/app/actions/admin';
import { requireAdmin } from '@/lib/server/auth';
import { db } from '@/lib/server/db';

export default async function Settings() {
  const me = await requireAdmin();
  const admins = await db()`select id, display_name, email, active, last_login_at from admins order by created_at`;
  const row: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' };
  const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };

  return (
    <>
      <div className="page-head"><div><h1>Access &amp; settings</h1><p>Who can change products and par levels.</p></div></div>

      <section className="panel" style={section}>
        <h2>How access works</h2>
        <div className="banner s-info">
          <Icon name="info" />
          <div>
            <b>Staff screens are open to anyone with the link.</b>
            <p>Keep the web address private. The admin area has no visible link: press and hold the logo on the home screen for 2 seconds, or add <b>/admin</b> to the address. It always asks for an admin password.</p>
          </div>
        </div>
      </section>

      <section className="panel" style={section}>
        <h2>Admins</h2>
        <p className="meta">Admins can change products, par levels and settings. On a shared iPad, sign out when you&rsquo;re done (sign-ins end by themselves after 12 hours).</p>
        <div className="rows">
          {admins.map((a) => (
            <div key={String(a.id)} className={`row ${a.active ? '' : 'muted'}`}>
              <div className="grow">
                <div className="title">{String(a.displayName)} {a.id === me.adminId ? <span className="tag">You</span> : null} {!a.active ? <span className="tag">Disabled</span> : null}</div>
                <div className="meta">{String(a.email)}{a.lastLoginAt ? ` · last signed in ${new Date(a.lastLoginAt as string).toLocaleDateString('en-AU')}` : ' · never signed in'}</div>
              </div>
              {a.id !== me.adminId ? (
                <form action={setAdminActive}>
                  <input type="hidden" name="id" value={String(a.id)} /><input type="hidden" name="active" value={a.active ? 'false' : 'true'} />
                  <button className="btn small">{a.active ? 'Disable' : 'Enable'}</button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
        <details>
          <summary className="btn small" style={{ listStyle: 'none', display: 'inline-flex' }}><Icon name="plus" />Add an admin</summary>
          <ActionForm action={addAdmin} style={{ ...row, paddingTop: 12 }} resetOnSuccess>
            <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="an">Name</label><input id="an" name="name" required maxLength={40} /></div>
            <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="ae">Email</label><input id="ae" name="email" type="email" required /></div>
            <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="ap">Temporary password</label><input id="ap" name="password" type="password" autoComplete="new-password" required minLength={10} /></div>
            <SubmitButton>Add admin</SubmitButton>
          </ActionForm>
        </details>
      </section>

      <section className="panel" style={section}>
        <h2>Your password</h2>
        <ActionForm action={changeMyPassword} style={row} resetOnSuccess>
          <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="np">New password</label><input id="np" name="password" type="password" autoComplete="new-password" required minLength={10} /></div>
          <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="cp">Type it again</label><input id="cp" name="confirm" type="password" autoComplete="new-password" required minLength={10} /></div>
          <SubmitButton>Change password</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
