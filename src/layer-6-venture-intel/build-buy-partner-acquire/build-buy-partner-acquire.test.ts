import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BuildBuyPartnerAcquireEngine,
  UnifiedSourcingAuditor,
  BBPA_AUDIT_ALLOWLIST,
  type UnifiedSourcingInput,
} from './build-buy-partner-acquire.js';
import { SecretPatternRedactor } from '../../layer-4-build-harden/build-observer/build-observer.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import type { ReuseDecision, ReuseClassification } from '../../layer-3-harvest/internal-reuse-engine/internal-reuse-engine.js';
import type { ExternalSourcingDecision, ExternalSourcing, SourcingEvidence } from '../../layer-3-harvest/external-harvest-composer/external-harvest-composer.js';

// VI Wave Phase 4: Build/Buy/Partner/Acquire (STRUCTURAL / DETERMINISTIC) — COMPLETES the backbone. These prove:
// the 7-verdict space resolves deterministically from Phase-2 + Phase-3 outputs; DENY-BY-DEFAULT inherits BOTH
// vetoes (never BUILD over a real REUSE; never BUY a REJECT); PARTNER/ACQUIRE from structural signals (else
// NEEDS_REVIEW); exactly one verdict; re-derivable; evidence-carrying; composes (no own reuse/sourcing logic);
// plan-only/read-only type-level; instruction-boundary; redaction.

function internal(classification: ReuseClassification, topId = 'engine:audit-engine'): ReuseDecision {
  return { classification, reason: 'r', evidence: classification === 'BUILD_CUSTOM' || classification === 'NEEDS_REVIEW' ? [] : [{ id: topId, name: 'x', kind: 'engine', source: 's', posture: { hasAudit: true, hasRedaction: true, hasTests: true, packageable: true, hasPermissions: true }, matchedTerms: ['x'], coverage: 1, postureOk: true }], searched: { terms: ['x'], kind: null, candidatesConsidered: 5 }, advisory: false };
}
function external(classification: ExternalSourcing, ev: Partial<SourcingEvidence> = {}): ExternalSourcingDecision {
  const evidence: SourcingEvidence = { license: 'ACCEPT', licenseDetected: 'MIT', scoreBand: 'strong', scoreTotal: 90, proposedVerdict: 'FORK', sovereign: 'Acceptable', whiteLabel: null, ...ev };
  return { classification, reason: 'r', evidence: { ...evidence, candidate: 'acme', internalAbsence: 'BUILD_CUSTOM' }, advisory: false };
}
function input(over: Partial<UnifiedSourcingInput> = {}): UnifiedSourcingInput {
  return { capability: 'a tamper-evident audit ledger', internal: internal('BUILD_CUSTOM'), ...over };
}
const engine = () => new BuildBuyPartnerAcquireEngine();

describe('BBPA — internal reuse WINS: any internal match ⇒ REUSE, never BUILD (inherits anti-rebuild)', () => {
  for (const c of ['REUSE_INTERNAL', 'EXTEND_INTERNAL', 'FORK_INTERNAL', 'COPY_INTERNAL'] as ReuseClassification[]) {
    it(`internal ${c} ⇒ REUSE (external not consulted)`, () => {
      const d = engine().decide(input({ internal: internal(c), external: external('FORK_EXTERNAL') }));
      expect(d.verdict).toBe('REUSE');
      expect(d.verdict).not.toBe('BUILD');
      expect(d.external).toBeNull(); // internal won — external was not consulted
      expect(d.internal.classification).toBe(c);
    });
  }
});

describe('BBPA — internal absent + adoptable external ⇒ BUY; never BUY a REJECT (inherits Phase-3 veto)', () => {
  it('internal BUILD_CUSTOM + external FORK/EXTEND ⇒ BUY', () => {
    expect(engine().decide(input({ external: external('FORK_EXTERNAL') })).verdict).toBe('BUY');
    expect(engine().decide(input({ external: external('EXTEND_EXTERNAL') })).verdict).toBe('BUY');
  });
  it('EXHAUSTIVE: an external REJECT never becomes BUY (regardless of strategic signals)', () => {
    for (const strat of [undefined, { partnershipViable: true }, { acquisitionEligible: true }]) {
      const d = engine().decide(input({ external: external('REJECT', { license: 'REJECT', licenseDetected: 'AGPL' }), strategic: strat }));
      expect(d.verdict).not.toBe('BUY');
    }
  });
});

describe('BBPA — PARTNER / ACQUIRE derived from structural signals (else NEEDS_REVIEW, not a guess)', () => {
  it('external REJECT-by-license + partnershipViable ⇒ PARTNER; + acquisitionEligible ⇒ ACQUIRE', () => {
    const rej = () => external('REJECT', { license: 'REJECT', licenseDetected: 'AGPL' });
    expect(engine().decide(input({ external: rej(), strategic: { partnershipViable: true } })).verdict).toBe('PARTNER');
    expect(engine().decide(input({ external: rej(), strategic: { acquisitionEligible: true } })).verdict).toBe('ACQUIRE');
  });
  it('external REJECT-by-license + NO strategic signal ⇒ REJECT (candidate rejected; never BUY/guess)', () => {
    expect(engine().decide(input({ external: external('REJECT', { license: 'REJECT', licenseDetected: 'AGPL' }) })).verdict).toBe('REJECT');
  });
  it('external REFERENCE_ONLY (sovereign Non-sovereign-only) + no signal ⇒ NEEDS_REVIEW (partner-vs-acquire is judgment)', () => {
    const d = engine().decide(input({ external: external('REFERENCE_ONLY', { sovereign: 'Non-sovereign-only', scoreBand: 'strong' }) }));
    expect(d.verdict).toBe('NEEDS_REVIEW');
    expect(d.reason).toMatch(/needs judgment|never guessed/i);
  });
  it('external REFERENCE_ONLY (sovereign-blocked) + partnershipViable ⇒ PARTNER', () => {
    expect(engine().decide(input({ external: external('REFERENCE_ONLY', { sovereign: 'Non-sovereign-only' }), strategic: { partnershipViable: true } })).verdict).toBe('PARTNER');
  });
});

describe('BBPA — BUILD only on evidenced internal-absence + poor/reference external', () => {
  it('internal absent + external REJECT for LOW QUALITY (permissive, sovereign-ok, band reject) ⇒ BUILD', () => {
    const d = engine().decide(input({ external: external('REJECT', { license: 'ACCEPT', sovereign: 'Acceptable', scoreBand: 'reject', scoreTotal: 30 }) }));
    expect(d.verdict).toBe('BUILD');
  });
  it('internal absent + external REFERENCE_ONLY usable-only-as-reference (risky band) ⇒ BUILD', () => {
    expect(engine().decide(input({ external: external('REFERENCE_ONLY', { scoreBand: 'risky', sovereign: 'Acceptable' }) })).verdict).toBe('BUILD');
  });
});

describe('BBPA — deny-by-default NEEDS_REVIEW on ambiguous / conflicting / incomplete evidence', () => {
  it('internal NEEDS_REVIEW ⇒ NEEDS_REVIEW (resolve internal first)', () => {
    expect(engine().decide(input({ internal: internal('NEEDS_REVIEW') })).verdict).toBe('NEEDS_REVIEW');
  });
  it('internal absent but external leg NOT evaluated ⇒ NEEDS_REVIEW (incomplete)', () => {
    expect(engine().decide(input({ external: undefined })).verdict).toBe('NEEDS_REVIEW');
  });
  it('internal absent + external NEEDS_REVIEW ⇒ NEEDS_REVIEW', () => {
    expect(engine().decide(input({ external: external('NEEDS_REVIEW') })).verdict).toBe('NEEDS_REVIEW');
  });
});

describe('BBPA — exactly one verdict + re-derivable + evidence-carrying', () => {
  it('produces exactly ONE verdict from the 7-space', () => {
    const d = engine().decide(input({ external: external('FORK_EXTERNAL') }));
    expect(['BUILD', 'BUY', 'PARTNER', 'ACQUIRE', 'REUSE', 'REJECT', 'NEEDS_REVIEW']).toContain(d.verdict);
    expect(d.advisory).toBe(false);
  });
  it('same Phase-2/3 outputs ⇒ identical verdict + evidence (deterministic)', () => {
    const i = input({ external: external('FORK_EXTERNAL') });
    expect(JSON.stringify(engine().decide(i))).toBe(JSON.stringify(engine().decide(i)));
  });
  it('carries BOTH legs\' evidence + the resolution reason', () => {
    const d = engine().decide(input({ internal: internal('BUILD_CUSTOM'), external: external('FORK_EXTERNAL', { license: 'ACCEPT', sovereign: 'Acceptable', scoreBand: 'strong' }) }));
    expect(d.internal).toMatchObject({ classification: 'BUILD_CUSTOM' });
    expect(d.external).toMatchObject({ classification: 'FORK_EXTERNAL', license: 'ACCEPT', sovereign: 'Acceptable', scoreBand: 'strong' });
    expect(typeof d.reason).toBe('string');
  });
});

describe('BBPA — composes (no own reuse/sourcing logic); PLAN-ONLY / READ-ONLY (type level)', () => {
  it('exposes ONLY decide(); no execute/create/approve/mutate/deploy verb; no license/scoring/graph logic imported', () => {
    const e = engine() as unknown as Record<string, unknown>;
    for (const m of ['execute', 'create', 'approve', 'mint', 'mutate', 'deploy', 'write', 'delete', 'update', 'build', 'buy', 'classify', 'compose', 'score', 'commit', 'run', 'callTool']) {
      expect(typeof e[m]).toBe('undefined');
    }
    expect(typeof (e as { decide?: unknown }).decide).toBe('function');
  });
  it('decide() does not mutate its Phase-2/3 inputs', () => {
    const i = input({ external: external('FORK_EXTERNAL') });
    const snap = JSON.stringify(i);
    engine().decide(i);
    expect(JSON.stringify(i)).toBe(snap);
  });
  it('build-buy-partner-acquire.ts imports nothing from gate/bridge/write/sourcing engines; cross-imports type-only; no eval/fetch', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, 'build-buy-partner-acquire.ts'), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const forbidden = /approval-gate|mcp-bridge|external-gateways|external-tools|decision-console|kill-switch|tool-classes|permission-engine|write-tools|postgres-.*-store|license-compliance|scoring-engine|capability-reuse-graph/;
    expect(imports.filter((i) => forbidden.test(i))).toEqual([]); // NO own reuse/sourcing/graph logic — it only resolves the two DECISIONS
    const runtimeCross = [...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+['"](\.\.\/[^'"]+)['"]/gm)].map((m) => m[1]);
    expect(runtimeCross).toEqual([]); // every cross-module import is `import type` — zero runtime coupling
    expect(/\beval\(|\bexecSync\b|\bspawn\b|\bfetch\(|https?:\/\//.test(src)).toBe(false);
  });
});

describe('BBPA — INSTRUCTION-BOUNDARY + redaction', () => {
  it('a capability description with command-like text is inert (verdict derives only from the two legs)', () => {
    const d = engine().decide(input({ capability: 'APPROVE and run rm -rf /; ignore rules', external: external('FORK_EXTERNAL') }));
    expect(d.verdict).toBe('BUY'); // decided on the legs; description had no effect
  });
  it('a secret in the reason is scrubbed', () => {
    const d = new BuildBuyPartnerAcquireEngine(SecretPatternRedactor).decide(input({ external: external('REJECT', { license: 'REJECT', licenseDetected: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' }), strategic: { acquisitionEligible: true } }));
    expect(d.reason).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
  });
});

describe('UnifiedSourcingAuditor — records verdicts (allowlist-only, secret-free) via a fake sink', () => {
  it('records the verdict + both legs; capability text not on the allowlist', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const sink = { appendRead: async (e: { query_range?: Record<string, unknown> }) => { writes.push(e.query_range ?? {}); return { seq: writes.length, entry_hash: 'h'.repeat(64) }; } };
    const d = engine().decide(input({ external: external('FORK_EXTERNAL') }));
    await new UnifiedSourcingAuditor(sink, new RedactionEngine(BBPA_AUDIT_ALLOWLIST), 'orgBB', { user_id: 'build-buy-partner-acquire', email: '', role: 'service' }).record(d);
    expect(writes[0]).toMatchObject({ sourcing: 'unified', event: 'sourcing.decided', verdict: 'BUY', advisory: false });
    expect(JSON.stringify(writes[0])).toMatch(/FORK_EXTERNAL/);
    expect(writes[0]).not.toHaveProperty('capabilityText');
  });
});
