// Redaction Engine (Module 24) — server-side, DENY-BY-DEFAULT, allowlist-based.
//
// Governing rule (§24): a field is REDACTED unless explicitly allowlisted. New/unknown
// fields are sensitive by default — never the reverse. Redaction is the default state;
// exposure is the exception that must be deliberately granted.
//
// STANDALONE-PACKAGEABLE (REQUIREMENT_PRODUCT_APP_PACKAGING.md): this file imports NOTHING
// from the audit engine (or any other engine). It satisfies the audit sink's `RedactionPolicy`
// seam STRUCTURALLY (TypeScript structural typing) — a test asserts assignability — so the
// engine can ship as its own unit with zero cross-engine coupling.

/** Conservative default allowlist for audit request summaries (lowercased compare). */
export const DEFAULT_AUDIT_ALLOWLIST: readonly string[] = [
  'query', 'status', 'sector', 'limit', 'offset', 'page',
  'include_contacts', 'include_projects', 'action', 'tool', 'target',
  'id', 'kind', 'range', 'all', 'count', 'filter',
];

export class RedactionEngine {
  private readonly allow: Set<string>;

  constructor(allowlist: Iterable<string> = DEFAULT_AUDIT_ALLOWLIST) {
    this.allow = new Set([...allowlist].map((k) => k.toLowerCase()));
  }

  /** True if a key is explicitly allowlisted (exposure is the deliberate exception). */
  isAllowed(key: string): boolean {
    return this.allow.has(key.toLowerCase());
  }

  /**
   * Redact a free-form payload summary. Keys not on the allowlist are dropped entirely
   * (deny-by-default). Allowlisted keys survive; nested objects are filtered with the
   * same allowlist, so a nested key must also be allowlisted to survive.
   * Signature matches the audit sink's RedactionPolicy seam (structural).
   */
  redactSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (summary === undefined) return undefined;
    return this.filter(summary) as Record<string, unknown>;
  }

  private filter(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.filter(v));
    if (value && typeof value === 'object') {
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src)) {
        if (this.allow.has(k.toLowerCase())) {
          out[k] = this.filter(src[k]); // allowlisted → keep, recurse with same allowlist
        }
        // else: deny-by-default → drop the key (and its subtree) entirely
      }
      return out;
    }
    return value; // primitive sitting at an already-allowlisted position
  }
}
