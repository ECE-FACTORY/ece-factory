// Sovereign Readiness Engine (Module 12) — checks whether a candidate can run in a sealed,
// air-gapped, sovereign deployment (Layer 1.1 §8), emitting Acceptable / Acceptable-after-hardening /
// Non-sovereign-only / Rejected with per-check reasons.
//
// EXISTENTIAL GUARANTEE — DENY-BY-DEFAULT: an unverifiable/unknown check is treated as non-compliant,
// never "probably offline". Unknown ⇒ at best Acceptable-after-hardening (must verify) — never silently
// Acceptable. Assuming-safe is exactly how a phone-home slips into a sealed deployment.
//
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine.

/** Per-check input states (undefined ⇒ unknown, deny-by-default). */
export type CheckState =
  | 'local' // positively confirmed local/offline
  | 'not-applicable' // genuinely n/a (e.g. no AI inference) — counts as satisfied
  | 'removable-gap' // a gap that can be removed/hardened (optional dep, disable-able telemetry)
  | 'connected-only' // only works in a connected mode — non-sovereign, but functional online
  | 'mandatory-blocker'; // a mandatory foreign-SaaS / phone-home / forced-auto-update that cannot be removed

export interface CheckInput {
  state: CheckState;
  note?: string; // e.g. the required hardening, or what the blocker is
}

export const SOVEREIGN_CHECKS = [
  { id: 'fullyOffline', label: 'fully offline-capable' },
  { id: 'noForeignSaaS', label: 'no foreign SaaS dependency' },
  { id: 'noVendorTelemetry', label: 'no mandatory vendor telemetry / phone-home' },
  { id: 'logsLocal', label: 'logs local' },
  { id: 'identityLocal', label: 'identity local' },
  { id: 'databaseLocal', label: 'database local' },
  { id: 'objectStorageLocal', label: 'object storage local' },
  { id: 'aiInferenceLocal', label: 'AI inference local (or n/a)' },
  { id: 'updatesManual', label: 'updates installable manually (no forced foreign auto-update)' },
  { id: 'dependenciesMirrorable', label: 'dependencies mirrorable' },
  { id: 'containersPrivateRegistry', label: 'containers from a private registry' },
  { id: 'secretsLocal', label: 'secrets local' },
  { id: 'auditLocal', label: 'audit local' },
  { id: 'deploymentReproducibleOffline', label: 'deployment reproducible offline' },
] as const;

export type SovereignCheckId = (typeof SOVEREIGN_CHECKS)[number]['id'];
export type SovereignDescriptor = Partial<Record<SovereignCheckId, CheckInput>>;

export type CheckStatus = 'pass' | 'after-hardening' | 'connected-only' | 'blocker' | 'unknown';
export type SovereignVerdict = 'Acceptable' | 'Acceptable-after-hardening' | 'Non-sovereign-only' | 'Rejected';

export interface CheckResult {
  id: SovereignCheckId;
  label: string;
  status: CheckStatus;
  reason: string;
}
export interface SovereignReport {
  verdict: SovereignVerdict;
  checks: CheckResult[];
}

function evaluate(id: SovereignCheckId, label: string, input: CheckInput | undefined): CheckResult {
  if (!input) {
    return { id, label, status: 'unknown', reason: `${label}: NOT verified — deny-by-default (must positively confirm air-gap safety; unknown ≠ offline)` };
  }
  const note = input.note ? ` — ${input.note}` : '';
  switch (input.state) {
    case 'local':
      return { id, label, status: 'pass', reason: `${label}: confirmed local/offline${note}` };
    case 'not-applicable':
      return { id, label, status: 'pass', reason: `${label}: not applicable${note}` };
    case 'removable-gap':
      return { id, label, status: 'after-hardening', reason: `${label}: removable gap — hardening required${note || ' — remove/disable the optional dependency or telemetry'}` };
    case 'connected-only':
      return { id, label, status: 'connected-only', reason: `${label}: works only in a connected mode — non-sovereign${note}` };
    case 'mandatory-blocker':
      return { id, label, status: 'blocker', reason: `${label}: mandatory foreign dependency cannot be removed${note}` };
  }
}

export function assessSovereignReadiness(d: SovereignDescriptor): SovereignReport {
  const checks = SOVEREIGN_CHECKS.map((c) => evaluate(c.id, c.label, d[c.id]));

  // Verdict precedence: Rejected > Non-sovereign-only > Acceptable-after-hardening > Acceptable.
  let verdict: SovereignVerdict;
  if (checks.some((c) => c.status === 'blocker')) {
    verdict = 'Rejected';
  } else if (checks.some((c) => c.status === 'connected-only')) {
    verdict = 'Non-sovereign-only';
  } else if (checks.some((c) => c.status === 'after-hardening' || c.status === 'unknown')) {
    // An unknown counts against readiness — at best after-hardening, never silently Acceptable.
    verdict = 'Acceptable-after-hardening';
  } else {
    verdict = 'Acceptable';
  }

  return { verdict, checks };
}
