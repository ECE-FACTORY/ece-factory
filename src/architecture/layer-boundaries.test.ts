// Architecture boundary tests — freeze the six-layer direction rules permanently.
// These are static-source assertions: they read the src/ tree and fail if a forbidden
// import edge appears. They encode the ECE Factory vision's layer-direction law.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const filesUnder = (layer: string) => {
  try { return walk(join(SRC, layer)); } catch { return []; }
};
const importsMatching = (files: string[], re: RegExp) =>
  files.filter(f => re.test(readFileSync(f, 'utf8')));

describe('ECE Factory — six-layer boundary law', () => {
  it('1. no Layer 1–4 module imports Layer 6', () => {
    const l1to4 = [...filesUnder('layer-1-law'), ...filesUnder('layer-2-command'),
                   ...filesUnder('layer-3-harvest'), ...filesUnder('layer-4-build-harden')];
    expect(importsMatching(l1to4, /layer-6-venture-intel/)).toEqual([]);
  });
  it('2. Layer 6 does not import live action / external adapters', () => {
    expect(importsMatching(filesUnder('layer-6-venture-intel'),
      /mcp-server\/live-|external-gateways|live-write|live-github/)).toEqual([]);
  });
  it('3. Layer 6 has no ApprovalGate mint/consume/execute path', () => {
    expect(importsMatching(filesUnder('layer-6-venture-intel'),
      /mintApproval|consumeApproval|ConsumedApproval/)).toEqual([]);
  });
  it('5. Operator Cockpit is read/route-only (no mint/consume/deploy/publish)', () => {
    const cockpit = filesUnder('layer-5-action').filter(f => /operator-cockpit/.test(f));
    expect(importsMatching(cockpit, /mintApproval|consumeApproval|deploy\(|publish\(/)).toEqual([]);
  });
  it('7. factory-shared is imported by more than one layer', () => {
    const layers = ['layer-1-law','layer-2-command','layer-3-harvest','layer-4-build-harden','layer-5-action','layer-6-venture-intel'];
    const consumers = layers.filter(L => importsMatching(filesUnder(L), /factory-shared\//).length > 0);
    expect(consumers.length).toBeGreaterThan(1);
  });
});
