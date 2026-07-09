// Envelope parsers — validate each route's `data` against its shared zod contract at the client
// boundary, so a contract drift fails loudly here rather than deep in a component. The schema IS
// the parse; the console imports the same contracts the read plane emits (one truth, no drift).
import { z } from 'zod';
import {
  GitStateSchema,
  TestSuiteRunSchema,
  LawTestRunSchema,
  CapabilityStateSchema,
  StoreStateSchema,
  EvidenceIndexSchema,
  Run,
  provenanced,
} from '../contracts.js';

export const parseGit = (d: unknown) => GitStateSchema.parse(d);
export const parseTests = (d: unknown) => TestSuiteRunSchema.parse(d);
export const parseLaws = (d: unknown) => LawTestRunSchema.parse(d);
export const parseCapabilities = (d: unknown) => CapabilityStateSchema.parse(d);
export const parseStores = (d: unknown) => StoreStateSchema.parse(d);
export const parseEvidence = (d: unknown) => EvidenceIndexSchema.parse(d);

export const ReportsSchema = z.array(provenanced(Run));
export const parseReports = (d: unknown) => ReportsSchema.parse(d);
