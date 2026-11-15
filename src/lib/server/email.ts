// Manager email: one message per finished full restock, sent automatically.
//
// How it stays reliable:
//   1. When a full restock is finished, the email is written to email_outbox
//      in the SAME database transaction (so it can't be lost or doubled).
//   2. The server then tries to send it straight away, and retries any that
//      failed whenever the app is next used (up to 6 attempts).
//
// Sending uses whichever is set up in Vercel's environment variables:
//   RESEND_API_KEY                 (resend.com), or
//   SMTP_USER + SMTP_PASS          (e.g. a Gmail address + app password).
// EMAIL_TRANSPORT=log only records the email (used in automated tests).
import type postgres from 'postgres';
import nodemailer from 'nodemailer';
import { db, getSetting } from './db';
import type { StockOutcome } from '@/lib/restock-logic';

type Tx = postgres.TransactionSql<Record<string, unknown>>;

const MAX_ATTEMPTS = 6;

export function emailTransport(): 'resend' | 'smtp' | 'log' | null {
  if (process.env.EMAIL_TRANSPORT === 'log') return 'log';
  // An email account (SMTP) can send to anyone, so it wins if both are set up.
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}

export async function emailSettings(): Promise<{ to: string; enabled: boolean }> {
  const to = String(await getSetting<string>('manager_email', '')).trim();
  const enabled = (await getSetting<boolean>('manager_email_enabled', false)) === true;
  return { to, enabled };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (x: number) => String(Math.round(x * 100) / 100);
const unit = (o: StockOutcome, x: number) => (x === 1 ? o.unitSingular : o.unitPlural);

export interface RestockEmailInput {
  departmentName: string;
  finishedLabel: string;     // e.g. "11:42 pm, Sun 15 Nov"
  people: string[];
  exceptionReason: string | null;
  outcomes: StockOutcome[];
  notChecked: string[];      // e.g. "Freezer 1 skipped (Ran out of time)"
  /** Comments staff typed when finishing. */
  note?: string | null;
  link: string | null;
}

/** The email managers receive. Leads with what's out of stock (red) and running low (orange). */
export function buildRestockEmail(i: RestockEmailInput): { subject: string; html: string; text: string } {
  const out = i.outcomes.filter((o) => o.status === 'out');
  const low = i.outcomes.filter((o) => o.status === 'low');
  const other = i.outcomes.filter((o) => o.status === 'not_topped_up');
  const subject = `${i.departmentName} restock: ${out.length ? `${out.length} out of stock` : low.length ? `${low.length} running low` : 'all stocked'}${out.length && low.length ? `, ${low.length} running low` : ''}`;

  const shelf = (o: StockOutcome) => (o.onShelf !== null && o.target ? ` (${n(o.onShelf)} of ${n(o.target)} on the shelf)` : '');
  const outLine = (o: StockOutcome) => `${o.productName}: none left in the storeroom${shelf(o)}`;
  const lowLine = (o: StockOutcome) => `${o.productName}: storeroom had ${n(o.got)}, short ${n(o.short)} ${unit(o, o.short)}${shelf(o)}`;

  const T: string[] = [`${i.departmentName}: full restock finished ${i.finishedLabel}`];
  if (i.people.length) T.push(`Staff: ${i.people.join(', ')}`);
  if (i.exceptionReason) T.push(`Finished with exceptions: ${i.exceptionReason}`);
  if (i.note) T.push('', 'COMMENTS FROM STAFF', i.note);
  if (out.length) { T.push('', `OUT OF STOCK (${out.length})`); for (const o of out) { T.push(`- ${outLine(o)}`); if (o.affects.length) T.push(`  Set as sold out: ${o.affects.join(', ')}`); } }
  if (low.length) { T.push('', `RUNNING LOW (${low.length})`); for (const o of low) T.push(`- ${lowLine(o)}`); }
  if (!out.length && !low.length) T.push('', 'Nothing low or out of stock.');
  if (other.length) T.push('', `Not topped up (not a storeroom shortage): ${other.map((o) => o.productName).join(', ')}`);
  if (i.notChecked.length) T.push('', `Not checked: ${i.notChecked.join('; ')}`);
  if (i.link) T.push('', `Details: ${i.link}`);

  const box = (bg: string, border: string, color: string, title: string, rows: string) =>
    `<div style="background:${bg};border:2px solid ${border};border-radius:16px;padding:16px 18px;margin:0 0 14px">
      <div style="font-size:19px;font-weight:700;color:${color};margin:0 0 10px">${title}</div>${rows}</div>`;
  const item = (name: string, detail: string, extra = '') =>
    `<div style="background:#fff;border-radius:12px;padding:10px 12px;margin:0 0 8px">
      <div style="font-size:16px;font-weight:700;color:#17213B">${esc(name)}</div>
      <div style="font-size:14px;color:#56607A;margin-top:2px">${esc(detail)}</div>${extra}</div>`;

  const html = `<!doctype html><html><body style="margin:0;background:#F7F8FB;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:20px 16px">
    <div style="background:linear-gradient(115deg,#101C55 0%,#2446B8 48%,#4588F4 100%);border-radius:18px;padding:18px 20px;color:#fff;margin-bottom:14px">
      <div style="font-size:13px;opacity:.85">Village Restock</div>
      <div style="font-size:22px;font-weight:700;margin-top:2px">${esc(i.departmentName)}</div>
      <div style="font-size:14px;opacity:.9;margin-top:4px">Full restock finished ${esc(i.finishedLabel)}${i.people.length ? ` &middot; ${esc(i.people.join(', '))}` : ''}</div>
    </div>
    ${i.exceptionReason ? `<div style="background:#FDF0DA;border-radius:12px;padding:10px 14px;margin-bottom:14px;color:#8A5300;font-size:14px"><b>Finished with exceptions:</b> ${esc(i.exceptionReason)}</div>` : ''}
    ${i.note ? `<div style="background:#fff;border:2px solid #C9D6F5;border-radius:16px;padding:14px 18px;margin:0 0 14px">
      <div style="font-size:15px;font-weight:700;color:#2446B8;margin:0 0 6px">Comments from staff</div>
      <div style="font-size:15px;color:#17213B;white-space:pre-wrap;line-height:1.45">${esc(i.note)}</div></div>` : ''}
    ${out.length ? box('#FDE6E4', '#E0716A', '#9F2620', `Out of stock (${out.length})`, out.map((o) => item(o.productName, `None left in the storeroom${shelf(o)}`,
      o.affects.length ? `<div style="font-size:14px;color:#9F2620;margin-top:4px">Set as sold out: <b>${esc(o.affects.join(', '))}</b></div>` : '')).join('')) : ''}
    ${low.length ? box('#FFF1D6', '#F0A930', '#7A4300', `Running low (${low.length})`, low.map((o) => item(o.productName, `Storeroom had ${n(o.got)}, short ${n(o.short)} ${unit(o, o.short)}${shelf(o)}`)).join('')) : ''}
    ${!out.length && !low.length ? `<div style="background:#E1F2E8;border-radius:16px;padding:16px 18px;margin-bottom:14px;color:#177245;font-size:17px;font-weight:700">Nothing low or out of stock</div>` : ''}
    ${other.length ? `<p style="font-size:13px;color:#56607A;margin:0 0 8px"><b>Not topped up</b> (not a storeroom shortage): ${esc(other.map((o) => o.productName).join(', '))}</p>` : ''}
    ${i.notChecked.length ? `<p style="font-size:13px;color:#56607A;margin:0 0 8px"><b>Not checked:</b> ${esc(i.notChecked.join('; '))}</p>` : ''}
    ${i.link ? `<p style="font-size:13px;margin:14px 0 0"><a href="${esc(i.link)}" style="color:#2446B8">View this restock</a></p>` : ''}
  </div></body></html>`;
  return { subject, html, text: T.join('\n') };
}

/** Add the email to the outbox inside the finishing transaction. Only if switched on with an address. */
export async function queueRestockEmail(tx: Tx, sessionId: string, finishedAt: string, input: RestockEmailInput) {
  const rows = await tx`select key, value from app_settings where key in ('manager_email', 'manager_email_enabled')`;
  const to = String(rows.find((r) => r.key === 'manager_email')?.value ?? '').trim();
  const enabled = rows.find((r) => r.key === 'manager_email_enabled')?.value === true;
  if (!enabled || !to) return;
  const m = buildRestockEmail(input);
  await tx`insert into email_outbox (session_id, finished_at, recipient, subject, html, body_text)
    values (${sessionId}, ${finishedAt}, ${to}, ${m.subject}, ${m.html}, ${m.text})
    on conflict (session_id, finished_at) do nothing`;
}

async function send(to: string, subject: string, html: string, text: string): Promise<void> {
  const t = emailTransport();
  if (!t) throw new Error('No email service is set up (add RESEND_API_KEY, or SMTP_USER and SMTP_PASS, in Vercel).');
  if (t === 'log') return;
  const from = process.env.EMAIL_FROM || (t === 'resend' ? 'Village Restock <onboarding@resend.dev>' : `Village Restock <${process.env.SMTP_USER}>`);
  if (t === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      let msg = body;
      try { msg = String(JSON.parse(body).message ?? body); } catch { /* not JSON */ }
      if (res.status === 403 && /own email address/i.test(msg)) {
        const own = msg.match(/\(([^)]+@[^)]+)\)/)?.[1];
        throw new Error(`Resend can only send to the address you signed up to Resend with${own ? ` (${own})` : ''} until a web domain is verified. Use an email account (SMTP) instead, or send to that address.`);
      }
      throw new Error(`Resend replied ${res.status}: ${msg.slice(0, 160)}`);
    }
    return;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({ from, to, subject, html, text });
}

/** Send any waiting emails. Safe to call often; each email is claimed before sending. */
export async function processEmailOutbox(): Promise<void> {
  const sql = db();
  for (let k = 0; k < 5; k++) {
    const claimed = await sql.begin(async (tx) => {
      const [row] = await tx`select * from email_outbox
        where status in ('pending', 'failed') and attempts < ${MAX_ATTEMPTS}
          and (status = 'pending' or created_at > now() - interval '3 days')
        order by created_at limit 1 for update skip locked`;
      if (!row) return null;
      await tx`update email_outbox set attempts = attempts + 1 where id = ${String(row.id)}`;
      return row;
    });
    if (!claimed) return;
    try {
      await send(String(claimed.recipient), String(claimed.subject), String(claimed.html), String(claimed.bodyText));
      await sql`update email_outbox set status = 'sent', sent_at = now(), last_error = null where id = ${String(claimed.id)}`;
    } catch (e) {
      await sql`update email_outbox set status = 'failed', last_error = ${String((e as Error).message).slice(0, 300)} where id = ${String(claimed.id)}`;
    }
  }
}

/** Send a test email straight away (Admin > Access & settings). */
export async function sendTestEmail(to: string): Promise<void> {
  const m = buildRestockEmail({
    departmentName: 'Test department', finishedLabel: 'just now', people: ['Test'], exceptionReason: null, notChecked: [], link: null, note: 'Example comment: the cool room door is sticking.',
    outcomes: [
      { productName: 'Example product', unitSingular: 'bottle', unitPlural: 'bottles', status: 'out', needed: 4, got: 0, short: 4, onShelf: 2, target: 6, reason: 'insufficient', flagged: false, affects: ['Example menu item'] },
      { productName: 'Another product', unitSingular: 'pack', unitPlural: 'packs', status: 'low', needed: 3, got: 1, short: 2, onShelf: 3, target: 5, reason: 'insufficient', flagged: false, affects: [] },
    ],
  });
  await send(to, `[Test] ${m.subject}`, m.html, m.text);
}

/** Send a failed email again (Admin > Access & settings). */
export async function retryEmail(id: string): Promise<void> {
  await db()`update email_outbox set status = 'pending', attempts = 0, last_error = null where id = ${id} and status <> 'sent'`;
  await processEmailOutbox();
}

export async function recentEmails(limit = 5) {
  return db()`select e.id, e.status, e.recipient, e.subject, e.attempts, e.last_error, e.created_at, e.sent_at
    from email_outbox e order by e.created_at desc limit ${limit}`;
}
