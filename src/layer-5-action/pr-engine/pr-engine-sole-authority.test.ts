import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrEngine, type PrEngineBridge, type PrRequest, type PrOpener, type PrOpenOutcome } from './pr-engine.js';
import { McpBridge, type BridgeCallContext, type OpenPrCapability } from '../mcp-bridge/mcp-bridge.js';
import { createDefaultToolRegistry } from '../tool-registry/tool-registry.js';
import { registerExternalTools, type ExternalSystems, type ExternalTarget } from '../mcp-bridge/external-tools.js';
import { AllowAllAuthorizer } from '../../factory-shared/audit-engine/sequencer.js';
import type { AuditSink, AppendResult } from '../../factory-shared/audit-engine/sink.js';
import { WriteAheadSequencer } from '../../factory-shared/audit-engine/sequencer.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';

// Phase 8.8b — PR-Engine SOLE AUTHORITY is STRUCTURAL (not convention). Two proofs:
//   (1) the only path to open_pull_request is the capability-gated bridge.openPullRequest — the generic
//       external path REFUSES it, and an OpenPrCapability cannot be forged outside the bridge module.
//   (2) a boundary check over src/ proving exactly ONE module assembles/opens a PR: the PR Engine.

// minimal in-memory sink so the real McpBridge runs without a DB for the encapsulation check
class MemSink implements AuditSink {
  private seq = 0;
  async appendIntent(): Promise<AppendResult & { intent_id: string }> { const s = ++this.seq; return { intent_id: `i${s}`, seq: s, entry_hash: `h${s}` }; }
  async appendResult(): Promise<AppendResult> { return { seq: this.seq, entry_hash: `r${this.seq}` }; }
  async appendRead(): Promise<AppendResult> { return { seq: ++this.seq, entry_hash: 'x' }; }
  async appendRefusal(): Promise<AppendResult> { return { seq: ++this.seq, entry_hash: 'x' }; }
  async verifyChain(): Promise<never> { throw new Error('n/a'); }
  async readEntries(): Promise<never[]> { return []; }
  async orphanedIntents(): Promise<never[]> { return []; }
  proof(): null { return null; }
}
class XFakes implements ExternalSystems {
  opened = 0;
  async openPullRequest(_t: ExternalTarget): Promise<{ ok: true }> { this.opened++; return { ok: true }; }
  private nope = async (): Promise<never> => { throw new Error('not used'); };
  createGithubRepo = this.nope; createTicket = this.nope; updateCrmRecord = this.nope; sendEmail = this.nope; deployPackage = this.nope; createMilestone = this.nope; createLabel = this.nope; createIssueBatch = this.nope;
}
function ctx(): BridgeCallContext {
  return { principal: { user_id: 'op', email: 'o@e', role: 'operator' }, organization_id: 'orgSA', session: { session_id: 's' }, environment: 'local', via: 'claude-code' };
}
function realBridge() {
  const reg = createDefaultToolRegistry();
  registerExternalTools(reg);
  const x = new XFakes();
  const bridge = new McpBridge(reg, new WriteAheadSequencer(new MemSink(), new AllowAllAuthorizer()), { searchClients: async () => [] }, new RedactionEngine(['ok']), { externalSystems: x });
  return { bridge, x };
}

describe('PR Engine sole-authority — the generic external path cannot open a PR (encapsulated)', () => {
  it('externalActionWithTool("open_pull_request") ⇒ refused (encapsulated); the external port is never reached', async () => {
    const { bridge, x } = realBridge();
    const out = await bridge.externalActionWithTool('open_pull_request', ctx(), { target: { system: 'github', targetId: 'ECE-FACTORY/x#a->b', effect: 'open', reversible: 'soft-only' } });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('encapsulated');
    expect(x.opened).toBe(0); // the open port was never called via the generic path
  });
});

describe('PR Engine sole-authority — the OpenPrCapability is unforgeable (type-level)', () => {
  it('an OpenPrCapability cannot be constructed outside the bridge module, and openPullRequest requires it', () => {
    const { bridge } = realBridge();
    // @ts-expect-error OpenPrCapability is branded with a module-private symbol — uncostructible here
    const forged: OpenPrCapability = {};
    void forged;
    // @ts-expect-error openPullRequest REQUIRES the capability as the first argument — there is no capability-less overload
    void bridge.openPullRequest(ctx(), {});
    // the legitimate path: the capability is obtained only from the bridge's grant (held by the PR Engine).
    expect(typeof bridge.grantPrOpenCapability).toBe('function');
  });
});

describe('PR Engine sole-authority — a consumer can open ONLY by routing a PrRequest through the PR Engine', () => {
  it('a module holding just a PrOpener + PrRequest can open; it has no bridge/capability of its own', async () => {
    // a "consumer module" that depends ONLY on the typed seam — no bridge, no capability, no external port
    async function consumerModuleWantsAPr(opener: PrOpener, request: PrRequest, c: BridgeCallContext): Promise<PrOpenOutcome> {
      return opener.openPr(request, c); // the ONLY thing it can do — it cannot reach open_pull_request itself
    }
    class FakeBridge implements PrEngineBridge {
      opened = 0;
      async draftWithTool() { return { status: 'DRAFT-AWAITING-HUMAN-REVIEW' as const, tool: 'draft_repo_plan' as const, draft: {}, auditSeq: 1 }; }
      grantPrOpenCapability(): OpenPrCapability { return {} as unknown as OpenPrCapability; }
      async openPullRequest() { this.opened++; return { status: 'EXTERNAL-ACTION-COMMITTED' as const, tool: 'open_pull_request' as const, committed: { pr: 1 }, approvalId: 'apr', target: { system: 'github', targetId: 't', effect: 'e', reversible: 'soft-only' as const }, auditSeq: 2 }; }
    }
    const fb = new FakeBridge();
    const engine: PrOpener = new PrEngine(fb, async () => true); // the engine is the sole capability holder
    const out = await consumerModuleWantsAPr(engine, { target: { repo: 'ECE-FACTORY/x', branch: 'a', base: 'b' }, title: 'T', body: 'B' }, ctx());
    expect(out.status).toBe('PR-OPENED');
    expect(fb.opened).toBe(1); // opened only via the engine's capability-gated path
  });
});

describe('PR Engine sole-authority — BOUNDARY: exactly one module assembles/opens a PR', () => {
  it('only the PR Engine references the open_pull_request open-path / assembles a PR (src/ scan)', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // src/
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts')) continue;
        if (p.endsWith('.test.ts')) continue;             // tests exercise the seam; not production references
        const rel = path.relative(root, p);
        if (rel.startsWith('layer-5-action/pr-engine/')) continue; // the PR Engine is the sanctioned assembler
        const src = readFileSync(p, 'utf8');
        // the bridge DEFINES the capability seam (legitimate); a reference is an offender only if a NON-bridge,
        // non-pr-engine module assembles/opens a PR (calls openPullRequest / open_pull_request as an action).
        if (rel.startsWith('layer-5-action/mcp-bridge/')) continue;
        if (/openPullRequest\(|grantPrOpenCapability\(|'open_pull_request'|"open_pull_request"/.test(src)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]); // no other module assembles/opens a PR
  });
});
