// Badge unions — the small closed enums the UI renders as chips. Shared between the API and the UI (Design §2.2).
import { z } from 'zod';

/** A sub-domain sourcing verdict. */
export const DecisionBadge = z.enum(['FORK', 'EXTEND', 'BUILD', 'NEEDS-ASSESSMENT']);
export type DecisionBadge = z.infer<typeof DecisionBadge>;

/** The scout confidence contract — the facts/measured/judgment/unknown split at the dimension level. */
export const EvidenceBadge = z.enum(['measured', 'partial', 'not-mechanizable']);
export type EvidenceBadge = z.infer<typeof EvidenceBadge>;

/** A law/prohibition or test-suite outcome. */
export const LawBadge = z.enum(['pass', 'fail', 'skipped']);
export type LawBadge = z.infer<typeof LawBadge>;

/** A factory capability's posture. 'gated' = reachable only through a human gate; 'absent' = not built yet. */
export const CapabilityBadge = z.enum(['enabled', 'disabled', 'gated', 'absent']);
export type CapabilityBadge = z.infer<typeof CapabilityBadge>;

/** A candidate's license verdict + a spine's normalized score band. */
export const LicenseDecisionBadge = z.enum(['ACCEPT', 'REJECT', 'NEEDS_REVIEW']);
export type LicenseDecisionBadge = z.infer<typeof LicenseDecisionBadge>;
export const ScoreBandBadge = z.enum(['strong', 'acceptable', 'risky', 'reject']);
export type ScoreBandBadge = z.infer<typeof ScoreBandBadge>;

/** The product lens a report was harvested under. */
export const ProductModeBadge = z.enum(['sovereign', 'subscription']);
export type ProductModeBadge = z.infer<typeof ProductModeBadge>;
