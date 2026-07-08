// Build Planner (Layer-4 Slice 1) — tests.
//
// Proves: it CONSUMES a real approved-decision shape (a genuine SubDomainResult, not a re-derivation); emits a
// complete inert BuildPlan for the docassemble FORK; feeds the gated filesystem dry-run adapter and gets an
// inert PlannedFilesystemWrite; REQUIRES a real gate-minted approval to reach the adapter (no approval ⇒ fail
// closed); requires an ApprovedBuildDecision (a raw SubDomainResult is rejected); mints NOTHING and imports no
// node:fs (by source inspection); and is deterministic for the same decision.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalGate } from '../../layer-1-law/approval-gate/approval-gate.js';
// TEST-ONLY: to obtain a GENUINE ConsumedApproval we drive the REAL gate + dispatcher. The build-planner source
// itself does none of this — that is asserted by inspection below.
import { BridgeApprovalGate, ClassDispatcher, canonicalPayload, type ConsumedApproval } from '../../layer-5-action/mcp-bridge/tool-classes.js';
import {
  FilesystemAdapterDryRun,
  scaffoldPayload,
  SANDBOX_PATH_PREFIX,
  type FilesystemScaffoldIntentDryRun,
} from '../../layer-5-action/filesystem-adapter-dryrun/filesystem-adapter-dryrun.js';
import type { GovernedAuditRecorder, ScopedCredentialRef } from '../../layer-5-action/governed-adapter/governed-adapter.js';
import type { SubDomainResult, GradedCandidate } from '../../layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import {
  planBuild,
  buildPlanFor,
  toScaffoldIntent,
  sandboxBasePathFor,
  type ApprovedBuildDecision,
  type ScaffoldGrant,
} from './build-planner.js';

const CRED: ScopedCredentialRef = { ref: 'sandbox-filesystem-credential-handle', scopes: ['fs:sandbox'] };

function silentAudit(): GovernedAuditRecorder {
  return { appendIntent() {}, appendResult() {}, appendRefusal() {} };
}

// ── A GENUINE docassemble FORK decision (a real SubDomainResult, not a re-derivation) ─────────────────────
function docassembleSpine(): GradedCandidate {
  return {
    repoUrl: 'https://github.com/jhpyle/docassemble',
    identity: { host: 'github.com', owner: 'jhpyle', name: 'docassemble' },
    record: {
      evaluatedAtIso: '2026-07-07T00:00:00.000Z',
      identity: { host: 'github.com', owner: 'jhpyle', name: 'docassemble' },
      licenseDetected: 'MIT',
      licenseDecision: 'ACCEPT',
      eligibility: 'eligible',
      provenanceVerified: true,
      maturity: { stars: 800, lastCommitIso: '2026-06-01T00:00:00.000Z', contributors: 60 },
      airGapSuitability: 'yes',
      whiteLabelFit: 'moderate',
      architectureFitNotes: 'Python document-assembly platform; wrappable under a fork seam.',
      priorVerdict: 'FORK',
      readme: null,
      description: 'A free, open-source expert system for guided interviews and document assembly.',
      status: 'recorded',
    },
    score: {
      subScores: [{ dimension: 'license', score: 20, max: 20, evidence: 'MIT on allowlist', flagged: false }],
      total: 78,
      rejected: false,
      band: 'acceptable',
      flags: [],
    },
    licenseOneLine: 'Permission is hereby granted, free of charge, to any person obtaining a copy...',
    licenseVerified: true,
    licenseDisagreement: false,
    rawLicenseText: 'MIT License\n\nPermission is hereby granted...',
    notes: [],
    enrichment: {
      applied: false,
      status: 'NONE',
      totalBefore: 78,
      totalAfter: 78,
      bandBefore: 'acceptable',
      bandAfter: 'acceptable',
      dimensions: [],
    },
  };
}

function docassembleDecision(): SubDomainResult {
  const spine = docassembleSpine();
  return {
    subDomain: { key: 'document-assembly', title: 'Document Assembly & Generation', query: 'document assembly generation legal' },
    candidates: [spine],
    spine,
    decision: 'FORK',
    decisionEvidence: ['spine: jhpyle/docassemble — real score 78/100, band "acceptable"', 'score ≥ 70 (acceptable/strong) — fork and white-label'],
  };
}

// ── A GENUINE gate-minted ConsumedApproval (proves the seam token cannot be fabricated) ───────────────────
async function realConsumedApproval(approver = 'alice', caller = 'orchestrator-agent'): Promise<ConsumedApproval> {
  const gate = new ApprovalGate();
  const binding = { tool: 'approve_build_decision', target: 'legal-contract-ops/document-assembly', payloadJson: canonicalPayload({ decision: 'FORK' }) };
  const actionId = gate.request({
    tool: binding.tool, target: binding.target, after: { decision: 'FORK' },
    risk: 'high', reversible: 'no', requestedBy: { user_id: caller },
  }).actionId;
  gate.resolve({ actionId, approver: { user_id: approver, role: 'admin' }, decision: 'APPROVE', reason: 'build decision approved' });
  const dispatcher = new ClassDispatcher(new BridgeApprovalGate(gate, caller));
  let token: ConsumedApproval | undefined;
  await dispatcher.dispatch<never, never, ConsumedApproval>(
    'APPROVAL_REQUIRED_WRITE',
    { approvalWrite: async (a) => { token = a; return a; } },
    { approvalActionId: actionId, approvalBinding: binding, tool: binding.tool },
  );
  if (!token) throw new Error('failed to obtain a real ConsumedApproval');
  return token;
}

async function approvedBuildDecision(decision: SubDomainResult = docassembleDecision()): Promise<ApprovedBuildDecision> {
  return {
    decision,
    approval: await realConsumedApproval(),
    approvedBy: 'alice',
    sourceReport: { domain: 'Legal & Contract Ops', generatedAtIso: '2026-07-07T12:00:00.000Z' },
  };
}

// A gate grant for the SEPARATE scaffold write. Mirrors the filesystem-adapter harness exactly.
function scaffoldGrant(intent: FilesystemScaffoldIntentDryRun, opts: { approve: boolean }): ScaffoldGrant {
  const gate = new ApprovalGate();
  let actionId = 'no-such-action';
  if (opts.approve) {
    const b = new FilesystemAdapterDryRun(CRED).intentBinding(intent);
    actionId = gate.request({
      tool: b.tool, target: b.target, after: scaffoldPayload(intent),
      risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' },
    }).actionId;
    gate.resolve({ actionId, approver: { user_id: 'alice', role: 'admin' }, decision: 'APPROVE', reason: 'sandbox scaffold approved' });
  }
  return {
    approvalActionId: actionId, gate, caller: 'orchestrator-agent', audit: silentAudit(),
    human: { user_id: 'alice', email: 'alice@example.com', role: 'admin' },
    organizationId: 'org_1', environment: 'local',
  };
}

async function fullInput(opts: { approveScaffold: boolean }) {
  const approved = await approvedBuildDecision();
  const plan = buildPlanFor(approved);
  const intent = toScaffoldIntent(plan, 'Legal & Contract Ops/document-assembly');
  return { approved, scaffoldGrant: scaffoldGrant(intent, { approve: opts.approveScaffold }), credential: CRED };
}

describe('build-planner — consumes an approved decision, does not re-decide', () => {
  it('reads the SubDomainResult fields as given (mirrors spine identity/license/score — no re-derivation)', async () => {
    const approved = await approvedBuildDecision();
    const plan = buildPlanFor(approved);
    expect(plan.forDecision.sourcing).toBe('FORK');
    expect(plan.forDecision.subDomainKey).toBe('document-assembly');
    expect(plan.forDecision.approvedBy).toBe('alice');
    expect(plan.forkTarget).toMatchObject({
      host: 'github.com', owner: 'jhpyle', name: 'docassemble',
      repoUrl: 'https://github.com/jhpyle/docassemble',
      license: { detected: 'MIT', decision: 'ACCEPT' },
      score: { total: 78, band: 'acceptable' },
    });
    // The one-line license is quoted straight from the decision — not re-classified here.
    expect(plan.forkTarget.license.oneLine).toBe(docassembleSpine().licenseOneLine);
  });

  it('refuses a non-FORK decision and a null spine (the planner never manufactures a decision)', async () => {
    const approved = await approvedBuildDecision({ ...docassembleDecision(), decision: 'EXTEND' });
    expect(() => buildPlanFor(approved)).toThrow(/FORK decisions only/);
    const nullSpine = await approvedBuildDecision({ ...docassembleDecision(), spine: null });
    expect(() => buildPlanFor(nullSpine)).toThrow(/non-null spine/);
  });
});

describe('build-planner — emits a complete inert BuildPlan for the docassemble fork', () => {
  it('has every section, honest fidelity flags, and a sandbox path', async () => {
    const plan = buildPlanFor(await approvedBuildDecision());
    expect(plan.kind).toBe('build-plan');
    expect(plan.sandbox.basePath.startsWith(SANDBOX_PATH_PREFIX)).toBe(true);
    expect(plan.sandbox.basePath).toBe('/tmp/ece-dryrun-docassemble-jhpyle-docassemble');

    expect(plan.productStructure.fidelity).toBe('real-plan');
    expect(plan.forkIntegration.fidelity).toBe('real-plan');
    expect(plan.sourceOfTruthDocs.fidelity).toBe('real-plan');
    expect(plan.packagingManifest.fidelity).toBe('real-plan');
    expect(plan.featureRegistryStub.fidelity).toBe('placeholder');
    expect(plan.hardening.fidelity).toBe('placeholder');

    // The skeleton is a real plan and includes the fork seam, the (placeholder) Arabic-first + branding steps.
    const paths = plan.productStructure.value.map((n) => n.path);
    expect(paths).toContain('src/fork');
    expect(paths).toContain('src/i18n/ar.placeholder.json');
    expect(paths).toContain('branding/PLACEHOLDER.md');
    expect(paths).toContain('feature-registry.stub.json');

    // The plan is explicit about what is real vs placeholder.
    expect(plan.honesty.realPlan).toContain('product structure / scaffold skeleton');
    expect(plan.honesty.placeholder).toContain('Arabic-first i18n layer (planned step, not generated)');
    expect(plan.honesty.placeholder).toContain('fork mechanics (notes only — no repo fork performed)');
  });
});

describe('build-planner — feeds the gated filesystem dry-run adapter', () => {
  it('APPROVED scaffold ⇒ an inert PlannedFilesystemWrite whose tree matches the plan', async () => {
    const input = await fullInput({ approveScaffold: true });
    const out = await planBuild(input);

    expect(out.scaffold.ok).toBe(true);
    if (!out.scaffold.ok) throw new Error('unreachable');
    const p = out.scaffold.planned;
    expect(p.dryRun).toBe(true);
    expect(p.plannedOnly).toBe(true);
    expect(p.api).toBe('filesystem');
    expect(p.basePath).toBe('/tmp/ece-dryrun-docassemble-jhpyle-docassemble');
    // The planned tree is exactly the BuildPlan's product skeleton.
    const expectedEntries = input.approved && toScaffoldIntent(buildPlanFor(input.approved), 'Legal & Contract Ops/document-assembly').entries;
    expect(p.entries).toEqual(expectedEntries);
    expect(p.boundToApprovalId).toBe(out.scaffold.approvalId);
  });

  it('NO scaffold approval ⇒ fail closed: STOP_FOR_APPROVAL, NO plan reaches the adapter', async () => {
    const input = await fullInput({ approveScaffold: false });
    const out = await planBuild(input);
    expect(out.scaffold.ok).toBe(false);
    if (out.scaffold.ok) throw new Error('unreachable');
    expect(out.scaffold.status).toBe('STOP_FOR_APPROVAL');
    expect(out.scaffold.planned).toBeNull();
    // The BuildPlan is still emitted (pure data); only the gated scaffold is withheld.
    expect(out.buildPlan.kind).toBe('build-plan');
  });
});

describe('build-planner — requires an ApprovedBuildDecision (cannot be handed a raw decision)', () => {
  it('a raw SubDomainResult does not satisfy ApprovedBuildDecision (type-level rejection)', () => {
    const raw: SubDomainResult = docassembleDecision();
    // @ts-expect-error — a raw SubDomainResult is NOT an ApprovedBuildDecision (no unforgeable `approval`).
    const bad: ApprovedBuildDecision = raw;
    void bad;
  });

  it('forcing a raw decision through (via cast) is rejected at runtime too', () => {
    const raw = docassembleDecision();
    expect(() => buildPlanFor(raw as unknown as ApprovedBuildDecision)).toThrow();
  });
});

describe('build-planner — deterministic for the same decision', () => {
  it('buildPlanFor is a pure function (same input ⇒ deep-equal plan)', async () => {
    const approved = await approvedBuildDecision();
    expect(buildPlanFor(approved)).toEqual(buildPlanFor(approved));
    expect(sandboxBasePathFor(docassembleSpine())).toBe(sandboxBasePathFor(docassembleSpine()));
  });

  it('planBuild yields the same planned tree across runs (same decision)', async () => {
    const a = await planBuild(await fullInput({ approveScaffold: true }));
    const b = await planBuild(await fullInput({ approveScaffold: true }));
    expect(a.scaffold.ok && b.scaffold.ok).toBe(true);
    if (!a.scaffold.ok || !b.scaffold.ok) throw new Error('unreachable');
    expect(a.scaffold.planned.entries).toEqual(b.scaffold.planned.entries);
  });
});

describe('build-planner — mints NOTHING and touches NO filesystem (source inspection)', () => {
  const RAW = readFileSync(join(__dirname, 'build-planner.ts'), 'utf8');
  // Strip comments so prose naming the very things it avoids cannot false-positive.
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('imports NO node:fs (nor fs, nor node:fs/promises) — none at all', () => {
    expect(/from\s*['"]node:fs['"]/.test(SRC)).toBe(false);
    expect(/from\s*['"]node:fs\/promises['"]/.test(SRC)).toBe(false);
    expect(/from\s*['"]fs['"]/.test(SRC)).toBe(false);
    expect(/from\s*['"]fs\/promises['"]/.test(SRC)).toBe(false);
    expect(/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/.test(SRC)).toBe(false);
  });

  it('contains NO real filesystem-write call — it delegates to the incapable, gated adapter', () => {
    for (const re of [/\bwriteFile\s*\(/, /\bmkdir\s*\(/, /\brm\s*\(/, /\brmdir\s*\(/, /\bappendFile\s*\(/, /\bcreateWriteStream\s*\(/]) {
      expect({ p: String(re), hit: re.test(SRC) }).toEqual({ p: String(re), hit: false });
    }
  });

  it('mints NO approval: no mint import/call, and depends on the CONTRACT not the transport', () => {
    expect(/mintConsumedApproval/.test(SRC)).toBe(false);
    expect(/from\s*['"][^'"]*mcp-bridge\//.test(SRC)).toBe(false); // never the transport module
    expect(/as\s+ConsumedApproval/.test(SRC)).toBe(false); // no cast to forge a token
    expect(/from\s*['"][^'"]*governed-adapter\/governed-adapter\.js['"]/.test(SRC)).toBe(true);
  });
});
