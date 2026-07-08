// Governed Adapter CONTRACT tests — proven with a GitHub-AGNOSTIC fake adapter, so these assert the SHARED
// governance (gating / write-ahead audit / attribution / intent-binding / fail-closed), independent of GitHub.
// NO network exists in this module; these are pure in-process checks.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalGate } from '../../layer-1-law/approval-gate/approval-gate.js';
import {
  GovernedAdapter,
  canonicalPayload,
  boundIntentHash,
  PLANNED_ONLY_NOTE,
  type PlannedWrite,
  type ConsumedApproval,
  type ApprovalBinding,
  type ScopedCredentialRef,
  type GovernedWriteContext,
  type GovernedAuditRecorder,
  type GovernedAuditIntent,
  type GovernedAuditResult,
  type GovernedAuditRefusal,
} from './governed-adapter.js';

// ── A minimal, GitHub-agnostic implementation used ONLY to exercise the contract's shared semantics. ──
interface NoopIntent { readonly name: string; readonly value: string }
interface NoopPlan extends PlannedWrite { readonly echoed: string }
const NOOP_TOOL = 'noop_write_dryrun';

class NoopAdapter extends GovernedAdapter<NoopIntent, NoopPlan> {
  intentBinding(intent: NoopIntent): ApprovalBinding {
    return { tool: NOOP_TOOL, target: intent.name, payloadJson: canonicalPayload({ value: intent.value }) };
  }
  protected shapePlan(intent: NoopIntent, approval: ConsumedApproval, hash: string): NoopPlan {
    return {
      dryRun: true, plannedOnly: true,
      boundIntentHash: hash, boundToApprovalId: approval.approvalId,
      note: PLANNED_ONLY_NOTE, echoed: intent.value,
    };
  }
}

const CRED: ScopedCredentialRef = { ref: 'sandbox-credential-handle', scopes: ['noop'] };
const INTENT: NoopIntent = { name: 'sandbox-thing', value: 'v1' };

function recordingAudit() {
  const events: string[] = [];
  const intents: GovernedAuditIntent[] = [];
  const results: GovernedAuditResult[] = [];
  const refusals: GovernedAuditRefusal[] = [];
  const rec: GovernedAuditRecorder = {
    appendIntent(e) { events.push('intent'); intents.push(e); },
    appendResult(e) { events.push('result'); results.push(e); },
    appendRefusal(e) { events.push('refusal'); refusals.push(e); },
  };
  return { rec, events, intents, results, refusals };
}

function requestNoop(gate: ApprovalGate, intent: NoopIntent = INTENT): string {
  const b = new NoopAdapter(CRED).intentBinding(intent);
  return gate.request({
    tool: b.tool, target: b.target, after: { value: intent.value },
    risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' },
  }).actionId;
}

function ctxFor(
  gate: ApprovalGate, approvalActionId: string, rec: GovernedAuditRecorder,
  over: Partial<GovernedWriteContext<NoopIntent>> = {},
): GovernedWriteContext<NoopIntent> {
  return {
    intent: INTENT, approvalActionId, gate, caller: 'orchestrator-agent', audit: rec,
    human: { user_id: 'alice', email: 'alice@example.com', role: 'admin' },
    organizationId: 'org_1', environment: 'local', ...over,
  };
}

describe('GovernedAdapter contract — shared governance (GitHub-agnostic)', () => {
  it('FAIL CLOSED: no approval ⇒ no plan, refusal audited, no intent/result audit', async () => {
    const gate = new ApprovalGate();
    const actionId = requestNoop(gate); // requested but NEVER approved
    const { rec, events } = recordingAudit();
    const out = await new NoopAdapter(CRED).planWrite(ctxFor(gate, actionId, rec));
    expect(out.ok).toBe(false);
    expect(out.planned).toBeNull();
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(events).toEqual(['refusal']);
  });

  it('FAIL CLOSED: unknown action id ⇒ no plan, refusal audited', async () => {
    const gate = new ApprovalGate();
    const { rec, events } = recordingAudit();
    const out = await new NoopAdapter(CRED).planWrite(ctxFor(gate, 'act_missing', rec));
    expect(out.ok).toBe(false);
    expect(out.planned).toBeNull();
    expect(events).toEqual(['refusal']);
  });

  it('APPROVED: audit BEFORE plan (write-ahead); plan inert; attribution is the real human; hash recorded', async () => {
    const gate = new ApprovalGate();
    const actionId = requestNoop(gate);
    gate.resolve({ actionId, approver: { user_id: 'alice', role: 'admin' }, decision: 'APPROVE', reason: 'sandbox dry-run approved' });
    const { rec, events, intents, results } = recordingAudit();
    const out = await new NoopAdapter(CRED).planWrite(ctxFor(gate, actionId, rec));

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(events).toEqual(['intent', 'result']); // write-ahead ordering (plan built strictly between)
    expect(out.planned.dryRun).toBe(true);
    expect(out.planned.plannedOnly).toBe(true);
    expect(out.planned.echoed).toBe('v1');
    expect(out.planned.boundToApprovalId).toBe(out.approvalId);
    // intent-binding fingerprint is surfaced AND recorded in the write-ahead audit.
    expect(out.planned.boundIntentHash).toBe(out.boundIntentHash);
    expect(intents[0].request_summary.boundIntentHash).toBe(out.boundIntentHash);
    // real human attribution — never "claude".
    expect(out.approvedBy).toBe('alice');
    expect(intents[0].approval).toEqual({ required: true, captured: true, approved_by: 'alice' });
    expect(intents[0].human_actor.user_id).not.toBe('claude');
    expect(results[0].plannedOnly).toBe(true);
  });

  it('AUDIT-BEFORE-PLAN: if the write-ahead audit throws, NO plan is produced', async () => {
    const gate = new ApprovalGate();
    const actionId = requestNoop(gate);
    gate.resolve({ actionId, approver: { user_id: 'alice' }, decision: 'APPROVE', reason: 'approved' });
    const events: string[] = [];
    const rec: GovernedAuditRecorder = {
      appendIntent() { events.push('intent'); throw new Error('audit sink unavailable'); },
      appendResult() { events.push('result'); },
      appendRefusal() { events.push('refusal'); },
    };
    const out = await new NoopAdapter(CRED).planWrite(ctxFor(gate, actionId, rec));
    expect(out.ok).toBe(false);
    expect(out.planned).toBeNull();
    expect(events).toEqual(['intent', 'refusal']); // intent attempted+failed, plan never built
  });

  it('SELF-APPROVAL IMPOSSIBLE: approver == caller ⇒ no plan', async () => {
    const gate = new ApprovalGate();
    const actionId = requestNoop(gate);
    gate.resolve({ actionId, approver: { user_id: 'alice' }, decision: 'APPROVE', reason: 'approved' });
    const { rec, events } = recordingAudit();
    const out = await new NoopAdapter(CRED).planWrite(ctxFor(gate, actionId, rec, { caller: 'alice' }));
    expect(out.ok).toBe(false);
    expect(out.planned).toBeNull();
    expect(events).toEqual(['refusal']);
  });

  it('SELF-APPROVAL IMPOSSIBLE: a "claude" approver is rejected by the gate ⇒ no plan', async () => {
    const gate = new ApprovalGate();
    const actionId = requestNoop(gate);
    const bad = gate.resolve({ actionId, approver: { user_id: 'claude' }, decision: 'APPROVE', reason: 'nope' });
    expect(bad.ok).toBe(false);
    const { rec } = recordingAudit();
    const out = await new NoopAdapter(CRED).planWrite(ctxFor(gate, actionId, rec));
    expect(out.ok).toBe(false);
    expect(out.planned).toBeNull();
  });

  it('INTENT-BINDING: an approval bound to a different payload does not authorize this plan', async () => {
    const gate = new ApprovalGate();
    const actionId = gate.request({
      tool: NOOP_TOOL, target: 'sandbox-thing', after: { value: 'DIFFERENT' }, // ≠ INTENT.value
      risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' },
    }).actionId;
    gate.resolve({ actionId, approver: { user_id: 'alice' }, decision: 'APPROVE', reason: 'approved for a different intent' });
    const { rec, events } = recordingAudit();
    const out = await new NoopAdapter(CRED).planWrite(ctxFor(gate, actionId, rec));
    expect(out.ok).toBe(false);
    expect(out.planned).toBeNull();
    expect(events).toEqual(['refusal']);
  });

  it('boundIntentHash is deterministic and intent-sensitive (the reusable primitive)', () => {
    const a = new NoopAdapter(CRED).intentBinding({ name: 'x', value: '1' });
    const a2 = new NoopAdapter(CRED).intentBinding({ name: 'x', value: '1' });
    const b = new NoopAdapter(CRED).intentBinding({ name: 'x', value: '2' });
    expect(boundIntentHash(a)).toBe(boundIntentHash(a2)); // same intent → same hash
    expect(boundIntentHash(a)).not.toBe(boundIntentHash(b)); // different intent → different hash
    expect(boundIntentHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('GovernedAdapter contract — NO real write path, mints nothing (source inspection)', () => {
  const RAW = readFileSync(join(__dirname, 'governed-adapter.ts'), 'utf8');
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const REAL_WRITE_CALLS = [
    /\bfetch\s*\(/, /\baxios\b/, /XMLHttpRequest/, /from\s+['"]node:https?['"]/, /from\s+['"]https?['"]/,
    /\.request\s*\(/, /octokit/i, /createGithubRepo\s*\(/, /openPullRequest\s*\(/,
  ];
  it('the contract contains NO real-write call and NO execute() method', () => {
    for (const re of REAL_WRITE_CALLS) {
      expect({ pattern: String(re), hit: re.test(SRC) }).toEqual({ pattern: String(re), hit: false });
    }
    expect(/\bexecute\s*\(/.test(SRC)).toBe(false); // no mutating execute — only planWrite (inert)
  });
  it('the contract NEVER mints a token — it only CONSUMES the real bridge gate', () => {
    expect(/mintConsumedApproval/.test(SRC)).toBe(false);
    expect(/mintExternalCapability/.test(SRC)).toBe(false);
    expect(/from\s*['"]\.\.\/mcp-bridge\/tool-classes\.js['"]/.test(SRC)).toBe(true);
    expect(/type ConsumedApproval/.test(SRC)).toBe(true);
  });
  it('the write-capable call is type-gated: shapePlan requires a ConsumedApproval', () => {
    expect(/shapePlan\s*\([^)]*approval:\s*ConsumedApproval[^)]*\)/s.test(SRC)).toBe(true);
  });
});
