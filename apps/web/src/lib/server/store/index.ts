import "server-only";
import { memoryCallSessionStore, memoryLeadStore, memorySalesInquiryStore } from "./memory-store";
import type { CallSessionStore, LeadStore, SalesInquiryStore } from "./types";

/**
 * The single seam between application code and the backing datastore.
 * Every call site imports leadStore/callSessionStore/salesInquiryStore
 * from HERE, never from memory-store.ts directly — swapping to a durable
 * production datastore later means changing only this file (point these
 * exports at a new module that implements the same interfaces from
 * ./types), with no changes anywhere else in the app.
 *
 * Currently backed by the in-memory implementation — see memory-store.ts
 * for exactly what that does and does not guarantee.
 */
export const leadStore: LeadStore = memoryLeadStore;
export const callSessionStore: CallSessionStore = memoryCallSessionStore;
export const salesInquiryStore: SalesInquiryStore = memorySalesInquiryStore;

export type { Lead, CallSessionRecord, CallSessionState, SalesInquiry, FinalizeUsageResult } from "./types";
