// Enforcement test for the Layer-1 "Write Asks Read First" doctrine
// (organization-source-of-truth/governance/layer-1-source-build/DOCTRINE_WRITE_ASKS_READ_FIRST.md).
//
// It scans the REAL src/ tree and freezes the STATICALLY-checkable prohibitions of that doctrine:
//   • Prohibition 3 — the scout (layer-3-harvest) holds NO write/external capability (read-only).
//   • Prohibition 1 — the venture-intelligence layer (layer-6-venture-intel) holds NO write capability.
//   • Prohibition 4 — the ONLY functions that reach a write store / external system require a branded
//                     `ConsumedApproval` token, and that token's mint is module-private (a write handler is
//                     type-level unreachable without it).
// Prohibitions 5–7 (audit, human attribution, evidence freshness) are RUNTIME properties of the
// ApprovalGate/audit/sequencer path — they are documented here as OUT OF SCOPE for static assertion and are
// deliberately NOT faked with a static check. See the clearly-marked runtime section at the end.
//
// SCANNING DISCIPLINE — the governance/engine files are heavy with prose that NAMES the very modules they
// avoid (e.g. a comment reading "imports NOTHING from mcp-bridge / approval-gate"). A naive whole-file text
// match would false-positive on that prose. So these helpers strip comments and scan ONLY real import
// statements (module specifiers + imported binding names), which cannot appear inside a comment.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const BRIDGE = join(SRC, 'layer-5-action', 'mcp-bridge');

// ── tree walk (production modules only — .test.ts excluded, as the boundary law is about shipped code) ──
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const filesUnder = (layer: string): string[] => {
  try { return walk(join(SRC, layer)); } catch { return []; }
};

// ── comment stripping (block comments, then line comments — leaving `://` in URLs intact) ──
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');     // line comments, but not the `//` in `https://`
}

// ── real import statements only. Handles single- and multi-line imports; excludes comments by construction. ──
interface Import { specifier: string; bindings: string[] }
function importsOf(file: string): Import[] {
  const code = stripComments(readFileSync(file, 'utf8'));
  const out: Import[] = [];
  // `import ... from '<specifier>'`  (clause may span lines: [^;] spans newlines)
  const fromRe = /\bimport\b([^;]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  for (let m = fromRe.exec(code); m; m = fromRe.exec(code)) {
    const clause = m[1];
    const braced = /\{([^}]*)\}/.exec(clause);
    const bindings = (braced ? braced[1] : clause)
      .replace(/\btype\b/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^\*\s+as\s+/, '').split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    out.push({ specifier: m[2], bindings });
  }
  // side-effect import: `import '<specifier>'`
  const sideRe = /\bimport\s*['"]([^'"]+)['"]/g;
  for (let m = sideRe.exec(code); m; m = sideRe.exec(code)) out.push({ specifier: m[1], bindings: [] });
  return out;
}

// ── the forbidden write/external surface (real files in the tree) ──
// Module specifiers that carry write/external CAPABILITY. Importing any of these into a read layer is a violation.
const FORBIDDEN_SPECIFIER =
  /(mcp-bridge\/|external-gateways|external-tools|tool-classes|live-write-adapters|live-github|approval-gate\/approval-gate|pr-engine\/)/;
// Write/external SYMBOLS. These can only enter a module via import (the mints are module-private), so an import
// binding is the whole attack surface.
const FORBIDDEN_SYMBOL = new Set<string>([
  'ConsumedApproval', 'mintConsumedApproval', 'consumeApproval', 'ApprovalGatePort', 'BridgeApprovalGate',
  'ExternalCapability', 'mintExternalCapability', 'externalActionWithTool', 'performExternal', 'performInternalWrite',
  'RepoCreationGateway', 'TicketGateway', 'CrmGateway', 'EmailGateway', 'DeployGateway',
  'MilestoneGateway', 'LabelGateway', 'IssueBatchGateway',
]);

function writeViolationsIn(layer: string): string[] {
  const bad: string[] = [];
  for (const f of filesUnder(layer)) {
    for (const imp of importsOf(f)) {
      if (FORBIDDEN_SPECIFIER.test(imp.specifier)) bad.push(`${f}: imports write/external module "${imp.specifier}"`);
      for (const b of imp.bindings) if (FORBIDDEN_SYMBOL.has(b)) bad.push(`${f}: imports write symbol "${b}"`);
    }
  }
  return bad;
}

describe('Layer 1 — "Write Asks Read First" doctrine (STATIC prohibitions)', () => {
  // ── Prohibition 3: the scout is read-only ────────────────────────────────────────────────────────────
  // The scout's home is src/layer-3-harvest/. Its engines classify SUPPLIED data and hold no write capability
  // (e.g. license-compliance.ts:92 classifies input.text; repo-intelligence.ts:14 "No live network fetching").
  it('Prohibition 3 — no module under layer-3-harvest/ imports any write/external path or write symbol', () => {
    expect(writeViolationsIn('layer-3-harvest')).toEqual([]);
  });

  // ── Prohibition 1: no write from Layer 6 ─────────────────────────────────────────────────────────────
  // Every venture-intel engine is PLAN-ONLY (e.g. venture-blueprint-composer.ts:22-23 "imports/calls NOTHING
  // from mcp-bridge / approval-gate"). This freezes that: no write/external capability may enter layer-6.
  it('Prohibition 1 — no module under layer-6-venture-intel/ imports any write/external path or write symbol', () => {
    expect(writeViolationsIn('layer-6-venture-intel')).toEqual([]);
  });

  // ── Prohibition 4: every write routes through the ApprovalGate (token at the write boundary) ──────────
  // The write boundary is the branded, single-use ConsumedApproval token. Real code cited below:
  //   • tool-classes.ts:100-104  — `interface ConsumedApproval` (branded with a module-private unique symbol, :99)
  //   • tool-classes.ts:105      — `function mintConsumedApproval(...)` is NOT exported (only this module mints)
  //   • tool-classes.ts:116      — the write handler slot: `approvalWrite?: (approval: ConsumedApproval) => Promise<W>`
  //   • mcp-bridge.ts:466        — runGuardedApprovedAction's `perform: (token: ConsumedApproval) => Promise<unknown>`
  //   • mcp-bridge.ts:492        — `performInternalWrite(name, params, _token: ConsumedApproval)` (sole write-store router)
  //   • mcp-bridge.ts:505        — `performExternal(name, target, payload, _token: ConsumedApproval)` (sole external router)
  //   • mcp-bridge.ts:508-516    — the ONLY ExternalSystems call sites (x.createGithubRepo(...) etc.) live inside performExternal
  //   • mcp-bridge.ts:111        — `function mintExternalCapability(...)` is NOT exported (per-action sole-authority capability)
  const toolClassesSrc = () => readFileSync(join(BRIDGE, 'tool-classes.ts'), 'utf8');
  const bridgeSrc = () => readFileSync(join(BRIDGE, 'mcp-bridge.ts'), 'utf8');

  it('Prohibition 4a — ConsumedApproval exists and its mint is module-private (not exported)', () => {
    const src = toolClassesSrc();
    expect(/export interface ConsumedApproval\b/.test(src)).toBe(true);
    // the mint exists...
    expect(/function mintConsumedApproval\s*\(/.test(src)).toBe(true);
    // ...but is NOT exported — no code outside this module can construct the token.
    expect(/export\s+(async\s+)?function mintConsumedApproval\b/.test(src)).toBe(false);
    expect(/export\s+\{[^}]*\bmintConsumedApproval\b[^}]*\}/.test(src)).toBe(false);
  });

  it('Prohibition 4b — the write handler slot requires a ConsumedApproval token (type-level)', () => {
    // tool-classes.ts:116 — a write handler is uncallable without the token.
    expect(/approvalWrite\?\:\s*\(approval:\s*ConsumedApproval\)\s*=>/.test(toolClassesSrc())).toBe(true);
  });

  it('Prohibition 4c — the only write-store / external routers require a ConsumedApproval token', () => {
    const src = bridgeSrc();
    // performInternalWrite (mcp-bridge.ts:492) and performExternal (mcp-bridge.ts:505) both take the token.
    expect(/performInternalWrite\s*\([^)]*ConsumedApproval[^)]*\)/s.test(src)).toBe(true);
    expect(/performExternal\s*\([^)]*ConsumedApproval[^)]*\)/s.test(src)).toBe(true);
    // runGuardedApprovedAction's perform callback (mcp-bridge.ts:466) is typed to require the token.
    expect(/perform:\s*\(token:\s*ConsumedApproval\)\s*=>/.test(src)).toBe(true);
    // the external-capability mint (mcp-bridge.ts:111) is module-private too.
    expect(/function mintExternalCapability\s*</.test(src)).toBe(true);
    expect(/export\s+(async\s+)?function mintExternalCapability\b/.test(src)).toBe(false);
  });

  it('Prohibition 4d — every ExternalSystems call site is inside token-gated performExternal (no ungated external write)', () => {
    const src = stripComments(bridgeSrc());
    const methods = ['createGithubRepo', 'openPullRequest', 'createTicket', 'updateCrmRecord', 'sendEmail',
                     'deployPackage', 'createMilestone', 'createLabel', 'createIssueBatch'];
    // The body of performExternal: from its METHOD DECLARATION (not a call site like `this.performExternal(...)`)
    // to the next `private ` member.
    const start = src.indexOf('private performExternal(');
    expect(start).toBeGreaterThan(-1);
    const afterDecl = start + 'private performExternal('.length;
    const end = afterDecl + src.slice(afterDecl).indexOf('\n  private ');
    const body = src.slice(start, end);
    for (const m of methods) {
      // Every invocation on the injected external systems object (`x.<method>(`) must sit inside performExternal.
      const callRe = new RegExp(`x\\.${m}\\s*\\(`, 'g');
      const total = (src.match(callRe) ?? []).length;
      const inBody = (body.match(callRe) ?? []).length;
      expect({ method: m, total, inBody }).toEqual({ method: m, total, inBody: total });
      expect(total).toBeGreaterThan(0); // the router actually reaches each external system
    }
  });

  // ── Prohibition 4 (extended): the Layer-5 governed-adapter write path is gated by ConsumedApproval too ─
  // The governed-adapter CONTRACT is the first piece of the far side of the human gate; github-adapter-dryrun is
  // its first implementation. Both must obey the same write boundary: the write-capable call requires the branded
  // ConsumedApproval (whose mint is module-private to the bridge), NEITHER mints a token, and NEITHER holds any
  // real-write call path (fetch/http/octokit). The impl depends on the CONTRACT, not the transport.
  it('Prohibition 4e — the Layer-5 governed-adapter contract + github impl require ConsumedApproval, mint nothing, and have no real-write call', () => {
    const contractSrc = readFileSync(
      join(SRC, 'layer-5-action', 'governed-adapter', 'governed-adapter.ts'), 'utf8');
    const implSrc = readFileSync(
      join(SRC, 'layer-5-action', 'github-adapter-dryrun', 'github-adapter-dryrun.ts'), 'utf8');

    // CONTRACT: the write-capable call is type-gated by the REAL branded token; it consumes the bridge, mints nothing.
    expect(/shapePlan\s*\([^)]*approval:\s*ConsumedApproval[^)]*\)/s.test(contractSrc)).toBe(true);
    expect(/from\s*['"]\.\.\/mcp-bridge\/tool-classes\.js['"]/.test(contractSrc)).toBe(true);
    expect(/\bmintConsumedApproval\b/.test(stripComments(contractSrc))).toBe(false);
    expect(/\bmintExternalCapability\b/.test(stripComments(contractSrc))).toBe(false);
    // No mutating execute() and no real write call anywhere in the contract.
    expect(/\bexecute\s*\(/.test(stripComments(contractSrc))).toBe(false);

    // IMPL: shapes a GitHub plan, mints nothing, and depends on the CONTRACT — not the transport module.
    expect(/shapePlan\s*\([^)]*approval:\s*ConsumedApproval[^)]*\)/s.test(implSrc)).toBe(true);
    expect(/from\s*['"]\.\.\/governed-adapter\/governed-adapter\.js['"]/.test(implSrc)).toBe(true);
    expect(/\bmintConsumedApproval\b/.test(stripComments(implSrc))).toBe(false);

    // NO real write call exists in EITHER — planners return inert data (dryRun/plannedOnly), never a request.
    for (const src of [stripComments(contractSrc), stripComments(implSrc)]) {
      for (const re of [/\bfetch\s*\(/, /\baxios\b/, /octokit/i, /createGithubRepo\s*\(/, /openPullRequest\s*\(/]) {
        expect({ pattern: String(re), hit: re.test(src) }).toEqual({ pattern: String(re), hit: false });
      }
    }
  });

  // ── Prohibition 4e (extended additively) — the Layer-5 FILESYSTEM governed-adapter obeys the same boundary ─
  // filesystem-adapter-dryrun is the SECOND implementation of the governed-adapter CONTRACT. It must obey the
  // same write boundary as the GitHub adapter: the write-capable call requires the branded ConsumedApproval, it
  // mints NO token, and — being a filesystem writer — it must import NO node:fs and hold NO real fs-write call
  // (writeFile/mkdir/rm/cp/rename/appendFile). It depends on the CONTRACT, not the transport. This block is
  // purely ADDITIVE: it adds coverage for a new adapter and changes NONE of the assertions above.
  it('Prohibition 4e (filesystem) — the Layer-5 filesystem governed-adapter requires ConsumedApproval, mints nothing, imports no node:fs, and has no real fs-write call', () => {
    const fsImplRaw = readFileSync(
      join(SRC, 'layer-5-action', 'filesystem-adapter-dryrun', 'filesystem-adapter-dryrun.ts'), 'utf8');
    const fsImpl = stripComments(fsImplRaw);

    // The write-capable call is type-gated by the REAL branded token; it depends on the CONTRACT, not the transport.
    expect(/shapePlan\s*\([^)]*approval:\s*ConsumedApproval[^)]*\)/s.test(fsImplRaw)).toBe(true);
    expect(/from\s*['"]\.\.\/governed-adapter\/governed-adapter\.js['"]/.test(fsImplRaw)).toBe(true);
    expect(/from\s*['"]\.\.\/mcp-bridge\//.test(fsImplRaw)).toBe(false);

    // Mints nothing.
    expect(/\bmintConsumedApproval\b/.test(fsImpl)).toBe(false);
    expect(/\bmintExternalCapability\b/.test(fsImpl)).toBe(false);

    // Imports NO node:fs at all — a filesystem adapter that cannot touch the filesystem.
    expect(/from\s*['"]node:fs(\/promises)?['"]/.test(fsImpl)).toBe(false);
    expect(/from\s*['"]fs(\/promises)?['"]/.test(fsImpl)).toBe(false);
    expect(/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/.test(fsImpl)).toBe(false);

    // NO real filesystem-write call exists — inert planned data only (dryRun/plannedOnly).
    for (const re of [/\bwriteFile\s*\(/, /\bmkdir\s*\(/, /\brm\s*\(/, /\brmdir\s*\(/, /\bcp\s*\(/,
                      /\brename\s*\(/, /\bappendFile\s*\(/, /\bunlink\s*\(/, /\bcreateWriteStream\s*\(/, /\bcopyFile\s*\(/]) {
      expect({ pattern: String(re), hit: re.test(fsImpl) }).toEqual({ pattern: String(re), hit: false });
    }
    // And still no mutating execute() path.
    expect(/\bexecute\s*\(/.test(fsImpl)).toBe(false);
  });

  // ── Prohibition 4f (added additively) — the Layer-4 BUILD PLANNER cannot write and cannot self-approve ─
  // build-planner.ts turns an ALREADY-APPROVED harvest decision into an INERT BuildPlan and DELEGATES the
  // scaffold write to the gated filesystem adapter. As a Layer-4 orchestrator that never touches a store, it
  // must obey the write boundary from the top: it imports NO node:fs (cannot write), holds NO real fs-write
  // call, MINTS NOTHING (cannot manufacture approval), and can only CONSUME an ApprovedBuildDecision whose
  // `approval` is the REAL branded ConsumedApproval — imported as a TYPE from the governed-adapter CONTRACT
  // (which re-exports the module-private bridge token), never a local approval constructor. This block is
  // purely ADDITIVE: it adds coverage for the build planner and changes NONE of the assertions above.
  it('Prohibition 4f — the Layer-4 build planner imports no node:fs, has no real-write call, mints nothing, and depends on the real gate approval type (not a local constructor)', () => {
    const plannerRaw = readFileSync(
      join(SRC, 'layer-4-build-harden', 'build-planner', 'build-planner.ts'), 'utf8');
    const planner = stripComments(plannerRaw);

    // 1. Imports NO node:fs at all — the planner returns DATA and cannot touch the filesystem.
    expect(/from\s*['"]node:fs(\/promises)?['"]/.test(planner)).toBe(false);
    expect(/from\s*['"]fs(\/promises)?['"]/.test(planner)).toBe(false);
    expect(/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/.test(planner)).toBe(false);

    // 2. NO real filesystem-write call exists — inert planned data only (same technique as 4e).
    for (const re of [/\bwriteFile\s*\(/, /\bmkdir\s*\(/, /\brm\s*\(/, /\brmdir\s*\(/, /\bcp\s*\(/,
                      /\brename\s*\(/, /\bappendFile\s*\(/, /\bunlink\s*\(/, /\bcreateWriteStream\s*\(/, /\bcopyFile\s*\(/]) {
      expect({ pattern: String(re), hit: re.test(planner) }).toEqual({ pattern: String(re), hit: false });
    }

    // 3. MINTS NOTHING — no named mint of a token, and no `mint…(` call at all. The planner can only CONSUME
    //    an ApprovedBuildDecision; it can never construct one.
    expect(/\bmintConsumedApproval\b/.test(planner)).toBe(false);
    expect(/\bmintExternalCapability\b/.test(planner)).toBe(false);
    expect(/\bmint[A-Za-z]*\s*\(/.test(planner)).toBe(false);

    // 4. Depends on the approval type from the REAL gate — ConsumedApproval imported as a TYPE from the
    //    governed-adapter CONTRACT (build-planner.ts:29-34), which re-exports the module-private bridge token.
    //    No local approval constructor: it uses the branded type only (the ApprovedBuildDecision.approval slot).
    expect(/from\s*['"]\.\.\/\.\.\/layer-5-action\/governed-adapter\/governed-adapter\.js['"]/.test(plannerRaw)).toBe(true);
    // The imported binding list from that contract includes ConsumedApproval (the real gate's token type).
    const contractImport = /import\s+type\s*\{([^}]*)\}\s*from\s*['"]\.\.\/\.\.\/layer-5-action\/governed-adapter\/governed-adapter\.js['"]/s.exec(plannerRaw);
    expect(contractImport).not.toBeNull();
    expect(/\bConsumedApproval\b/.test(contractImport![1])).toBe(true);
    // And the approval it holds is exactly that branded token — no locally-shaped approval object.
    expect(/approval:\s*ConsumedApproval\b/.test(plannerRaw)).toBe(true);
  });

  // ── RUNTIME prohibitions — DOCUMENTED, NOT STATICALLY ASSERTED ────────────────────────────────────────
  // Prohibitions 5 (audit), 6 (human attribution), and 7 (no write on missing/stale/ambiguous/unverified
  // evidence) are properties of the EXECUTION path, not of the source graph, so they cannot be honestly proven
  // by scanning files. We record here WHERE they are enforced and deliberately assert nothing about them —
  // faking a static proof of a runtime property would violate the doctrine this test enforces.
  //
  //   • Prohibition 5 (audit): the write runs only inside the sequencer's audit-bracketed callback —
  //       mcp-bridge.ts:477-485 (intent → consume token + perform → result). Verified by the bridge's own
  //       runtime tests, not here.
  //   • Prohibition 6 (human attribution): BridgeApprovalGate rejects a self/AI approver —
  //       tool-classes.ts:87 (`approver === 'claude' || approver === caller ⇒ null`). Runtime.
  //   • Prohibition 7 (evidence freshness): deny-by-default in the graders + gate (needs-review / STOP on
  //       unverified/ambiguous evidence) — e.g. license-compliance.ts:96-107, harvest-engine.ts:107-110.
  //       These are execution-time decisions and are out of scope for this static file.
  it('Prohibitions 5–7 are runtime-enforced and intentionally out of static scope (documentation marker)', () => {
    // No static assertion is possible or honest here; this test exists to make the scope boundary explicit.
    expect(true).toBe(true);
  });
});
