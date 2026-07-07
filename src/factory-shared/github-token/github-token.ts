// Shared GitHub-token boundary guard (factory-shared, cross-layer) — the SINGLE source of truth for "is there a usable token?".
//
// The scout, the signals scout, and every skippable LIVE test route their token through here so a MISSING,
// BLANK, WHITESPACE-ONLY, or OBVIOUSLY-INVALID token is uniformly treated as ABSENT ⇒ fail-closed / skip,
// instead of falling through to an UNAUTHENTICATED (or garbage-authenticated) live GitHub call.
//
// This is a SHAPE check, not a liveness check: it proves the token string is not empty/blank/malformed. A
// well-formed but revoked/expired token can only be rejected by GitHub itself (a 401 ⇒ fail-closed at the
// network boundary). What this guard guarantees is that we never even ATTEMPT a fetch with a token that is
// self-evidently not a token.
//
// TOKEN SAFETY: this module never logs, stores, or emits the token — it only inspects its shape and returns
// the trimmed value or `undefined`.

/** Minimum non-trivial length. Real GitHub tokens are far longer (classic 40, `ghp_`/`github_pat_` longer);
 *  a value shorter than this is self-evidently not a token. Deliberately conservative to never reject a real one. */
const MIN_TOKEN_LENGTH = 10;

/**
 * Normalize a raw token into a USABLE token or `undefined`.
 * Treated as ABSENT (⇒ `undefined`) when: not a string / empty / whitespace-only / contains internal
 * whitespace / shorter than {@link MIN_TOKEN_LENGTH}. Otherwise returns the trimmed token.
 */
export function normalizeGithubToken(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (t.length === 0) return undefined;          // "" or whitespace-only ⇒ absent
  if (/\s/.test(t)) return undefined;            // internal whitespace ⇒ not a real token
  if (t.length < MIN_TOKEN_LENGTH) return undefined; // trivially short ⇒ not a real token
  return t;
}

/** True iff {@link normalizeGithubToken} accepts the value. Use to gate a live path or skip a live test. */
export function hasValidGithubToken(raw: string | undefined | null): boolean {
  return normalizeGithubToken(raw) !== undefined;
}
