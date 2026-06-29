// White-Label Hardening Engine (Module 13) — classifies each branding/legal element (Layer 1.1 §9)
// and produces a per-element action list + a readiness verdict.
//
// LEGAL CORE — must-keep notices can NEVER be stripped: the engine NEVER emits a strip/replace/disable
// action for a `must-keep` element (license-required attribution / NOTICE / copyright line). Stripping
// an Apache NOTICE or an MIT copyright line is a license violation, not white-labeling — so if
// white-labeling would require removing a legally-mandated notice, the verdict is Blocked-by-legal-
// obligation, never a strip action.
//
// DENY-BY-DEFAULT: an unclassified element is NOT "safe to ship" — it is treated as trademark-caution /
// needs-review ("might be legally required"), never silently passed as replaceable.
//
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine.

export type ElementCategory = 'must-keep' | 'replaceable' | 'trademark-caution' | 'disable';
export type ActionType = 'preserve' | 'replace' | 'disable' | 'review';
export type WhiteLabelVerdict = 'Ready' | 'Ready-after-stripping' | 'Blocked-by-legal-obligation';

export interface BrandingElement {
  id: string;
  description?: string;
  /** Undefined ⇒ unclassified ⇒ deny-by-default treated as trademark-caution / needs-review. */
  category?: ElementCategory;
  /** For a must-keep element: would the requested white-labeling require REMOVING it? (a legal conflict) */
  whiteLabelingRequiresRemoval?: boolean;
}

export interface ElementAction {
  id: string;
  category: ElementCategory;
  action: ActionType;
  directive: string;
  legalConflict: boolean;
}

export interface WhiteLabelReport {
  verdict: WhiteLabelVerdict;
  actions: ElementAction[];
}

function classify(e: BrandingElement): ElementAction {
  const unclassified = e.category === undefined;
  const category: ElementCategory = e.category ?? 'trademark-caution'; // deny-by-default

  switch (category) {
    case 'must-keep': {
      // NEVER strip/replace/disable. Only ever 'preserve'. A white-label conflict is flagged, not stripped.
      const conflict = e.whiteLabelingRequiresRemoval === true;
      return {
        id: e.id,
        category,
        action: 'preserve',
        legalConflict: conflict,
        directive: conflict
          ? `preserve ${e.id} — legally-required notice; white-labeling CANNOT strip it (Blocked-by-legal-obligation; resolve the conflict, do not remove)`
          : `preserve ${e.id} — legal attribution / license notice (stripping it would be a license violation)`,
      };
    }
    case 'replaceable':
      return { id: e.id, category, action: 'replace', legalConflict: false, directive: `replace ${e.id} with ECE branding` };
    case 'disable':
      return { id: e.id, category, action: 'disable', legalConflict: false, directive: `disable ${e.id} (telemetry / analytics key / update-check URL / support link / phone-home)` };
    case 'trademark-caution':
      return {
        id: e.id,
        category,
        action: 'review',
        legalConflict: false,
        directive: unclassified
          ? `review ${e.id} — UNCLASSIFIED; treated as trademark-caution (might be legally required) — needs review, NOT auto-replaced`
          : `review ${e.id} for trademark obligations before shipping`,
      };
  }
}

export function assessWhiteLabel(elements: BrandingElement[]): WhiteLabelReport {
  const actions = elements.map(classify);

  // A must-keep element that the white-labeling would require removing ⇒ Blocked (legal core).
  const blocked = actions.some((a) => a.category === 'must-keep' && a.legalConflict);

  let verdict: WhiteLabelVerdict;
  if (blocked) {
    verdict = 'Blocked-by-legal-obligation';
  } else if (actions.some((a) => a.action === 'replace' || a.action === 'disable' || a.action === 'review')) {
    verdict = 'Ready-after-stripping';
  } else {
    verdict = 'Ready';
  }

  return { verdict, actions };
}
