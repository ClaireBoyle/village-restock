// The messages a device sends to the server. Every change is a small "op"
// with its own id, so sending the same op twice (after a dropped connection)
// only ever applies it once.
import { z } from 'zod';
import type { Conflict } from './restock-logic';

const qty = z.number().min(0).max(9999).nullable();
const name = z.string().trim().max(30).nullable();

export const itemFieldsSchema = z.object({
  currentQty: qty.optional(),
  requestedQty: qty.optional(),
  routineChoice: z.enum(['needed', 'not_needed']).nullable().optional(),
  collectedMode: z.enum(['all', 'partial']).nullable().optional(),
  collectedQty: qty.optional(),
  shortfallReason: z.enum(['insufficient', 'access', 'time', 'other']).nullable().optional(),
  flagged: z.boolean().optional(),
  /** Candy Bar: nothing collected and none left on display, so it's out of stock. */
  noneOnDisplay: z.boolean().optional(),
  /** Kitchen refill task: refilled · full (already full) · needs_stock (still to do). Records the task only. */
  refillStatus: z.enum(['refilled', 'full', 'needs_stock']).nullable().optional(),
  /** Defrost: pulled from the upstairs freezer (null = not yet). Less than needed: the rest comes from downstairs. */
  upstairsQty: qty.optional(),
  /** Gold Class Bar: staff ticked "None left here" for this spot (an open bottle still in use counts as stock). */
  noneLeftHere: z.boolean().optional(),
  /** Gold Class Bar: what's left at that spot, said when entering a top-up there (null = not said). */
  leftHere: z.enum(['some', 'none']).nullable().optional(),
  /** Gold Class Bar: a shortage status chosen on the Finish screen (null = worked out from the checks). */
  statusOverride: z.enum(['out', 'low', 'unconfirmed']).nullable().optional(),
}).strict();

const base = { opId: z.uuid(), at: z.iso.datetime(), by: name };

const dq = z.number().min(0).max(9999).nullable();
export const defrostFieldsSchema = z.object({
  chilled: dq.optional(), thawing: dq.optional(), adjust: z.number().min(-9999).max(9999).nullable().optional(),
  suggested: dq.optional(), defrost: dq.optional(), ranOut: z.boolean().optional(),
  discarded: dq.optional(), discardReason: z.string().trim().max(80).nullable().optional(),
}).strict();
export type DefrostFields = z.infer<typeof defrostFieldsSchema>;

// Morning prep handover: one task chosen (or typed in) by the closing team.
export const prepItemSchema = z.object({
  id: z.uuid(), taskId: z.uuid().nullable(), group: z.enum(['vegetables', 'proteins', 'sauces', 'other']),
  name: z.string().trim().min(1).max(80), qty: z.string().trim().max(30).nullable(), note: z.string().trim().max(200).nullable(),
}).strict();

/** Prep checklist: Ready / Needs prep (null = Unchecked), Leave for morning, an optional note, and the morning team's Done. */
export const prepCheckFieldsSchema = z.object({
  status: z.enum(['ready', 'needs']).nullable().optional(),
  morning: z.boolean().optional(),
  note: z.string().trim().max(200).nullable().optional(),
  morningDone: z.boolean().optional(),
}).strict();
export type PrepCheckFields = z.infer<typeof prepCheckFieldsSchema>;

export const opSchema = z.discriminatedUnion('type', [
  z.object({
    ...base, type: z.literal('session.start'),
    session: z.object({
      id: z.uuid(), departmentId: z.uuid(), kind: z.enum(['full', 'quick', 'area']),
      tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startedAt: z.iso.datetime(),
      /** Area restocks: the one area this restock covers. */
      areaId: z.uuid().nullable().optional(),
    }).refine((x) => x.kind !== 'area' || !!x.areaId, { message: 'An area restock needs its area' }),
  }),
  z.object({
    ...base, type: z.literal('item.set'), sessionId: z.uuid(), placementId: z.uuid(), fields: itemFieldsSchema,
    /** The values this device last saw from the server, so the server can spot two people disagreeing. */
    base: itemFieldsSchema.optional(),
    /** A person chose between two clashing values: apply it and clear the clash. */
    resolve: z.boolean().optional(),
  }),
  z.object({
    ...base, type: z.literal('area.set'), sessionId: z.uuid(), areaId: z.uuid(),
    status: z.enum(['not_started', 'complete', 'skipped']), skipReason: z.string().trim().max(80).nullable(),
  }),
  z.object({ ...base, type: z.literal('session.finish'), sessionId: z.uuid(), exceptionReason: z.string().trim().max(80).nullable(),
    /** Optional comments for managers (added to the email). */
    note: z.string().trim().max(1000).nullable().optional(),
    /** The name confirmed on the Finish screen ("Completed by"). */
    completedBy: z.string().trim().max(40).nullable().optional() }),
  z.object({ ...base, type: z.literal('session.reopen'), sessionId: z.uuid() }),
  // Morning prep handover for this restock: the whole list each time (null status = not answered yet).
  z.object({ ...base, type: z.literal('prep.set'), sessionId: z.uuid(), status: z.enum(['needed', 'none']).nullable(), items: z.array(prepItemSchema).max(60) }),
  // The morning team marks one task Done (or undoes it). Never changes the restock.
  z.object({ ...base, type: z.literal('prep.done'), sessionId: z.uuid(), itemId: z.uuid(), done: z.boolean() }),
  // Defrost rows: tomorrow's forecast admits, entered once per restock (blank = not entered).
  z.object({ ...base, type: z.literal('session.admits'), sessionId: z.uuid(), admits: z.number().int().min(0).max(9999).nullable() }),
  // Prep checklist: one job's check for a department's service (trading day). Only the fields sent change.
  z.object({
    ...base, type: z.literal('prepcheck.set'), departmentId: z.uuid(), tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), taskId: z.uuid(),
    fields: prepCheckFieldsSchema,
  }),
  // Defrost Planner: one item's entry for a department's next service (blank = not entered).
  z.object({
    ...base, type: z.literal('defrost.set'), planId: z.uuid(), departmentId: z.uuid(), serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    itemId: z.uuid(), fields: defrostFieldsSchema,
  }),
]);

export type SyncOp = z.infer<typeof opSchema>;
export type ItemFields = z.infer<typeof itemFieldsSchema>;

export const syncRequestSchema = z.object({
  deviceId: z.string().min(8).max(64),
  ops: z.array(z.unknown()).max(100),
});

export type OpResult =
  | { opId: string; ok: true; mergedInto?: string; conflict?: boolean }
  | { opId: string; ok: false; error: string; permanent: boolean;
      /** An admin reset this restock (or cleared this defrost plan): drop it from the device. */
      reset?: boolean };

export interface SyncResponse { results: OpResult[]; serverTime: string }

/** A session as the server knows it (for handover between devices). */
export interface RemoteSession {
  id: string; departmentId: string; kind: 'full' | 'quick' | 'area'; tradingDate: string;
  /** Area restocks: the area it covers. */
  areaId: string | null;
  status: 'open' | 'finished' | 'finished_exceptions' | 'unfinished';
  exceptionReason: string | null; note: string | null; people: string[];
  /** The name confirmed on the Finish screen, once finished. */
  completedBy: string | null;
  /** Defrost rows: tomorrow's forecast admits, if entered. */
  forecastAdmits: number | null; startedAt: string; finishedAt: string | null; updatedAt: string;
  areas: { areaId: string; status: 'not_started' | 'in_progress' | 'complete' | 'skipped'; skipReason: string | null; updatedBy: string | null; updatedAt: string }[];
  items: ({ placementId: string; updatedBy: string | null; updatedAt: string; conflict: Conflict | null } & Required<ItemFields>)[];
}
