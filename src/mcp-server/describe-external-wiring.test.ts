import { describe, it, expect } from 'vitest';
import { describeExternalWiring } from './server.js';
import type { ExternalAction } from './tier-status.js';

// Wave 6 Piece 1e follow-up (b) — the startup banner reflects the ACTUAL per-action external wiring (from the
// same tier-status source /healthz uses), never a hard-coded string. It must never claim live when fake, or
// fake when live.

const ALL: ExternalAction[] = ['create_github_repo', 'open_pull_request', 'create_ticket', 'update_crm_record', 'send_email', 'deploy_package'];
function backing(live: ExternalAction[]): Record<ExternalAction, string> {
  return Object.fromEntries(ALL.map((a) => [a, live.includes(a) ? 'live' : 'fake'])) as Record<ExternalAction, string>;
}

describe('describeExternalWiring — honest per-action live/fake (never live-when-fake or fake-when-live)', () => {
  it('reports the live actions as live and the rest as fake (mixed wiring)', () => {
    const s = describeExternalWiring(backing(['create_github_repo', 'create_ticket']));
    expect(s).toMatch(/live: create_github_repo, create_ticket/);
    expect(s).toMatch(/fake: /);
    // no live action leaks into the fake list, and no fake action into the live list
    const [livePart, fakePart] = s.split(' · ');
    for (const a of ['create_github_repo', 'create_ticket']) { expect(livePart).toContain(a); expect(fakePart ?? '').not.toContain(a); }
    for (const a of ['open_pull_request', 'update_crm_record', 'send_email', 'deploy_package']) { expect(fakePart).toContain(a); expect(livePart).not.toContain(a); }
  });
  it('all fake ⇒ "live: none" and every action listed as fake', () => {
    const s = describeExternalWiring(backing([]));
    expect(s).toMatch(/^live: none/);
    for (const a of ALL) expect(s).toContain(a);
  });
  it('all live ⇒ every action live, no fake segment', () => {
    const s = describeExternalWiring(backing(ALL));
    expect(s).not.toMatch(/fake:/);
    for (const a of ALL) expect(s).toContain(a);
  });
});
