// Provenance — the load-bearing type of the whole read plane (Design §2.1). WHERE a value came from.
//
// `Provenanced<T>` is a present|absent discriminated union: a PRESENT value REQUIRES present provenance
// { source, locator, pin, readAt } whose source is a real read source (git / report-file / test-run /
// source-constant / derived) — never 'absent'. An ABSENT value carries null + a reason (honest "we don't know
// yet", e.g. an M3 store). There is NO way to express a present operational value without present provenance —
// a bare value is both a TYPE error and a SCHEMA failure. This is Rule 0 made structural.

import { z } from 'zod';

/** The real read sources. Deliberately excludes 'absent' — a present value can never carry an absent source. */
export const ProvenanceSource = z.enum(['git', 'report-file', 'test-run', 'source-constant', 'derived']);
export type ProvenanceSource = z.infer<typeof ProvenanceSource>;

/** WHERE the read happened: a file path, a shell command, or a source module export. */
export const Locator = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string() }),
  z.object({ kind: z.literal('cmd'), cmd: z.string() }),
  z.object({ kind: z.literal('module'), module: z.string(), export: z.string() }),
]);
export type Locator = z.infer<typeof Locator>;

/** WHAT the value is pinned to: a git commit, a content hash, or nothing (a source constant read at import). */
export const Pin = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commit'), commit: z.string() }),
  z.object({ kind: z.literal('hash'), sha256: z.string() }),
  z.object({ kind: z.literal('none') }),
]);
export type Pin = z.infer<typeof Pin>;

export const PresentProvenance = z.object({
  source: ProvenanceSource,       // NOT 'absent' — enforced by the enum above
  locator: Locator,
  pin: Pin,
  readAt: z.string(),             // ISO-8601 (kept a plain string to avoid zod-version datetime quirks)
});
export type PresentProvenance = z.infer<typeof PresentProvenance>;

export const AbsentProvenance = z.object({
  source: z.literal('absent'),    // the ONLY provenance a null value may carry
  reason: z.string(),             // WHY there is no value (e.g. "approvals store lands in M3")
  readAt: z.string(),
});
export type AbsentProvenance = z.infer<typeof AbsentProvenance>;

/**
 * The `Provenanced<T>` combinator. `present` ⇒ real value + present provenance; `absent` ⇒ null + reason.
 * Operational fields are declared `provenanced(inner)`, never bare — so a bare value fails the schema.
 */
export function provenanced<T extends z.ZodTypeAny>(inner: T) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('present'), value: inner, provenance: PresentProvenance }),
    z.object({ status: z.literal('absent'), value: z.null(), provenance: AbsentProvenance }),
  ]);
}

/** The inferred TS shape (mirrors the zod combinator) — a bare value is a TYPE error against this. */
export type Provenanced<T> =
  | { status: 'present'; value: T; provenance: PresentProvenance }
  | { status: 'absent'; value: null; provenance: AbsentProvenance };

// ── Constructors — the ONLY sanctioned way to stamp provenance (adapters use these; nothing else). ──────────
export const present = <T>(value: T, provenance: PresentProvenance): Provenanced<T> => ({ status: 'present', value, provenance });
export const absent = <T = never>(reason: string, readAt: string): Provenanced<T> => ({ status: 'absent', value: null, provenance: { source: 'absent', reason, readAt } });
