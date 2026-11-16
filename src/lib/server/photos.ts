// Reference photos. Stored in the database (they're small: the admin's device
// shrinks them before upload) and served from /api/photos/<id>. A new photo
// always gets a new id, so devices can keep them forever (offline too).
import { db } from './db';

export const MAX_PHOTO_BYTES = 1_500_000;

function sniff(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/** Checks the file really is a JPEG/PNG/WebP image (not just its name) and saves it. */
export async function savePhoto(file: unknown): Promise<{ path: string } | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a photo first.' };
  if (file.size > MAX_PHOTO_BYTES) return { error: 'That photo is too large. Try again: it should be shrunk automatically.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) return { error: 'That file isn’t a photo the app can use (JPEG, PNG or WebP).' };
  const [row] = await db()`insert into photos (data, content_type, bytes) values (${Buffer.from(bytes)}, ${type}, ${bytes.length}) returning id`;
  return { path: `/api/photos/${row.id}` };
}

/** Delete a photo nothing uses any more. */
export async function deletePhotoIfUnused(path: string | null | undefined) {
  const id = path?.match(/^\/api\/photos\/([0-9a-f-]{36})$/i)?.[1];
  if (!id) return;
  const sql = db();
  const [used] = await sql`select (select count(*) from products where photo_path = ${path}) + (select count(*) from check_areas where guide_photo_path = ${path}) as n`;
  if (Number(used.n) === 0) await sql`delete from photos where id = ${id}`;
}

/** Save image bytes we fetched ourselves (e.g. an Open Food Facts photo), with its credit line. */
export async function savePhotoBytes(bytes: Uint8Array, credit: string | null, sourceUrl: string | null): Promise<{ path: string } | { error: string }> {
  const type = sniff(bytes);
  if (!type) return { error: 'That isn’t a photo the app can use (JPEG, PNG or WebP).' };
  if (bytes.length > 2_000_000) return { error: 'That photo is too large.' };
  const sql = db();
  const [{ has }] = await sql`select exists (select 1 from information_schema.columns where table_name = 'photos' and column_name = 'credit') as has`;
  const [row] = has
    ? await sql`insert into photos (data, content_type, bytes, credit, source_url) values (${Buffer.from(bytes)}, ${type}, ${bytes.length}, ${credit}, ${sourceUrl}) returning id`
    : await sql`insert into photos (data, content_type, bytes) values (${Buffer.from(bytes)}, ${type}, ${bytes.length}) returning id`;
  return { path: `/api/photos/${row.id}` };
}
