// RULE 0 (UI read-plane) — the read plane can only ECHO what it actually read (git, report files, test runs,
// source constants), each stamped with WHERE it came from. It cannot state an operational status it did not read,
// and it cannot restate a capability constant instead of importing it. This is the UI-law analog of the
// write-asks-read-first Prohibitions — enforced by source inspection + runtime schema checks. (Design §5.)
//
// TDD staging: 0.1 (contracts) + 0.2 (no write/mint/gate) go green after M2 steps 2-3; 0.3 (CapabilityAdapter
// no-drift) + 0.4 (stores honest-absent) stay HONESTLY RED until steps 4-5 (adapters + State API). A red 0.3/0.4
// means "not built yet", not a regression.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const READ_PLANE = join(__dirname);
const CONTRACTS = join(READ_PLANE, 'contracts');
const ADAPTERS = join(READ_PLANE, 'adapters');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const prod = (dir: string) => walk(dir).filter((f) => !f.endsWith('.test.ts'));
// Dynamic import via a variable specifier so tsc does not statically resolve not-yet-built (M2 step 4-5) modules.
const dyn = (p: string): Promise<Record<string, (...a: unknown[]) => unknown>> => import(p) as Promise<Record<string, (...a: unknown[]) => unknown>>;

describe('RULE 0 — the read plane cannot fabricate operational state', () => {
  // ── 0.1 — no operational field is un-provenanced (structural + runtime) ────────────────────────────────
  it('0.1 — contracts define Provenanced<T> as present|absent, and a BARE operational value fails the schema', async () => {
    expect(existsSync(CONTRACTS), 'src/read-plane/contracts/ must exist').toBe(true);
    const src = prod(CONTRACTS).map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    // The Provenanced combinator is a present|absent discriminated union; present carries a source, absent a reason.
    expect(/discriminatedUnion\(\s*['"]status['"]/.test(src)).toBe(true);
    expect(/status:\s*z\.literal\(\s*['"]present['"]\s*\)/.test(src)).toBe(true);
    expect(/status:\s*z\.literal\(\s*['"]absent['"]\s*\)/.test(src)).toBe(true);
    expect(/\bprovenanced\s*[=(<]/.test(src)).toBe(true);

    // RUNTIME: a bare operational value must FAIL, a provenanced one must PASS. (Rule 0 as a schema failure.)
    const c = await import('./contracts/index.js');
    const present = <T>(value: T) => ({ status: 'present', value, provenance: { source: 'git', locator: { kind: 'cmd', cmd: 'git rev-parse HEAD' }, pin: { kind: 'commit', commit: 'abc' }, readAt: '2026-07-09T00:00:00.000Z' } });
    const bare = c.GitStateSchema.safeParse({ head: 'deadbeef', branch: 'main', dirty: false, recent: [] });
    expect(bare.success, 'a bare (un-provenanced) GitState.head must FAIL the schema').toBe(false);
    const wrapped = c.GitStateSchema.safeParse({ head: present('deadbeef'), branch: present('main'), dirty: present(false), recent: present([]) });
    expect(wrapped.success, 'a provenanced GitState must PASS').toBe(true);
    // A 'present' value carrying ABSENT provenance is a contradiction and must FAIL.
    const contradiction = c.GitStateSchema.safeParse({ head: { status: 'present', value: 'x', provenance: { source: 'absent', reason: 'nope', readAt: '2026-07-09T00:00:00.000Z' } }, branch: present('main'), dirty: present(false), recent: present([]) });
    expect(contradiction.success, "a 'present' value with 'absent' provenance must FAIL").toBe(false);
  });

  // ── 0.2 — the read plane holds NO write/mint/gate power ────────────────────────────────────────────────
  it('0.2 — no read-plane file imports a mint/brand or holds a real write/execute path', () => {
    expect(existsSync(CONTRACTS), 'read plane must exist').toBe(true);
    const files = prod(READ_PLANE);
    for (const f of files) {
      const s = stripComments(readFileSync(f, 'utf8'));
      for (const re of [/\bmintConsumedApproval\b/, /\bAPPROVAL_BRAND\b/, /\bmintExternalCapability\b/,
                        /\bexecuteFilesystemPlan\b/, /\bwriteFile\s*\(/, /\bmkdir\s*\(/, /\brm\s*\(/,
                        /\bopenSync\s*\(/, /\bappendFile\s*\(/, /from\s*['"]node:fs\/promises['"]/]) {
        expect({ file: f.replace(READ_PLANE, ''), pattern: String(re), hit: re.test(s) }).toEqual({ file: f.replace(READ_PLANE, ''), pattern: String(re), hit: false });
      }
    }
  });

  // ── 0.3 — CapabilityAdapter DERIVES the sandbox constant; no hardcoded literal (no-drift) ───────────────
  //    HONESTLY RED until M2 step 4 (CapabilityAdapter).
  it('0.3 — CapabilityAdapter imports JAIL_PREFIX from the executor and hardcodes NO /tmp/ece-dryrun- literal', async () => {
    const capFile = join(ADAPTERS, 'capability-adapter.ts');
    expect(existsSync(capFile), 'CapabilityAdapter not built yet (M2 step 4)').toBe(true);
    const raw = readFileSync(capFile, 'utf8');
    const src = stripComments(raw);
    expect(/import\s*\{[^}]*\bJAIL_PREFIX\b[^}]*\}\s*from\s*['"][^'"]*filesystem-executor\.js['"]/.test(raw)).toBe(true);
    expect(/['"]\/tmp\/ece-dryrun-['"]/.test(src), 'no hardcoded jail literal — must derive from source').toBe(false);
    // Runtime: the exposed value equals the executor's actual constant (cannot drift — it is imported).
    const { JAIL_PREFIX } = await import('../layer-5-action/filesystem-executor/filesystem-executor.js');
    const cap = await dyn('./adapters/capability-adapter.js');
    expect((cap.capabilityState() as { sandboxJailPrefix: { value: string } }).sandboxJailPrefix.value).toBe(JAIL_PREFIX);
  });

  // ── 0.4 — store state is HONEST: present-and-empty when no records, never a mocked record (M3) ──────────
  //    (M2's absent stub flipped to the M3 StoreAdapter — present-and-empty is truth; a record is never invented.)
  it('0.4 — the store state is honest: PRESENT-and-empty (count 0, source store-file) when there are no records', async () => {
    const storeFile = join(ADAPTERS, 'store-adapter.ts');
    expect(existsSync(storeFile), 'StoreAdapter must exist').toBe(true);
    const store = await dyn('./adapters/store-adapter.js');
    const os = await import('node:os'); const fs = await import('node:fs'); const nodePath = await import('node:path');
    const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ece-04-')); // isolated empty factory-state — deterministic
    try {
      const s = store.storeState({ root }) as Record<'approvals' | 'audit' | 'executions', { status: string; value: { count: number; latest: unknown }; provenance: { source: string } }>;
      for (const key of ['approvals', 'audit', 'executions'] as const) {
        expect(s[key].status).toBe('present');                 // the store mechanism exists now
        expect(s[key].value).toMatchObject({ count: 0, latest: null }); // empty is truth, NOT a fabricated record
        expect(s[key].provenance.source).toBe('store-file');
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
