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

  // ── Prohibition 4g (added additively) — the SOLE real filesystem writer is gated + jailed ─────────────
  // filesystem-executor.ts is the FIRST and ONLY module in the factory that legitimately performs a real fs
  // write. 4e/4f (unchanged above) still prove the dry-run adapter, the github adapter, and the build planner
  // are INCAPABLE (no node:fs, no real-write call, no mint). This block does NOT loosen them — it proves the
  // NEW carve-out is fenced: the executor imports node:fs (the one sanctioned place) yet is (1) approval-gated
  // by the REAL branded ConsumedApproval, (2) MINTS NOTHING, (3) references the hard-coded /tmp/ece-dryrun- jail
  // constant, and (4) performs NO destructive op (no rm/unlink/rename/rmdir — creates only) AND fences the real
  // write at the SYSCALL boundary: a NEW file is created via openSync with O_EXCL (fails rather than overwrites)
  // AND O_NOFOLLOW (the kernel refuses a final-component symlink, closing the final-component TOCTOU) — never
  // writeFileSync. The net effect: the law now proves the ONLY real writer is gated + jailed. Purely ADDITIVE.
  it('Prohibition 4g — the filesystem-executor is the SOLE sanctioned writer AND is approval-gated, jailed, mints nothing, and does no destructive op', () => {
    const execRaw = readFileSync(
      join(SRC, 'layer-5-action', 'filesystem-executor', 'filesystem-executor.ts'), 'utf8');
    const exec = stripComments(execRaw);

    // (0) It is the sanctioned writer: it DOES import node:fs (unlike 4e's adapters, which must not).
    expect(/from\s*['"]node:fs['"]/.test(execRaw)).toBe(true);

    // (1) APPROVAL-GATED — the write entry requires the REAL branded ConsumedApproval, imported as a TYPE from
    //     the governed-adapter CONTRACT (which re-exports the module-private bridge token). No ungated write.
    expect(/executeFilesystemPlan\s*\([\s\S]*?approval:\s*ConsumedApproval/.test(execRaw)).toBe(true);
    expect(/from\s*['"]\.\.\/governed-adapter\/governed-adapter\.js['"]/.test(execRaw)).toBe(true);

    // (2) MINTS NOTHING — no token/capability mint of any kind.
    expect(/\bmintConsumedApproval\b/.test(exec)).toBe(false);
    expect(/\bmintExternalCapability\b/.test(exec)).toBe(false);
    expect(/\bmint[A-Za-z]*\s*\(/.test(exec)).toBe(false);

    // (3) JAILED — the hard-coded, non-parameter /tmp/ece-dryrun- jail constant is present.
    expect(/const JAIL_PREFIX\s*=\s*['"]\/tmp\/ece-dryrun-['"]/.test(exec)).toBe(true);

    // (4) NO DESTRUCTIVE OP — creates only (mkdir/fd-create); never deletes/overwrites/renames. And the file
    //     write is fenced at the syscall boundary: an explicit openSync with O_EXCL (fails rather than overwrites)
    //     AND O_NOFOLLOW (kernel refuses a final-component symlink) — writeFileSync is never used.
    for (const re of [/\brm\s*\(/, /\brmSync\s*\(/, /\brmdir\s*\(/, /\brmdirSync\s*\(/, /\bunlink\s*\(/,
                      /\bunlinkSync\s*\(/, /\brename\s*\(/, /\brenameSync\s*\(/, /\btruncate\s*\(/, /\bcopyFile\s*\(/]) {
      expect({ pattern: String(re), hit: re.test(exec) }).toEqual({ pattern: String(re), hit: false });
    }
    expect(/\bwriteFileSync\b/.test(exec)).toBe(false);
    expect(/openSync\s*\(/.test(exec)).toBe(true);
    expect(/constants\.O_EXCL\b/.test(exec)).toBe(true);
    expect(/constants\.O_NOFOLLOW\b/.test(exec)).toBe(true);

    // AND the carve-out did NOT loosen 4e: the dry-run filesystem ADAPTER still imports no node:fs and still has
    // no real fs-write call. (Re-checked here so 4g can never silently mask a regression in the incapable adapter.)
    const dryRunRaw = readFileSync(
      join(SRC, 'layer-5-action', 'filesystem-adapter-dryrun', 'filesystem-adapter-dryrun.ts'), 'utf8');
    const dryRun = stripComments(dryRunRaw);
    expect(/from\s*['"]node:fs(\/promises)?['"]/.test(dryRun)).toBe(false);
    for (const re of [/\bwriteFile\s*\(/, /\bmkdir\s*\(/]) {
      expect({ pattern: String(re), hit: re.test(dryRun) }).toEqual({ pattern: String(re), hit: false });
    }
  });

  // ── Prohibition 4h (added additively) — the Layer-4 BUILD CHAIN ORCHESTRATOR composes, but holds no power ─
  // build-chain-orchestrator.ts is the FIRST end-to-end composition of the three proven pieces (build-planner,
  // filesystem-adapter-dryrun, filesystem-executor). Composing them must NOT hand the composer any capability the
  // pieces deny it. As a Layer-4 orchestrator it must obey the write boundary from the top: it imports NO node:fs
  // (only the executor it delegates to touches disk), holds NO real fs-write call of its own, MINTS NOTHING, and
  // CANNOT SELF-CONFIRM — its Phase-B `execute` requires BOTH a genuine ConsumedApproval AND an explicit human
  // confirm, and the SOLE executor call site sits AFTER the confirm gate (so the free Phase-A `planOnly` can never
  // reach a write). This block is purely ADDITIVE: it adds coverage for the orchestrator and changes NONE of the
  // assertions above — 4e/4f/4g are untouched; the executor remains the sole sanctioned writer.
  it('Prohibition 4h — the Layer-4 build-chain orchestrator imports no node:fs, has no real-write call, mints nothing, cannot self-confirm, and gates the sole executor call behind an explicit human confirm', () => {
    const orchRaw = readFileSync(
      join(SRC, 'layer-4-build-harden', 'build-chain-orchestrator', 'build-chain-orchestrator.ts'), 'utf8');
    const orch = stripComments(orchRaw);

    // 1. Imports NO node:fs at all — the orchestrator returns/relays DATA and cannot touch the filesystem itself.
    expect(/from\s*['"]node:fs(\/promises)?['"]/.test(orch)).toBe(false);
    expect(/from\s*['"]fs(\/promises)?['"]/.test(orch)).toBe(false);
    expect(/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/.test(orch)).toBe(false);

    // 2. NO real filesystem-write call of its own — it only DELEGATES to the executor (same technique as 4e/4f).
    for (const re of [/\bwriteFile\s*\(/, /\bwriteFileSync\s*\(/, /\bmkdir\s*\(/, /\bmkdirSync\s*\(/, /\brm\s*\(/,
                      /\brmdir\s*\(/, /\bopenSync\s*\(/, /\bappendFile\s*\(/, /\bcreateWriteStream\s*\(/, /\bcopyFile\s*\(/]) {
      expect({ pattern: String(re), hit: re.test(orch) }).toEqual({ pattern: String(re), hit: false });
    }

    // 3. MINTS NOTHING — no token/capability mint of any kind, and it never CONSTRUCTS a passing confirm (it only
    //    compares against EXECUTE_CONFIRM_TOKEN; it never assigns it into a `token:` field to fabricate one).
    expect(/\bmintConsumedApproval\b/.test(orch)).toBe(false);
    expect(/\bmintExternalCapability\b/.test(orch)).toBe(false);
    expect(/\bmint[A-Za-z]*\s*\(/.test(orch)).toBe(false);
    expect(/token:\s*EXECUTE_CONFIRM_TOKEN/.test(orch)).toBe(false);

    // 4. COMPOSES the three proven pieces (imports each) and depends on the approval type from the CONTRACT.
    expect(/from\s*['"]\.\.\/build-planner\/build-planner\.js['"]/.test(orchRaw)).toBe(true);
    expect(/from\s*['"]\.\.\/\.\.\/layer-5-action\/filesystem-adapter-dryrun\/filesystem-adapter-dryrun\.js['"]/.test(orchRaw)).toBe(true);
    expect(/from\s*['"]\.\.\/\.\.\/layer-5-action\/filesystem-executor\/filesystem-executor\.js['"]/.test(orchRaw)).toBe(true);
    expect(/from\s*['"]\.\.\/\.\.\/layer-5-action\/governed-adapter\/governed-adapter\.js['"]/.test(orchRaw)).toBe(true);

    // 5. DOUBLY-GATED, CANNOT SELF-CONFIRM — `execute` requires BOTH a ConsumedApproval AND a confirm argument,
    //    and the SOLE executor call is confirm-gated: the confirm token check precedes the one executor call site.
    expect(/execute\s*\([\s\S]*?approval:\s*ConsumedApproval[\s\S]*?confirm:\s*HumanExecuteConfirm/.test(orchRaw)).toBe(true);
    expect((orch.match(/executeFilesystemPlan\s*\(/g) ?? []).length).toBe(1); // exactly one real-write delegation
    expect(orch.indexOf('EXECUTE_CONFIRM_TOKEN')).toBeGreaterThan(-1);
    expect(orch.indexOf('EXECUTE_CONFIRM_TOKEN')).toBeLessThan(orch.indexOf('executeFilesystemPlan(')); // gate precedes write

    // AND the composition did NOT loosen 4e/4f/4g: the executor is STILL the sole importer of node:fs among these
    // four, and the composed dry-run adapter + build planner STILL import no node:fs. (Re-checked so 4h can never
    // silently mask a regression where the orchestrator smuggled a write capability into an incapable layer.)
    const execRaw2 = readFileSync(join(SRC, 'layer-5-action', 'filesystem-executor', 'filesystem-executor.ts'), 'utf8');
    expect(/from\s*['"]node:fs['"]/.test(execRaw2)).toBe(true); // executor: the ONE sanctioned writer
    const plannerRaw2 = stripComments(readFileSync(join(SRC, 'layer-4-build-harden', 'build-planner', 'build-planner.ts'), 'utf8'));
    const dryRunRaw2 = stripComments(readFileSync(join(SRC, 'layer-5-action', 'filesystem-adapter-dryrun', 'filesystem-adapter-dryrun.ts'), 'utf8'));
    expect(/from\s*['"]node:fs(\/promises)?['"]/.test(plannerRaw2)).toBe(false);
    expect(/from\s*['"]node:fs(\/promises)?['"]/.test(dryRunRaw2)).toBe(false);
  });

  // ── Prohibition 4i (added additively) — the Layer-2 DECIDING→BUILDING SEAM cannot self-approve a build ─
  // build-decision-seam.ts is the human's button: it turns an APPROVED harvest proposal into an
  // ApprovedBuildDecision. Assembling that decision must be UNREACHABLE without a real, human-consumed approval.
  // As a Layer-2 command it must obey the write boundary from the top: it MINTS NOTHING (no token/brand), the
  // ApprovedBuildDecision is constructed at EXACTLY ONE site — inside the dispatcher's `approvalWrite(approval)`
  // callback, whose sole parameter is the genuine ConsumedApproval — it depends on the token TYPE via the
  // governed-adapter CONTRACT (never the transport's token/mint), routes through the REAL ClassDispatcher, and
  // holds no node:fs / real-write. Net: no branded token ⇒ STOP_FOR_APPROVAL ⇒ no decision. Purely ADDITIVE:
  // it adds coverage for the seam and changes NONE of the assertions above.
  //
  // PLAIN TERMS: there is no path — no function, no cast, no default — by which an ApprovedBuildDecision is
  // created without the branded ConsumedApproval the dispatcher mints only after a real human's Approval-Gate
  // APPROVE. If the machine tries to approve its own build, the gate yields no token and the decision is
  // unconstructable.
  it('Prohibition 4i — the Layer-2 build-decision seam mints nothing, forges nothing, and constructs the ApprovedBuildDecision ONLY inside the token-gated approvalWrite handler', () => {
    const seamRaw = readFileSync(
      join(SRC, 'layer-2-command', 'build-decision-seam', 'build-decision-seam.ts'), 'utf8');
    const seam = stripComments(seamRaw);

    // 1. TOKEN TYPE comes from the CONTRACT, not the transport. The governed-adapter import brings ConsumedApproval;
    //    the tool-classes import brings the runtime dispatcher/bridge ONLY — never the token/mint/brand.
    const contractImport = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*governed-adapter\/governed-adapter\.js['"]/s.exec(seamRaw);
    expect(contractImport).not.toBeNull();
    expect(/\bConsumedApproval\b/.test(contractImport![1])).toBe(true);
    const bridgeImport = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*mcp-bridge\/tool-classes\.js['"]/s.exec(seamRaw);
    expect(bridgeImport).not.toBeNull();
    expect(/\bClassDispatcher\b/.test(bridgeImport![1])).toBe(true);   // it DOES use the real dispatcher...
    expect(/\bConsumedApproval\b/.test(bridgeImport![1])).toBe(false); // ...but NOT the token type from the transport
    expect(/\bmintConsumedApproval\b/.test(bridgeImport![1])).toBe(false);
    expect(/\bAPPROVAL_BRAND\b/.test(bridgeImport![1])).toBe(false);

    // 2. MINTS NOTHING — no named mint, no `mint…(` call, and the brand symbol is never named anywhere.
    expect(/\bmintConsumedApproval\b/.test(seam)).toBe(false);
    expect(/\bmintExternalCapability\b/.test(seam)).toBe(false);
    expect(/\bmint[A-Za-z]*\s*\(/.test(seam)).toBe(false);
    expect(/\bAPPROVAL_BRAND\b/.test(seam)).toBe(false);

    // 3. NO FORGERY BY CAST — the token/decision are never conjured with a type assertion.
    expect(/as\s+ConsumedApproval\b/.test(seam)).toBe(false);
    expect(/as\s+ApprovedBuildDecision\b/.test(seam)).toBe(false);

    // 4. EXACTLY ONE construction of the decision, INSIDE the approvalWrite handler. `approvedBy:` is a field only
    //    the ApprovedBuildDecision literal carries; it appears once, after the single approvalWrite callback opens.
    expect((seam.match(/\bapprovalWrite:/g) ?? []).length).toBe(1);
    expect((seam.match(/\bapprovedBy:/g) ?? []).length).toBe(1);
    expect(seam.indexOf('approvedBy:')).toBeGreaterThan(seam.indexOf('approvalWrite:')); // constructed inside the handler
    // the handler is explicitly typed to receive the branded token — it is the only way in.
    expect(/approvalWrite:\s*async\s*\(approval:\s*ConsumedApproval\)/.test(seam)).toBe(true);

    // 5. ROUTES THROUGH THE REAL DISPATCHER for the write tier — re-implements no consume/mint.
    expect(/\bdispatch\b/.test(seam)).toBe(true);
    expect(/'APPROVAL_REQUIRED_WRITE'/.test(seam)).toBe(true);

    // 6. Imports NO node:fs and holds NO real-write call — it assembles a decision, it does not write.
    expect(/from\s*['"]node:fs(\/promises)?['"]/.test(seam)).toBe(false);
    expect(/from\s*['"]fs(\/promises)?['"]/.test(seam)).toBe(false);
    for (const re of [/\bwriteFile\s*\(/, /\bmkdir\s*\(/, /\brm\s*\(/, /\bopenSync\s*\(/, /\bappendFile\s*\(/, /\bcreateWriteStream\s*\(/]) {
      expect({ pattern: String(re), hit: re.test(seam) }).toEqual({ pattern: String(re), hit: false });
    }
  });

  // ── Prohibition 4j (added additively) — PRODUCT MODE cannot be silently defaulted ─────────────────────
  // The sovereign/subscription product-mode switch adds a lens to the harvest/scoring path. The safety law: a
  // mode is NEVER inferred or defaulted — it is a REQUIRED parameter of scoreCandidate + decideSourcing (no
  // default, not optional), and a REQUIRED field on every HarvestReport. The sovereign air-gap FORK gate stays
  // bound to `mode === 'sovereign'`, so no mode — nor any mode confusion — can bypass it (a non-sovereign
  // candidate simply has no air-gap sub-score, so the sovereign gate fails closed). Behavioral coverage of the
  // gate itself lives in the module tests (scoring-engine / harvest-orchestrator); this freezes the STATIC
  // no-silent-default shape. Purely ADDITIVE — changes NONE of the assertions above.
  it('Prohibition 4j — product mode is a required, undefaulted parameter of scoreCandidate + decideSourcing, a required report field, and the air-gap gate stays sovereign-bound', () => {
    const scoringRaw = readFileSync(join(SRC, 'layer-3-harvest', 'scoring-engine', 'scoring-engine.ts'), 'utf8');
    const orchRaw = readFileSync(join(SRC, 'layer-3-harvest', 'harvest-orchestrator', 'harvest-orchestrator.ts'), 'utf8');
    const scoring = stripComments(scoringRaw);
    const orch = stripComments(orchRaw);

    // 1. ProductMode is exactly the two literals, defined once (in the scoring engine).
    expect(/export type ProductMode\s*=\s*'sovereign'\s*\|\s*'subscription'\s*;/.test(scoring)).toBe(true);

    // 2. scoreCandidate takes `mode: ProductMode` as a REQUIRED param — not optional, not defaulted.
    expect(/export function scoreCandidate\s*\([^)]*\bmode:\s*ProductMode\b[^)]*\)/s.test(scoring)).toBe(true);
    expect(/scoreCandidate\s*\([^)]*\bmode\?\s*:/s.test(scoring)).toBe(false);          // no optional
    expect(/scoreCandidate\s*\([^)]*\bmode:\s*ProductMode\s*=/s.test(scoring)).toBe(false); // no default

    // 3. decideSourcing takes `mode: ProductMode` as a REQUIRED param — not optional, not defaulted.
    expect(/export function decideSourcing\s*\([^)]*\bmode:\s*ProductMode\b[^)]*\)/s.test(orch)).toBe(true);
    expect(/decideSourcing\s*\([^)]*\bmode\?\s*:/s.test(orch)).toBe(false);
    expect(/decideSourcing\s*\([^)]*\bmode:\s*ProductMode\s*=/s.test(orch)).toBe(false);

    // 4. HarvestReport carries a REQUIRED productMode field (not optional).
    expect(/productMode:\s*ProductMode\s*;/.test(orch)).toBe(true);
    expect(/productMode\?\s*:/.test(orch)).toBe(false);

    // 5. The air-gap FORK gate stays SOVEREIGN-BOUND — decideSourcing selects the gate dimension by mode, and the
    //    sovereign gate is the air-gap dimension. Mode confusion can only fail closed, never bypass it.
    expect(/'air-gap'/.test(orch)).toBe(true);
    expect(/mode === 'sovereign'/.test(orch)).toBe(true);
  });

  // ── Prohibition 4k (added additively) — the Layer-2 SUBSCRIPTION PROMOTION SEAM cannot self-approve a build ─
  // subscription-decision-seam.ts is the subscription-mode analog of the sovereign build-decision seam: it turns
  // an APPROVED subscription harvest proposal into an ApprovedBuildDecision by folding a human MULTI-TENANCY
  // measurement. It must obey the SAME token discipline, and — being a SEPARATE FILE — needs its own per-file
  // freeze (4i reads build-decision-seam.ts by path and cannot see a second file). This is a VERBATIM MIRROR of
  // 4i retargeted to the subscription seam: MINTS NOTHING, the ApprovedBuildDecision is constructed at EXACTLY
  // ONE site inside `approvalWrite(approval: ConsumedApproval)`, the token TYPE comes from the governed-adapter
  // CONTRACT (never the transport's token/mint), it routes through the REAL ClassDispatcher, and holds no
  // node:fs / real-write. Net: no branded token ⇒ STOP_FOR_APPROVAL ⇒ no decision. Purely ADDITIVE — changes
  // NONE of the assertions above (4i still proves the identical property for the sovereign seam).
  it('Prohibition 4k — the Layer-2 subscription promotion seam mints nothing, forges nothing, and constructs the ApprovedBuildDecision ONLY inside the token-gated approvalWrite handler', () => {
    const seamRaw = readFileSync(
      join(SRC, 'layer-2-command', 'subscription-decision-seam', 'subscription-decision-seam.ts'), 'utf8');
    const seam = stripComments(seamRaw);

    // 1. TOKEN TYPE comes from the CONTRACT, not the transport. The governed-adapter import brings ConsumedApproval;
    //    the tool-classes import brings the runtime dispatcher/bridge ONLY — never the token/mint/brand.
    const contractImport = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*governed-adapter\/governed-adapter\.js['"]/s.exec(seamRaw);
    expect(contractImport).not.toBeNull();
    expect(/\bConsumedApproval\b/.test(contractImport![1])).toBe(true);
    const bridgeImport = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*mcp-bridge\/tool-classes\.js['"]/s.exec(seamRaw);
    expect(bridgeImport).not.toBeNull();
    expect(/\bClassDispatcher\b/.test(bridgeImport![1])).toBe(true);   // it DOES use the real dispatcher...
    expect(/\bConsumedApproval\b/.test(bridgeImport![1])).toBe(false); // ...but NOT the token type from the transport
    expect(/\bmintConsumedApproval\b/.test(bridgeImport![1])).toBe(false);
    expect(/\bAPPROVAL_BRAND\b/.test(bridgeImport![1])).toBe(false);

    // 2. MINTS NOTHING — no named mint, no `mint…(` call, and the brand symbol is never named anywhere.
    expect(/\bmintConsumedApproval\b/.test(seam)).toBe(false);
    expect(/\bmintExternalCapability\b/.test(seam)).toBe(false);
    expect(/\bmint[A-Za-z]*\s*\(/.test(seam)).toBe(false);
    expect(/\bAPPROVAL_BRAND\b/.test(seam)).toBe(false);

    // 3. NO FORGERY BY CAST — the token/decision are never conjured with a type assertion.
    expect(/as\s+ConsumedApproval\b/.test(seam)).toBe(false);
    expect(/as\s+ApprovedBuildDecision\b/.test(seam)).toBe(false);

    // 4. EXACTLY ONE construction of the decision, INSIDE the approvalWrite handler. `approvedBy:` is a field only
    //    the ApprovedBuildDecision literal carries; it appears once, after the single approvalWrite callback opens.
    expect((seam.match(/\bapprovalWrite:/g) ?? []).length).toBe(1);
    expect((seam.match(/\bapprovedBy:/g) ?? []).length).toBe(1);
    expect(seam.indexOf('approvedBy:')).toBeGreaterThan(seam.indexOf('approvalWrite:')); // constructed inside the handler
    // the handler is explicitly typed to receive the branded token — it is the only way in.
    expect(/approvalWrite:\s*async\s*\(approval:\s*ConsumedApproval\)/.test(seam)).toBe(true);

    // 5. ROUTES THROUGH THE REAL DISPATCHER for the write tier — re-implements no consume/mint.
    expect(/\bdispatch\b/.test(seam)).toBe(true);
    expect(/'APPROVAL_REQUIRED_WRITE'/.test(seam)).toBe(true);

    // 6. Imports NO node:fs and holds NO real-write call — it assembles a decision, it does not write.
    expect(/from\s*['"]node:fs(\/promises)?['"]/.test(seam)).toBe(false);
    expect(/from\s*['"]fs(\/promises)?['"]/.test(seam)).toBe(false);
    for (const re of [/\bwriteFile\s*\(/, /\bmkdir\s*\(/, /\brm\s*\(/, /\bopenSync\s*\(/, /\bappendFile\s*\(/, /\bcreateWriteStream\s*\(/]) {
      expect({ pattern: String(re), hit: re.test(seam) }).toEqual({ pattern: String(re), hit: false });
    }
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
