// Policy Engine — EXAMPLE rules across the three dimensions (Wave 6, Piece 2). These are a starter set to
// exercise the framework; the full ruleset is filled later as governed, versioned config. Rules are ordinary
// `PolicyRule` objects (code) or built from the declarative helpers below — either way, adding a rule is
// adding it to a `PolicySet`; the engine core does NOT change.
//
// SEVERITY: hard = policy-blocking (withheld at the Console, non-overridable); soft = advisory (an authorized
// human may APPROVE anyway, recorded with a reason). Approval-authority rules use `escalation` — a violation
// raises the required approver (senior / dual) rather than blocking.

import type { PolicyRule, PolicySet, PolicyActionFacts } from './policy-engine.js';

// ── declarative helpers (config-driven rule construction — no engine change) ─────────────────────────────
/** A rule that VIOLATES when `predicate(facts)` is true (i.e. satisfied = !predicate). Pure. */
export function ruleWhen(id: string, dimension: PolicyRule['dimension'], severity: PolicyRule['severity'], description: string, predicate: (f: PolicyActionFacts) => boolean, escalation?: PolicyRule['escalation']): PolicyRule {
  return { id, dimension, severity, description, escalation, check: (f) => !predicate(f) };
}
/** A soft allow-list rule: the target must be on `allowed` (empty allow-list ⇒ always satisfied / not enforced). */
export function allowlistRule(id: string, allowed: readonly string[]): PolicyRule {
  return ruleWhen(id, 'operational-safety', 'soft', `target must be on the allow-list [${allowed.join(', ') || '—'}]`, (f) => allowed.length > 0 && !!f.target && !allowed.includes(f.target));
}

const lc = (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : '');
const payloadField = (f: PolicyActionFacts, key: string): unknown => (f.payload && typeof f.payload === 'object' ? (f.payload as Record<string, unknown>)[key] : undefined);
/** A CII/regulated target is flagged by a marker in the target/effect (example heuristic; real markers come from config). */
function touchesRegulated(f: PolicyActionFacts): boolean {
  const hay = `${lc(f.target)} ${lc(f.effect)}`;
  return /\b(cii|regulated|nca|ncap|critical-infra)\b/.test(hay);
}

// ── COMPLIANCE (hard) ────────────────────────────────────────────────────────────────────────────────────
export const complianceCiiAccreditation: PolicyRule = ruleWhen(
  'compliance.cii-accreditation', 'compliance', 'hard',
  'an action touching a CII/regulated target must carry an accreditation flag (payload.accreditation=true)',
  (f) => touchesRegulated(f) && payloadField(f, 'accreditation') !== true,
);
export const complianceDataSovereignty: PolicyRule = ruleWhen(
  'compliance.data-sovereignty', 'compliance', 'hard',
  'cross-border data egress must be sovereignty-cleared (payload.sovereigntyCleared=true)',
  (f) => (/\begress|export|cross-border\b/.test(lc(f.effect)) || payloadField(f, 'crossBorder') === true) && payloadField(f, 'sovereigntyCleared') !== true,
);

// ── OPERATIONAL SAFETY ───────────────────────────────────────────────────────────────────────────────────
export const safetyNoPublicRepo: PolicyRule = ruleWhen(
  'safety.no-public-repo', 'operational-safety', 'hard',
  'repositories must not be public (payload.private must not be false)',
  (f) => f.tool === 'create_github_repo' && payloadField(f, 'private') === false,
);
export const safetyProdChangeWindow: PolicyRule = ruleWhen(
  'safety.prod-change-window', 'operational-safety', 'soft',
  'production deploys should be within a change window (payload.changeWindow=true)',
  (f) => f.tool === 'deploy_package' && lc(f.environment) === 'production' && payloadField(f, 'changeWindow') !== true,
);
/** Example allow-list (empty by default ⇒ not enforced until configured). */
export const safetyTargetAllowlist: PolicyRule = allowlistRule('safety.target-allowlist', []);

// ── APPROVAL AUTHORITY (escalation, not blocking) ────────────────────────────────────────────────────────
export const authorityBlastRadiusDual: PolicyRule = ruleWhen(
  'authority.blast-radius-dual', 'approval-authority', 'soft',
  'high blast radius (>1) requires dual approval (four-eyes)',
  (f) => f.blastRadius > 1, 'REQUIRES-DUAL-APPROVAL',
);
const ELEVATED_TOOLS = new Set(['deploy_package', 'create_github_repo']);
export const authorityElevatedToolSenior: PolicyRule = ruleWhen(
  'authority.elevated-tool-senior', 'approval-authority', 'soft',
  'elevated actions (deploy/repo-creation) require a senior approver',
  (f) => ELEVATED_TOOLS.has(f.tool), 'REQUIRES-SENIOR',
);

/** The starter example ruleset — 2 compliance, 3 safety, 2 authority. */
export const EXAMPLE_RULES: readonly PolicyRule[] = [
  complianceCiiAccreditation, complianceDataSovereignty,
  safetyNoPublicRepo, safetyProdChangeWindow, safetyTargetAllowlist,
  authorityBlastRadiusDual, authorityElevatedToolSenior,
];

/** The default versioned policy set. A change is a NEW version (append-only; history preserved via the store). */
export const DEFAULT_POLICY_SET: PolicySet = { version: 1, rules: EXAMPLE_RULES };
