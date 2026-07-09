// CONSOLE BOUNDARY LAW — the browser bundle (client/) holds no factory power. It may import
// ONLY the pure zod contracts and other client files, and it speaks HTTP GET. This is the UI
// analog of read-plane law 0.2: enforced by source inspection so the boundary can't silently
// erode. (server/ is exempt — it is the one place allowed to touch the read plane.)

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = join(__dirname, 'client');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
/** Every module specifier the file imports (static `from '...'` + dynamic `import('...')`). */
function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  for (const m of src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

describe('CONSOLE BOUNDARY — the client bundle imports no factory power, writes nothing', () => {
  const files = walk(CLIENT);

  it('client/ exists and has source to inspect', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no client file imports node, an adapter, a layer, persistence, or the state-api router', () => {
    const forbidden: Array<{ re: RegExp; why: string }> = [
      { re: /^node:/, why: 'node builtin' },
      { re: /(^|\/)read-plane\/adapters(\/|$)/, why: 'read-plane adapter (node-side reader)' },
      { re: /(^|\/)read-plane\/state-api(\/|$)/, why: 'state-api router (server-only)' },
      { re: /(^|\/)read-plane\/report-parser(\/|$)/, why: 'report parser (node)' },
      { re: /(^|\/)factory-persistence(\/|$)/, why: 'factory persistence store' },
      { re: /(^|\/)layer-\d/, why: 'a factory layer' },
    ];
    for (const f of files) {
      const rel = f.replace(__dirname, '');
      for (const spec of specifiers(stripComments(readFileSync(f, 'utf8')))) {
        for (const { re, why } of forbidden) {
          expect({ file: rel, spec, hit: re.test(spec), why }).toEqual({ file: rel, spec, hit: false, why });
        }
      }
    }
  });

  it('the ONLY read-plane specifier allowed is read-plane/contracts (the pure zod schemas)', () => {
    for (const f of files) {
      const rel = f.replace(__dirname, '');
      for (const spec of specifiers(stripComments(readFileSync(f, 'utf8')))) {
        if (spec.includes('read-plane')) {
          expect({ file: rel, spec, ok: /(^|\/)read-plane\/contracts(\/|$)/.test(spec) }).toEqual({ file: rel, spec, ok: true });
        }
      }
    }
  });

  it('the client holds no write/mint/gate/execute path — GET is its only verb', () => {
    const forbidden = [
      /\bmintConsumedApproval\b/,
      /\bAPPROVAL_BRAND\b/,
      /\bapprovalWrite\b/,
      /\bexecuteFilesystemPlan\b/,
      /method\s*:\s*['"](POST|PUT|DELETE|PATCH)['"]/i,
      /\bwriteFile\s*\(/,
      /\bappendFile\s*\(/,
    ];
    for (const f of files) {
      const rel = f.replace(__dirname, '');
      const s = stripComments(readFileSync(f, 'utf8'));
      for (const re of forbidden) {
        expect({ file: rel, pattern: String(re), hit: re.test(s) }).toEqual({ file: rel, pattern: String(re), hit: false });
      }
    }
  });
});
