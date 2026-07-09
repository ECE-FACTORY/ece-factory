// Unit tests for Repo Scout Signals — NO NETWORK, NO TOKEN. Pure derivations are tested directly; the
// gather() path uses an injected fake fetch. A green run proves the confidence contract and fail-closed
// behaviour WITHOUT any real GitHub access (the live path is repo-scout-signals.live.test.ts).

import { describe, it, expect } from 'vitest';
import {
  RepoScoutSignals,
  deriveMaintainability, deriveArchitecture, deriveAirGap, deriveWhiteLabel,
  deriveCloudNative, deriveBillingHooks, deriveMultiTenancy,
  parseManifestDeps, detectCloudBlockers, analyzeTree, parseLastPage, daysSince,
  analyzeCloudNativeTree, detectCloudNativeSdks, detectBillingSdks, tenantHintsFromTree,
} from './repo-scout-signals.js';

// ── Subscription-mode dimensions: the honesty contract — NOTHING is 'measured' from ABSENCE ────────────────
describe('confidence contract — cloud-native (measured ONLY from present artifacts; never "poor" from absence)', () => {
  it('Dockerfile + orchestration ⇒ strong, MEASURED', () => {
    expect(deriveCloudNative({ hasDockerfile: true, hasCompose: false, hasOrchestration: true, cloudSdks: [] })).toMatchObject({ value: 'strong', confidence: 'measured' });
  });
  it('Dockerfile only (no orchestration) ⇒ partial, MEASURED', () => {
    expect(deriveCloudNative({ hasDockerfile: true, hasCompose: false, hasOrchestration: false, cloudSdks: [] })).toMatchObject({ value: 'partial', confidence: 'measured' });
  });
  it('cloud infra SDK only ⇒ partial, MEASURED', () => {
    expect(deriveCloudNative({ hasDockerfile: false, hasCompose: false, hasOrchestration: false, cloudSdks: ['AWS SDK'] })).toMatchObject({ value: 'partial', confidence: 'measured' });
  });
  it('NOTHING found ⇒ not-mechanizable/unknown — NEVER "poor" (absence is not proof)', () => {
    const s = deriveCloudNative({ hasDockerfile: false, hasCompose: false, hasOrchestration: false, cloudSdks: [] });
    expect(s).toMatchObject({ value: 'unknown', confidence: 'not-mechanizable' });
    expect(s.value).not.toBe('poor');
    expect(s.confidence).not.toBe('measured');
  });
});

describe('confidence contract — billing (partial from a dep; NEVER native/measured from a dep alone)', () => {
  it('billing SDK present ⇒ integratable, PARTIAL (a dep proves a hook exists, not subscription-grade)', () => {
    const s = deriveBillingHooks({ billingSdks: ['Stripe'] });
    expect(s).toMatchObject({ value: 'integratable', confidence: 'partial' });
    expect(s.value).not.toBe('native');
    expect(s.confidence).not.toBe('measured');
  });
  it('no billing SDK ⇒ not-mechanizable/unknown — NEVER "none" from absence', () => {
    const s = deriveBillingHooks({ billingSdks: [] });
    expect(s).toMatchObject({ value: 'unknown', confidence: 'not-mechanizable' });
    expect(s.value).not.toBe('none');
  });
});

describe('confidence contract — multi-tenancy (ALWAYS not-mechanizable; the subscription analog of air-gap)', () => {
  it('no hints ⇒ not-mechanizable/unknown', () => {
    expect(deriveMultiTenancy({ tenantHints: [] })).toMatchObject({ value: 'unknown', confidence: 'not-mechanizable' });
  });
  it('EVEN WITH tenant hints ⇒ still not-mechanizable, hints noted but never scored/measured', () => {
    const s = deriveMultiTenancy({ tenantHints: ['src/tenant/isolation.ts', 'db/multitenant.sql'] });
    expect(s).toMatchObject({ value: 'unknown', confidence: 'not-mechanizable' });
    expect(s.evidence.join(' ')).toMatch(/weak hints only \(NOT scored\)/);
  });
});

describe('subscription-dimension analyzers/detectors (pure)', () => {
  it('analyzeCloudNativeTree detects Dockerfile / compose / k8s+helm; empty tree ⇒ all false', () => {
    expect(analyzeCloudNativeTree(['Dockerfile', 'docker-compose.yml', 'k8s/deployment.yaml', 'helm/Chart.yaml'])).toEqual({ hasDockerfile: true, hasCompose: true, hasOrchestration: true });
    expect(analyzeCloudNativeTree(['src/index.ts', 'README.md'])).toEqual({ hasDockerfile: false, hasCompose: false, hasOrchestration: false });
  });
  it('detectCloudNativeSdks / detectBillingSdks find named deps; absence ⇒ empty (no fabrication)', () => {
    expect(detectCloudNativeSdks(['@aws-sdk/client-s3'], '')).toContain('AWS SDK');
    expect(detectCloudNativeSdks(['lodash'], '')).toEqual([]);
    expect(detectBillingSdks(['stripe'], '')).toContain('Stripe');
    expect(detectBillingSdks(['lodash'], '')).toEqual([]);
  });
  it('tenantHintsFromTree collects weak path hints only', () => {
    expect(tenantHintsFromTree(['src/tenant/x.ts', 'README.md'])).toEqual(['src/tenant/x.ts']);
  });
});

describe('confidence contract — maintainability (always measured from real facts)', () => {
  it('recent + many contributors + CI + tests ⇒ clean', () => {
    const s = deriveMaintainability({ commitRecencyDays: 14, contributors: 8, openIssues: 12, releases: 5, hasTests: true, hasCI: true });
    expect(s).toMatchObject({ value: 'clean', confidence: 'measured' });
    expect(s.evidence.join(' ')).toMatch(/14d ago/);
  });
  it('archived ⇒ unsafe', () => {
    expect(deriveMaintainability({ hasTests: false, hasCI: false, archived: true }).value).toBe('unsafe');
  });
  it('stale + solo + no CI ⇒ hard', () => {
    expect(deriveMaintainability({ commitRecencyDays: 500, contributors: 1, hasTests: true, hasCI: false }).value).toBe('hard');
  });
  it('active but unremarkable ⇒ maintainable', () => {
    expect(deriveMaintainability({ commitRecencyDays: 120, contributors: 3, hasTests: true, hasCI: true }).value).toBe('maintainable');
  });
});

describe('confidence contract — architecture (measured/partial/not-mechanizable; never strong)', () => {
  it('manifest readable + modular + light deps ⇒ good @ measured', () => {
    const s = deriveArchitecture({ manifestReadable: true, treeReadable: true, primaryLanguage: 'TypeScript', dependencyCount: 12, modular: true });
    expect(s).toMatchObject({ value: 'good', confidence: 'measured' });
  });
  it('never emits "strong" mechanically — even a modular, tiny-dep repo caps at good', () => {
    const s = deriveArchitecture({ manifestReadable: true, treeReadable: true, dependencyCount: 1, modular: true });
    expect(s.value).not.toBe('strong');
  });
  it('tree only (no manifest) ⇒ partial confidence', () => {
    expect(deriveArchitecture({ manifestReadable: false, treeReadable: true, modular: false }).confidence).toBe('partial');
  });
  it('neither manifest nor tree ⇒ not-mechanizable / unknown', () => {
    expect(deriveArchitecture({ manifestReadable: false, treeReadable: false })).toMatchObject({ value: 'unknown', confidence: 'not-mechanizable' });
  });
});

describe('confidence contract — air-gap (PARTIAL by nature; never yes/measured from manifest)', () => {
  it('cloud blocker found ⇒ no @ partial', () => {
    const s = deriveAirGap({ manifestReadable: true, cloudBlockers: ['AWS SDK'] });
    expect(s).toMatchObject({ value: 'no', confidence: 'partial' });
  });
  it('no blocker found ⇒ still only partial/partial (absence is not proof) — NEVER yes/measured', () => {
    const s = deriveAirGap({ manifestReadable: true, cloudBlockers: [] });
    expect(s.value).toBe('partial');
    expect(s.confidence).toBe('partial');
    expect(s.value).not.toBe('yes');
    expect(s.confidence).not.toBe('measured');
  });
  it('no manifest ⇒ not-mechanizable', () => {
    expect(deriveAirGap({ manifestReadable: false, cloudBlockers: [] }).confidence).toBe('not-mechanizable');
  });
});

describe('confidence contract — white-label (not-mechanizable; no fabricated score)', () => {
  it('always not-mechanizable / unknown, even with weak branding hits', () => {
    const s = deriveWhiteLabel({ brandingHits: ['TRADEMARK.md'] });
    expect(s).toMatchObject({ value: 'unknown', confidence: 'not-mechanizable' });
    expect(s.evidence.join(' ')).toMatch(/NOT MECHANIZABLE/i);
  });
});

describe('pure parsers/analyzers', () => {
  it('parseManifestDeps counts package.json / requirements.txt / go.mod', () => {
    expect(parseManifestDeps('package.json', '{"dependencies":{"a":"1","b":"2","c":"3"}}')).toEqual({ count: 3, names: ['a', 'b', 'c'] });
    expect(parseManifestDeps('requirements.txt', 'flask==2.0\n# comment\nrequests>=1\n').count).toBe(2);
    expect(parseManifestDeps('go.mod', 'module x\n\nrequire (\n\tgithub.com/foo/bar v1.2.3\n\tgolang.org/x/net v0.1.0\n)').count).toBe(2);
  });
  it('detectCloudBlockers flags SaaS/cloud/telemetry deps', () => {
    expect(detectCloudBlockers(['aws-sdk', 'lodash'], '')).toEqual(['AWS SDK']);
    expect(detectCloudBlockers([], '"@sentry/node": "^7"')).toContain('Sentry (hosted error telemetry)');
    expect(detectCloudBlockers(['lodash', 'react'], '')).toEqual([]);
  });
  it('analyzeTree detects tests, CI, and modular layout', () => {
    expect(analyzeTree(['package.json', 'src/i.ts', 'test/i.test.ts', '.github/workflows/ci.yml', 'packages/core/i.ts']))
      .toEqual({ hasTests: true, hasCI: true, modular: true });
    expect(analyzeTree(['index.js', 'README.md'])).toEqual({ hasTests: false, hasCI: false, modular: false });
  });
  it('parseLastPage reads the contributors Link header; daysSince computes elapsed days', () => {
    expect(parseLastPage('<https://api.github.com/x?per_page=1&page=2>; rel="next", <https://api.github.com/x?per_page=1&page=8>; rel="last"')).toBe(8);
    expect(parseLastPage(null)).toBeUndefined();
    expect(daysSince('2025-06-01T00:00:00Z', Date.parse('2025-06-15T00:00:00Z'))).toBe(14);
  });
});

// ── gather() with an injected fake fetch (still no real network) ────────────────────────────────────────
interface FakeRoute { ok: boolean; status: number; json?: unknown; text?: string; link?: string }
function makeFetch(route: (url: string) => FakeRoute) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: (init?.headers as Record<string, string>) ?? {} });
    const r = route(u);
    return {
      ok: r.ok, status: r.status,
      json: async () => r.json,
      text: async () => r.text ?? '',
      headers: { get: (k: string) => (k.toLowerCase() === 'link' ? r.link ?? null : null) },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const NOW = () => Date.parse('2025-06-15T00:00:00Z');
const TOKEN = 'SIGNALS_SECRET_TOKEN_xyz';

function healthyRoutes(pkgJson: string) {
  return (url: string): FakeRoute => {
    if (/\/repos\/acme\/pdfkit$/.test(url)) return { ok: true, status: 200, json: { pushed_at: '2025-06-01T00:00:00Z', open_issues_count: 12, language: 'TypeScript', archived: false } };
    if (/\/git\/trees\/main/.test(url)) return { ok: true, status: 200, json: { tree: [{ path: 'package.json' }, { path: 'src/index.ts' }, { path: 'test/index.test.ts' }, { path: '.github/workflows/ci.yml' }, { path: 'packages/core/index.ts' }] } };
    if (/\/contributors/.test(url)) return { ok: true, status: 200, json: [{}], link: '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=8>; rel="last"' };
    if (/\/releases/.test(url)) return { ok: true, status: 200, json: [{}, {}, {}, {}, {}] };
    if (/\/pdfkit\/main\/package\.json$/.test(url)) return { ok: true, status: 200, text: pkgJson };
    return { ok: false, status: 404 };
  };
}

describe('gather() over a fake fetch — emits all four dimensions with honest confidences', () => {
  it('healthy TS repo, clean manifest ⇒ maintainability measured/clean, arch measured/good, air-gap partial, white-label not-mechanizable', async () => {
    const { fetchImpl } = makeFetch(healthyRoutes('{"dependencies":{"a":"1","b":"2"}}'));
    const sig = new RepoScoutSignals({ token: TOKEN, fetchImpl, now: NOW });
    const r = await sig.gather({ owner: 'acme', name: 'pdfkit', branch: 'main' });

    expect(r.status).toBe('OK');
    expect(r.maintainability).toMatchObject({ value: 'clean', confidence: 'measured' });
    expect(r.architecture).toMatchObject({ value: 'good', confidence: 'measured' });
    expect(r.airGap).toMatchObject({ value: 'partial', confidence: 'partial' });
    expect(r.whiteLabel).toMatchObject({ value: 'unknown', confidence: 'not-mechanizable' });
  });

  it('a cloud dependency in the manifest ⇒ air-gap value "no" (traceable to real evidence)', async () => {
    const { fetchImpl } = makeFetch(healthyRoutes('{"dependencies":{"aws-sdk":"2","react":"18"}}'));
    const sig = new RepoScoutSignals({ token: TOKEN, fetchImpl, now: NOW });
    const r = await sig.gather({ owner: 'acme', name: 'pdfkit', branch: 'main' });
    expect(r.airGap.value).toBe('no');
    expect(r.airGap.evidence.join(' ')).toMatch(/AWS SDK/);
  });

  it('REDACTION: the token authenticates API calls but never appears in the output', async () => {
    const { fetchImpl, calls } = makeFetch(healthyRoutes('{"dependencies":{}}'));
    const sig = new RepoScoutSignals({ token: TOKEN, fetchImpl, now: NOW });
    const r = await sig.gather({ owner: 'acme', name: 'pdfkit', branch: 'main' });
    const apiCall = calls.find((c) => c.url.includes('/repos/acme/pdfkit'))!;
    expect(apiCall.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it('a missing manifest DEGRADES confidence (no fabrication): arch partial, air-gap not-mechanizable', async () => {
    // tree present but no package.json ⇒ manifest unreadable.
    const routes = (url: string): FakeRoute => {
      if (/\/repos\/acme\/pdfkit$/.test(url)) return { ok: true, status: 200, json: { pushed_at: '2025-06-01T00:00:00Z', language: 'Go' } };
      if (/\/git\/trees\/main/.test(url)) return { ok: true, status: 200, json: { tree: [{ path: 'main.go' }] } };
      return { ok: false, status: 404 };
    };
    const { fetchImpl } = makeFetch(routes);
    const sig = new RepoScoutSignals({ token: TOKEN, fetchImpl, now: NOW });
    const r = await sig.gather({ owner: 'acme', name: 'pdfkit', branch: 'main' });
    expect(r.status).toBe('OK');
    expect(r.architecture.confidence).toBe('partial');       // tree only
    expect(r.airGap.confidence).toBe('not-mechanizable');    // no manifest to inspect
  });
});

describe('gather() FAIL CLOSED (no fabrication)', () => {
  it('no token ⇒ FAILED_CLOSED, every dimension not-mechanizable, NO fetch attempted', async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; throw new Error('must not be called'); }) as unknown as typeof fetch;
    const sig = new RepoScoutSignals({ fetchImpl });
    const r = await sig.gather({ owner: 'acme', name: 'pdfkit', branch: 'main' });
    expect(r.status).toBe('FAILED_CLOSED');
    expect(r.reason).toMatch(/GITHUB_TOKEN/);
    for (const d of [r.maintainability, r.architecture, r.airGap, r.whiteLabel]) expect(d.confidence).toBe('not-mechanizable');
    expect(called).toBe(false);
  });

  it('network error on the primary repo read ⇒ FAILED_CLOSED, token-free reason', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const sig = new RepoScoutSignals({ token: TOKEN, fetchImpl });
    const r = await sig.gather({ owner: 'acme', name: 'pdfkit', branch: 'main' });
    expect(r.status).toBe('FAILED_CLOSED');
    expect(r.reason).toMatch(/unreachable|error/i);
    expect(r.reason).not.toContain(TOKEN);
  });

  it('repo metadata 404 ⇒ FAILED_CLOSED (nothing to source), no fabricated signals', async () => {
    const { fetchImpl } = makeFetch(() => ({ ok: false, status: 404 }));
    const sig = new RepoScoutSignals({ token: TOKEN, fetchImpl });
    const r = await sig.gather({ owner: 'acme', name: 'ghost', branch: 'main' });
    expect(r.status).toBe('FAILED_CLOSED');
    expect(r.maintainability.value).toBe('unknown');
  });
});
