import { describe, it, expect } from 'vitest';
import { LiveGitHubRepoAdapter } from './live-github-adapter.js';
import type { ExternalTarget } from '../layer-5-action/mcp-bridge/external-tools.js';

// OPT-IN real-API test — SKIPPED by default. It runs ONLY when the human sets ECE_LIVE_GITHUB_TEST=1 AND
// provides ECE_GITHUB_TOKEN. It creates a clearly-named THROWAWAY repo via the real GitHub API, then prints
// deletion instructions — it does NOT auto-delete (a hard-delete is itself a gated destructive action the
// human must perform). The DEFAULT suite NEVER creates a real repo and NEVER touches the network.
const LIVE = process.env.ECE_LIVE_GITHUB_TEST === '1' && !!process.env.ECE_GITHUB_TOKEN;

describe.skipIf(!LIVE)('Phase 9.4 — OPT-IN live GitHub test (real repo; human-initiated)', () => {
  it('creates a throwaway repo via the real path and reports it for manual deletion', async () => {
    const org = process.env.ECE_GITHUB_TEST_ORG; // optional; falls back to the authenticated user's account
    const name = `ece-factory-livewire-test-${Date.now()}`;
    const adapter = new LiveGitHubRepoAdapter({ token: String(process.env.ECE_GITHUB_TOKEN) });
    const target: ExternalTarget = { system: 'github', targetId: org ? `${org}/${name}` : name, effect: `create throwaway repo ${name}`, reversible: 'soft-only' };
    const out = await adapter.createGithubRepo(target, { private: true, description: 'ECE Factory live-wiring opt-in test — safe to delete' });
    expect(out).toMatchObject({ created: true, apiCalled: true });
    process.stdout.write(`\n[opt-in live test] CREATED ${String(out.repo)} (${String(out.htmlUrl)}) — DELETE IT MANUALLY when done.\n`);
  });
});
