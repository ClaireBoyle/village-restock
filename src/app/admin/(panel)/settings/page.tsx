import { Icon } from '@/components/Icon';
import { ActionForm, SubmitButton } from '@/components/admin/ActionForm';
import { addAdmin, changeMyPassword, setAdminActive, setStaffCode } from '@/app/actions/admin';
import { requireAdmin } from '@/lib/server/auth';
import { db, getSetting } from '@/lib/server/db';

export default async function Settings() {
  const me = await requireAdmin();
  const codeSet = Boolean(await getSetting<string | null>('staff_code_hash', null));
  const admins = await db()`select id, display_name, email, active, last_login_at from admins order by created_at`;
  const row: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' };
  const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };

  return (
    <>
      <div className="page-head"><div><h1>Access &amp; settings</h1><p>Who can use the app, and how.</p></div></div>

      <section className="panel" style={section}>
        <h2>Staff access code</h2>
        <p className="meta">Staff enter this once on each iPad or phone. {codeSet ? 'Changing it signs out every staff device straight away.' : 'No code is set yet, so staff can’t unlock the app.'}</p>
        <ActionForm action={setStaffCode} style={row} resetOnSuccess>
          <div className="field" style={{ flex: '1 1 180px' }}><label htmlFor="code">{codeSet ? 'New code' : 'Code'}</label><input id="code" name="code" autoComplete="off" required minLength={4} maxLength={20} /></div>
          <div className="field" style={{ flex: '1 1 180px' }}><label htmlFor="confirm">Type it again</label><input id="confirm" name="confirm" autoComplete="off" required minLength={4} maxLength={20} /></div>
          <SubmitButton>{codeSet ? 'Change code' : 'Set code'}</SubmitButton>
        </ActionForm>
      </section>

      <section className="panel" style={section}>
        <h2>Admins</h2>
        <p className="meta">Admins can change products, par levels and settings. Staff don&rsquo;t need accounts.</p>
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
