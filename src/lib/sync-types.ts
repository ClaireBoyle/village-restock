// The messages a device sends to the server. Every change is a small "op"
// with its own id, so sending the same op twice (after a dropped connection)
// only ever applies it once.
import { z } from 'zod';

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
}).strict();

const base = { opId: z.uuid(), at: z.iso.datetime(), by: name };

export const opSchema = z.discriminatedUnion('type', [
  z.object({
    ...base, type: z.literal('session.start'),
    session: z.object({
      id: z.uuid(), departmentId: z.uuid(), kind: z.enum(['full', 'quick']),
      tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startedAt: z.iso.datetime(),
    }),
  }),
  z.object({ ...base, type: z.literal('item.set'), sessionId: z.uuid(), placementId: z.uuid(), fields: itemFieldsSchema }),
  z.object({
    ...base, type: z.literal('area.set'), sessionId: z.uuid(), areaId: z.uuid(),
    status: z.enum(['not_started', 'complete', 'skipped']), skipReason: z.string().trim().max(80).nullable(),
  }),
  z.object({ ...base, type: z.literal('session.finish'), sessionId: z.uuid(), exceptionReason: z.string().trim().max(80).nullable() }),
  z.object({ ...base, type: z.literal('session.reopen'), sessionId: z.uuid() }),
]);

export type SyncOp = z.infer<typeof opSchema>;
export type ItemFields = z.infer<typeof itemFieldsSchema>;

export const syncRequestSchema = z.object({
  deviceId: z.string().min(8).max(64),
  ops: z.array(z.unknown()).max(100),
});

export type OpResult =
  | { opId: string; ok: true; mergedInto?: string }
  | { opId: string; ok: false; error: string; permanent: boolean };

export interface SyncResponse { results: OpResult[]; serverTime: string }

/** A session as the server knows it (for handover between devices). */
export interface RemoteSession {
  id: string; departmentId: string; kind: 'full' | 'quick'; tradingDate: string;
  status: 'open' | 'finished' | 'finished_exceptions' | 'unfinished';
  exceptionReason: string | null; people: string[]; startedAt: string; finishedAt: string | null; updatedAt: string;
  areas: { areaId: string; status: 'not_started' | 'in_progress' | 'complete' | 'skipped'; skipReason: string | null; updatedBy: string | null; updatedAt: string }[];
  items: ({ placementId: string; updatedBy: string | null; updatedAt: string } & Required<ItemFields>)[];
}
