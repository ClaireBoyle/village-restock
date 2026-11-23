// Morning prep handover (Gold Class Kitchen): what the closing team says the morning team needs to
// prep. Kept with that night's restock but tracked on its own: choosing tasks never changes the
// restock, and the morning team marking tasks Done never changes it either.

export type PrepGroup = 'vegetables' | 'proteins' | 'sauces' | 'other';
export const PREP_GROUPS: [PrepGroup, string][] = [['vegetables', 'Vegetables'], ['proteins', 'Proteins'], ['sauces', 'Sauces'], ['other', 'Other']];
export const prepGroupLabel = (g: PrepGroup) => PREP_GROUPS.find((x) => x[0] === g)?.[1] ?? 'Other';

/** One job on the checklist (set up in Admin → Morning prep). */
export interface PrepTask {
  id: string; departmentId: string; group: PrepGroup; name: string; sortOrder: number;
  /** On the morning handover list (Finish screen). Missing = yes. */
  active?: boolean;
  /** On the Prep checklist, and how it's shown there (needs migration 021). Blank = its group / task name. */
  onChecklist?: boolean; checklistGroup?: string | null; checklistName?: string | null;
}

/** Prep checklist jobs, grouped by shelf ("Make sauces"), groups in the order of their first job. */
export function checklistGroups(tasks: PrepTask[]): { name: string; tasks: (PrepTask & { label: string })[] }[] {
  const out: { name: string; tasks: (PrepTask & { label: string })[] }[] = [];
  for (const t of [...tasks].filter((x) => x.onChecklist).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
    const name = t.checklistGroup?.trim() || prepGroupLabel(t.group);
    let g = out.find((x) => x.name === name);
    if (!g) out.push((g = { name, tasks: [] }));
    g.tasks.push({ ...t, label: t.checklistName?.trim() || t.name });
  }
  return out;
}

/** One check on the Prep checklist for a service. status null = Unchecked. */
export interface PrepCheck {
  departmentId: string; tradingDate: string; taskId: string;
  status: 'ready' | 'needs' | null;
  /** "Leave for morning": on the opener's handover. */
  morning: boolean;
  note: string | null;
  morningDoneAt: string | null; morningDoneBy: string | null;
  updatedBy: string | null; updatedAt: string;
}

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

/** Morning prep on the Kitchen screen, by the kind of job: portioning, cutting, sauces (made or portioned), other. */
export type PrepKind = 'portion' | 'cut' | 'sauce' | 'other';
export const PREP_KINDS: [PrepKind, string][] = [['portion', 'Portioning'], ['cut', 'Cutting'], ['sauce', 'Sauces'], ['other', 'Other']];
export function prepKind(i: Pick<PrepItem, 'name' | 'group'>): PrepKind {
  if (i.group === 'sauces' || /\bsauces?\b|\baioli\b|\bmayo\b|\brelish\b|\bdressing\b|\btartare\b/i.test(i.name)) return 'sauce';
  if (/^\s*(portion|bag|weigh)/i.test(i.name)) return 'portion';
  if (/^\s*(cut|dice|slice|shred|chop|wash|peel|julienne|trim)/i.test(i.name)) return 'cut';
  return 'other';
}
