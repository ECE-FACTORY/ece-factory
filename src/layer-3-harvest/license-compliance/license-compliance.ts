// License & Compliance Engine (Module 10) — prevents unsafe licenses from entering ECE products.
//
// Core guarantee: classify from the ACTUAL LICENSE TEXT, not a declared badge. When a badge and the
// text disagree, the TEXT WINS (the immudb lesson: badge "Apache", actual text BSL ⇒ REJECT).
// Off-allowlist-but-permissive ⇒ NEEDS_REVIEW (human ratification, as with BlueOak), never silent ACCEPT.
//
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine.

export type ComplianceDecision = 'ACCEPT' | 'REJECT' | 'NEEDS_REVIEW';

/** Accepted allowlist — matches organization-source-of-truth ORG_STANDARDS.md. */
export const ACCEPTED_LICENSES = [
  'Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0', 'PostgreSQL', 'ISC', 'BlueOak-1.0.0',
] as const;

/** Rejected set — copyleft / source-available / non-commercial / restrictive. */
export const REJECTED_LICENSES = [
  'GPL', 'LGPL', 'AGPL', 'SSPL', 'BSL', 'Elastic-2.0', 'Commons-Clause', 'NonCommercial',
] as const;

/** Recognized but off-allowlist permissive — requires human ratification (not auto-accept). */
export const OFF_ALLOWLIST_PERMISSIVE = ['Unlicense', 'Zlib', '0BSD'] as const;

const ACCEPTED = new Set<string>(ACCEPTED_LICENSES);
const REJECTED = new Set<string>(REJECTED_LICENSES);
const PERMISSIVE_OFF = new Set<string>(OFF_ALLOWLIST_PERMISSIVE);

export interface LicenseInput {
  /** The actual LICENSE file content — authoritative. */
  text?: string;
  /** A declared badge / package.json field — NON-authoritative (the text wins on conflict). */
  declaredSpdx?: string;
  /** Repo/package name for messages. */
  source?: string;
}

export interface ComplianceResult {
  decision: ComplianceDecision;
  detected: string; // SPDX identity detected FROM TEXT (or 'unknown')
  reason: string;
  badgeContradiction: boolean;
}

/** Identify a license from its full TEXT via signatures. Ordered: specific/rejected first. */
export function detectFromText(text: string): string {
  const t = text;
  if (/commons clause/i.test(t)) return 'Commons-Clause';
  if (/non[-\s]?commercial/i.test(t)) return 'NonCommercial';
  if (/server side public license/i.test(t)) return 'SSPL';
  if (/business source license|\bbusl\b/i.test(t)) return 'BSL';
  if (/elastic license/i.test(t)) return 'Elastic-2.0';
  if (/affero general public license/i.test(t)) return 'AGPL';
  if (/lesser general public license/i.test(t)) return 'LGPL';
  if (/gnu general public license/i.test(t)) return 'GPL';
  if (/apache license/i.test(t) && /version 2\.0/i.test(t)) return 'Apache-2.0';
  if (/mozilla public license/i.test(t) && /2\.0/i.test(t)) return 'MPL-2.0';
  if (/blue oak model license/i.test(t)) return 'BlueOak-1.0.0';
  if (/postgresql licen[cs]e/i.test(t)) return 'PostgreSQL';
  if (/neither the name of[\s\S]{0,120}endorse|bsd 3-clause|3-clause bsd/i.test(t)) return 'BSD-3-Clause';
  if (/bsd 2-clause|2-clause bsd|redistribution and use in source and binary forms/i.test(t)) return 'BSD-2-Clause';
  if (/isc license|permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i.test(t)) return 'ISC';
  if (/permission is hereby granted, free of charge/i.test(t)) return 'MIT';
  if (/unlicense|free and unencumbered software released into the public domain/i.test(t)) return 'Unlicense';
  if (/zlib license|altered source versions must be plainly marked/i.test(t)) return 'Zlib';
  if (/zero-clause bsd|\b0bsd\b/i.test(t)) return '0BSD';
  return 'unknown';
}

/** Loose identity from a short declared badge string (NON-authoritative). */
export function labelFromBadge(badge: string): string {
  const b = badge.trim();
  if (b === '' || /noassertion|^none$|^unlicensed$/i.test(b)) return 'noclaim';
  if (/apache/i.test(b)) return 'Apache-2.0';
  if (/agpl/i.test(b)) return 'AGPL';
  if (/lgpl/i.test(b)) return 'LGPL';
  if (/\bgpl/i.test(b)) return 'GPL';
  if (/mpl|mozilla/i.test(b)) return 'MPL-2.0';
  if (/bsd.?3|3.?clause/i.test(b)) return 'BSD-3-Clause';
  if (/bsd.?2|2.?clause/i.test(b)) return 'BSD-2-Clause';
  if (/postgres/i.test(b)) return 'PostgreSQL';
  if (/\bisc\b/i.test(b)) return 'ISC';
  if (/blue ?oak/i.test(b)) return 'BlueOak-1.0.0';
  if (/sspl|server side/i.test(b)) return 'SSPL';
  if (/bsl|busl|business source/i.test(b)) return 'BSL';
  if (/elastic/i.test(b)) return 'Elastic-2.0';
  if (/commons clause/i.test(b)) return 'Commons-Clause';
  if (/non[-\s]?commercial/i.test(b)) return 'NonCommercial';
  if (/\bmit\b/i.test(b)) return 'MIT';
  return 'unknown';
}

export function classifyLicense(input: LicenseInput): ComplianceResult {
  const text = input.text?.trim() ?? '';
  const badge = input.declaredSpdx?.trim() ?? '';

  if (!text && !badge) {
    return { decision: 'REJECT', detected: 'unknown', reason: 'empty / unverifiable — no LICENSE text or declaration', badgeContradiction: false };
  }

  // No text — a badge alone cannot be trusted (must verify from the actual LICENSE text).
  if (!text) {
    const badgeId = labelFromBadge(badge);
    if (REJECTED.has(badgeId)) {
      return { decision: 'REJECT', detected: 'unknown', reason: `declared "${badge}" is on the rejected set, and there is no LICENSE text to verify`, badgeContradiction: false };
    }
    return { decision: 'NEEDS_REVIEW', detected: 'unknown', reason: `only a declared badge "${badge}", no LICENSE text — must verify from the actual text`, badgeContradiction: false };
  }

  const detected = detectFromText(text);

  let badgeContradiction = false;
  if (badge) {
    const badgeId = labelFromBadge(badge);
    if (detected !== 'unknown' && badgeId !== 'unknown' && badgeId !== 'noclaim' && badgeId !== detected) {
      badgeContradiction = true; // text wins
    }
  }

  if (detected === 'unknown') {
    return { decision: 'NEEDS_REVIEW', detected: 'unknown', reason: 'LICENSE text not recognized — manual identification required', badgeContradiction };
  }
  if (REJECTED.has(detected)) {
    const note = badgeContradiction ? ` (declared badge "${badge}" disagreed — text wins)` : '';
    return { decision: 'REJECT', detected, reason: `${detected} is on the rejected set${note}`, badgeContradiction };
  }
  if (ACCEPTED.has(detected)) {
    return { decision: 'ACCEPT', detected, reason: `${detected} is on the accepted allowlist`, badgeContradiction };
  }
  if (PERMISSIVE_OFF.has(detected)) {
    return { decision: 'NEEDS_REVIEW', detected, reason: `${detected} appears permissive but is off the allowlist — human ratification required (as with BlueOak)`, badgeContradiction };
  }
  return { decision: 'NEEDS_REVIEW', detected, reason: `${detected} recognized but not classified — manual review`, badgeContradiction };
}

export type StackVerdict = 'Clean' | 'Collision-resolvable' | 'Collision-blocking';

/** Whole-stack verdict over component classifications. */
export function stackVerdict(results: ComplianceResult[]): { verdict: StackVerdict; reason: string } {
  if (results.some((r) => r.decision === 'REJECT')) {
    return { verdict: 'Collision-blocking', reason: 'at least one component is on the rejected set' };
  }
  if (results.some((r) => r.decision === 'NEEDS_REVIEW')) {
    return { verdict: 'Collision-resolvable', reason: 'one or more components need human license ratification' };
  }
  return { verdict: 'Clean', reason: 'all components are on the accepted allowlist' };
}
