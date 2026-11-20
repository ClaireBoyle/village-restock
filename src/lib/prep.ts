// Morning prep handover (Gold Class Kitchen): what the closing team says the morning team needs to
// prep. Kept with that night's restock but tracked on its own: choosing tasks never changes the
// restock, and the morning team marking tasks Done never changes it either.

export type PrepGroup = 'vegetables' | 'proteins' | 'sauces' | 'other';
export const PREP_GROUPS: [PrepGroup, string][] = [['vegetables', 'Vegetables'], ['proteins', 'Proteins'], ['sauces', 'Sauces'], ['other', 'Other']];
export const prepGroupLabel = (g: PrepGroup) => PREP_GROUPS.find((x) => x[0] === g)?.[1] ?? 'Other';

/** One job on the checklist (set up in Admin → Morning prep). */
export interface PrepTask { id: string; departmentId: string; group: PrepGroup; name: string; sortOrder: number }

/** A task the closing team selected ("Needs prep"), or one they typed in. */
export interface PrepItem {
  id: string;
  /** The checklist task, or null for one typed in ("Add another task"). */
  taskId: string | null;
  group: PrepGroup;
  name: string;
  qty: string | null;
  note: string | null;
  /** Marked Done by the morning team. */
  doneAt: string | null;
  doneBy: string | null;
}

export interface PrepHandover {
  sessionId: string; departmentId: string; tradingDate: string;
  /** needed: tasks chosen · none: "No morning prep needed". */
  status: 'needed' | 'none';
  items: PrepItem[];
  updatedBy: string | null; updatedAt: string;
}

/** Items in checklist order: by group, then as they were chosen. */
export function sortedItems(items: PrepItem[]): PrepItem[] {
  const rank = (g: PrepGroup) => PREP_GROUPS.findIndex((x) => x[0] === g);
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.group) - rank(b.it.group) || a.i - b.i).map((x) => x.it);
}

/** One line per task, for the summary and the manager email ("Cut carrots for Harvest Hommus · note"). No amounts. */
export function prepLines(h: Pick<PrepHandover, 'status' | 'items'> | null): string[] {
  if (!h) return [];
  if (h.status === 'none') return ['No morning prep needed'];
  return sortedItems(h.items).map((it) => [it.name, it.note].filter(Boolean).join(' · ') + (it.doneAt ? ' (done)' : ''));
}
