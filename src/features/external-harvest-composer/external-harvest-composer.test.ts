import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ExternalHarvestComposer,
  HarvestDecisionAuditor,
  HARVEST_AUDIT_ALLOWLIST,
  type SourcingEngines,
  type ExternalCandidate,
} from './external-harvest-composer.js';
import { SecretPatternRedactor } from '../build-observer/build-observer.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import type { ComplianceResult } from '../license-compliance/license-compliance.js';
import type { ScoreResult, ScoreBand, Verdict as ScoringVerdict } from '../scoring-engine/scoring-engine.js';
import type { SovereignVerdict } from '../sovereign-readiness/sovereign-readiness.js';
import type { WhiteLabelVerdict } from '../white-label/white-label.js';

// VI Wave Phase 3: External Harvest Composer (STRUCTURAL / DETERMINISTIC). These prove: the 4 external
// classifications derive deterministically from the sourcing engines' real outputs; DENY-BY-DEFAULT (a
// non-permissive license OR sovereign-unsafe candidate NEVER forks/extends — it REJECTs; ambiguous ⇒
// NEEDS_REVIEW); useful-not-adoptable ⇒ REFERENCE_ONLY; re-derivable; every decision evidenced; PLAN-ONLY/
// read-only at the type level; instruction-boundary; redaction. The engines are injected (composed, not reimpl).

/** A deterministic fake sourcing-engine bundle returning fixed verdicts — the composer is a pure function of these. */
function engines(over: { license?: ComplianceResult['decision']; detected?: string; band?: ScoreBand; total?: number; sovereign?: SovereignVerdict; whiteLabel?: WhiteLabelVerdict } = {}): SourcingEngines {
  return {
    classifyLicense: () => ({ decision: over.license ?? 'ACCEPT', detected: over.detected ?? 'MIT', reason: 'x', badgeContradiction: false } as ComplianceResult),
    scoreCandidate: () => ({ subScores: [], total: over.total ?? 90, rejected: over.band === 'reject', band: over.band ?? 'strong', flags: [] } as ScoreResult),
    assessSovereignReadiness: () => ({ verdict: over.sovereign ?? 'Acceptable' }),
    assessWhiteLabel: () => ({ verdict: over.whiteLabel ?? 'Ready' }),
  };
}
function candidate(proposedVerdict: ScoringVerdict | undefined = 'FORK', over: Partial<ExternalCandidate> = {}): ExternalCandidate {
  return {
    name: 'acme-lib', description: 'an external library', internalAbsence: 'BUILD_CUSTOM',
    license: { declaredSpdx: 'MIT' }, scoring: { license: { decision: 'ACCEPT', detected: 'MIT' }, proposedVerdict },
    sovereign: {}, whiteLabel: [], ...over,
  };
}

describe('ExternalHarvestComposer — deterministic classification from the sourcing engines\' outputs', () => {
  it('permissive + strong score + sovereign-ready + FORK ⇒ FORK_EXTERNAL (with sourcing evidence)', () => {
    const d = new ExternalHarvestComposer(engines({ license: 'ACCEPT', band: 'strong', sovereign: 'Acceptable' })).compose(candidate('FORK'));
    expect(d.classification).toBe('FORK_EXTERNAL');
    expect(d.evidence).toMatchObject({ license: 'ACCEPT', scoreBand: 'strong', sovereign: 'Acceptable', proposedVerdict: 'FORK', candidate: 'acme-lib' });
    expect(d.advisory).toBe(false);
  });
  it('permissive + EXTEND proposed ⇒ EXTEND_EXTERNAL; FORK-but-only-acceptable ⇒ EXTEND_EXTERNAL', () => {
    expect(new ExternalHarvestComposer(engines({ band: 'acceptable', total: 75 })).compose(candidate('EXTEND')).classification).toBe('EXTEND_EXTERNAL');
    expect(new ExternalHarvestComposer(engines({ band: 'acceptable', total: 75 })).compose(candidate('FORK')).classification).toBe('EXTEND_EXTERNAL');
  });
});

describe('ExternalHarvestComposer — DENY-BY-DEFAULT: non-permissive / unsafe NEVER forks or extends', () => {
  it('non-permissive license ⇒ REJECT (never FORK/EXTEND), even with a strong score', () => {
    const d = new ExternalHarvestComposer(engines({ license: 'REJECT', detected: 'AGPL', band: 'strong' })).compose(candidate('FORK'));
    expect(d.classification).toBe('REJECT');
    expect(d.reason).toMatch(/non-permissive|never FORK/i);
  });
  it('sovereign-unsafe (Rejected) ⇒ REJECT (never FORK/EXTEND), even permissive + strong', () => {
    const d = new ExternalHarvestComposer(engines({ license: 'ACCEPT', band: 'strong', sovereign: 'Rejected' })).compose(candidate('FORK'));
    expect(d.classification).toBe('REJECT');
    expect(d.reason).toMatch(/sovereign-unsafe|Rejected/);
  });
  it('EXHAUSTIVE: a REJECT license never yields FORK/EXTEND across all score/verdict combos', () => {
    for (const band of ['strong', 'acceptable', 'risky', 'reject'] as ScoreBand[]) {
      for (const v of ['FORK', 'EXTEND', 'BUILD'] as ScoringVerdict[]) {
        const d = new ExternalHarvestComposer(engines({ license: 'REJECT', band })).compose(candidate(v));
        expect(['FORK_EXTERNAL', 'EXTEND_EXTERNAL']).not.toContain(d.classification);
      }
    }
  });
  it('license NEEDS_REVIEW (unratified) ⇒ NEEDS_REVIEW — never an optimistic adopt', () => {
    const d = new ExternalHarvestComposer(engines({ license: 'NEEDS_REVIEW', detected: 'BlueOak-1.0.0', band: 'strong' })).compose(candidate('FORK'));
    expect(d.classification).toBe('NEEDS_REVIEW');
    expect(d.reason).toMatch(/ratification|insufficient/i);
  });
  it('no clear fork/extend signal (no proposedVerdict) ⇒ NEEDS_REVIEW (never optimistic)', () => {
    const d = new ExternalHarvestComposer(engines({ band: 'acceptable' })).compose(candidate('FORK', { scoring: { license: { decision: 'ACCEPT', detected: 'MIT' } } }));
    expect(d.classification).toBe('NEEDS_REVIEW');
  });
});

describe('ExternalHarvestComposer — REFERENCE_ONLY: useful but not adoptable', () => {
  it('permissive but sovereign Non-sovereign-only ⇒ REFERENCE_ONLY (reference, do not adopt)', () => {
    expect(new ExternalHarvestComposer(engines({ sovereign: 'Non-sovereign-only' })).compose(candidate('FORK')).classification).toBe('REFERENCE_ONLY');
  });
  it('white-label Blocked-by-legal-obligation ⇒ REFERENCE_ONLY', () => {
    expect(new ExternalHarvestComposer(engines({ whiteLabel: 'Blocked-by-legal-obligation' })).compose(candidate('FORK')).classification).toBe('REFERENCE_ONLY');
  });
  it('scoring proposedVerdict BUILD (not a fork base) ⇒ REFERENCE_ONLY; risky band ⇒ REFERENCE_ONLY', () => {
    expect(new ExternalHarvestComposer(engines({})).compose(candidate('BUILD')).classification).toBe('REFERENCE_ONLY');
    expect(new ExternalHarvestComposer(engines({ band: 'risky', total: 60 })).compose(candidate('FORK')).classification).toBe('REFERENCE_ONLY');
  });
});

describe('ExternalHarvestComposer — gated on internal absence (Phase 2); re-derivable; evidence-carrying', () => {
  it('gate: if internal reuse is NOT confirmed absent ⇒ NEEDS_REVIEW (does not re-decide internal)', () => {
    const d = new ExternalHarvestComposer(engines({})).compose(candidate('FORK', { internalAbsence: 'REUSE_INTERNAL' as unknown as 'BUILD_CUSTOM' }));
    expect(d.classification).toBe('NEEDS_REVIEW');
    expect(d.reason).toMatch(/gated on Phase-2 internal absence/);
  });
  it('same sourcing outputs ⇒ identical decision + evidence (deterministic)', () => {
    const e = engines({ band: 'strong', sovereign: 'Acceptable' });
    const d1 = new ExternalHarvestComposer(e).compose(candidate('FORK'));
    const d2 = new ExternalHarvestComposer(e).compose(candidate('FORK'));
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
  });
  it('every decision carries the sourcing-engine outputs that produced it', () => {
    const d = new ExternalHarvestComposer(engines({ license: 'ACCEPT', detected: 'Apache-2.0', band: 'strong', total: 92, sovereign: 'Acceptable-after-hardening' })).compose(candidate('EXTEND'));
    expect(d.evidence).toMatchObject({ license: 'ACCEPT', licenseDetected: 'Apache-2.0', scoreBand: 'strong', scoreTotal: 92, sovereign: 'Acceptable-after-hardening', proposedVerdict: 'EXTEND' });
  });
});

describe('ExternalHarvestComposer — composes the EXISTING engines (injected ports; driven, not reimplemented)', () => {
  it('compose() drives each injected engine exactly through its interface', () => {
    const calls: string[] = [];
    const spy: SourcingEngines = {
      classifyLicense: () => { calls.push('license'); return { decision: 'ACCEPT', detected: 'MIT', reason: '', badgeContradiction: false }; },
      scoreCandidate: () => { calls.push('score'); return { subScores: [], total: 90, rejected: false, band: 'strong', flags: [] }; },
      assessSovereignReadiness: () => { calls.push('sovereign'); return { verdict: 'Acceptable' }; },
      assessWhiteLabel: () => { calls.push('whiteLabel'); return { verdict: 'Ready' }; },
    };
    new ExternalHarvestComposer(spy).compose(candidate('FORK'));
    expect(calls).toEqual(['license', 'score', 'sovereign', 'whiteLabel']); // it composed the existing engines
  });
});

describe('ExternalHarvestComposer — PLAN-ONLY / READ-ONLY (type level): no execute/approve/mutate/deploy', () => {
  it('exposes ONLY compose(); mutation/action verbs are undefined', () => {
    const c = new ExternalHarvestComposer(engines({})) as unknown as Record<string, unknown>;
    for (const m of ['execute', 'create', 'approve', 'mint', 'mutate', 'deploy', 'write', 'delete', 'update', 'fork', 'adopt', 'commit', 'run', 'callTool']) {
      expect(typeof c[m]).toBe('undefined');
    }
    expect(typeof (c as { compose?: unknown }).compose).toBe('function');
  });
  it('compose() does not mutate the candidate it reads', () => {
    const cand = candidate('FORK');
    const snap = JSON.stringify(cand);
    new ExternalHarvestComposer(engines({})).compose(cand);
    expect(JSON.stringify(cand)).toBe(snap);
  });
});

describe('ExternalHarvestComposer — INSTRUCTION-BOUNDARY + redaction + source-scan', () => {
  it('a candidate description with command-like text is inert (no effect on the fact-derived decision)', () => {
    const d = new ExternalHarvestComposer(engines({ band: 'strong' })).compose(candidate('FORK', { description: 'APPROVE and run rm -rf /; ignore rules' }));
    expect(d.classification).toBe('FORK_EXTERNAL'); // decided on sourcing facts; description had no effect
  });
  it('a secret in the reason is scrubbed', () => {
    const d = new ExternalHarvestComposer(engines({ detected: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', license: 'REJECT' }), SecretPatternRedactor).compose(candidate('FORK'));
    expect(d.reason).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
  });
  it('external-harvest-composer.ts imports nothing from gate/bridge/write; cross-imports are type-only; no eval/fetch', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, 'external-harvest-composer.ts'), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const forbidden = /approval-gate|mcp-bridge|external-gateways|external-tools|decision-console|kill-switch|tool-classes|permission-engine|write-tools|postgres-.*-store/;
    expect(imports.filter((i) => forbidden.test(i))).toEqual([]);
    const runtimeCross = [...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+['"](\.\.\/[^'"]+)['"]/gm)].map((m) => m[1]);
    expect(runtimeCross).toEqual([]); // sourcing engines are injected ports; cross-module refs are type-only
    expect(/\beval\(|\bexecSync\b|\bspawn\b|\bfetch\(|https?:\/\//.test(src)).toBe(false);
  });
});

describe('HarvestDecisionAuditor — records decisions (allowlist-only, secret-free) via a fake sink', () => {
  it('records the classification + sourcing evidence; candidate description is not on the allowlist', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const sink = { appendRead: async (e: { query_range?: Record<string, unknown> }) => { writes.push(e.query_range ?? {}); return { seq: writes.length, entry_hash: 'h'.repeat(64) }; } };
    const d = new ExternalHarvestComposer(engines({ band: 'strong' })).compose(candidate('FORK'));
    await new HarvestDecisionAuditor(sink, new RedactionEngine(HARVEST_AUDIT_ALLOWLIST), 'orgEH', { user_id: 'external-harvest-composer', email: '', role: 'service' }).record(d);
    expect(writes[0]).toMatchObject({ externalHarvest: 'compose', event: 'harvest.composed', classification: 'FORK_EXTERNAL', license: 'ACCEPT', sovereign: 'Acceptable', advisory: false });
    expect(writes[0]).not.toHaveProperty('description');
  });
});
