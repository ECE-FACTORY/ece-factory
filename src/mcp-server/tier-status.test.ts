import { describe, it, expect } from 'vitest';
import { buildTierStatusReport, deriveBacking, CORE_TABLES, type TierWiring, type DbProbe } from './tier-status.js';
import { LiveFactoryReadPorts } from './live-read-adapters.js';
import { LiveWriteStores } from './live-write-adapters.js';

// Tier-Status Reporter (Phase 9.2) — pure-logic. The CORE: status is derived from the REAL injected object's
// class (instanceof a live adapter), never a label — so a fake can never be reported as live.

const counts = { read_only: 16, draft_only: 7, internal_write: 6, external: 6, forbidden: 6 };
function wiring(over: Partial<TierWiring> = {}): TierWiring {
  return { readRole: 'ece_app', writeRole: 'ece_writer', toolCounts: counts, ...over };
}
// minimal stand-ins to construct the real live adapters (their internals aren't exercised here)
const liveRead = new LiveFactoryReadPorts({ toolRegistry: { has: () => false, require: () => { throw new Error(); }, list: () => [] }, riskStore: { list: async () => [] }, domainStore: { list: async () => [] }, projectStore: { list: async () => [] }, auditReader: { readEntries: async () => [] }, doc: async () => ({}) });
const liveWrite = new LiveWriteStores({ query: async () => ({ rows: [{}] }) } as never);

// fakes — plain objects / closures, exactly as server.ts injects for draft + external
const fakeDraft = { nextPrompt: async () => ({}) };
const fakeExternal = { openPullRequest: async () => ({}) };

describe('Tier-Status — a fake is NEVER reported as live; live is derived from the real injection (the core)', () => {
  it('with fakes injected ⇒ draft: fake, external: fake', async () => {
    const r = await buildTierStatusReport(wiring({ draftPorts: fakeDraft, externalSystems: fakeExternal, factoryPorts: liveRead, writeStores: liveWrite }));
    expect(r.tiers.draft_only).toBe('fake');
    expect(r.tiers.external).toBe('fake');
  });
  it('with live adapters injected ⇒ read_only: live, internal_write: live', async () => {
    const r = await buildTierStatusReport(wiring({ factoryPorts: liveRead, writeStores: liveWrite, draftPorts: fakeDraft, externalSystems: fakeExternal }));
    expect(r.tiers.read_only).toBe('live');
    expect(r.tiers.internal_write).toBe('live');
  });
  it('a fake injected in the READ_ONLY slot is reported fake — it cannot claim live', async () => {
    const fakeReads = { factoryStatus: async () => ({}) }; // a plain fake, not LiveFactoryReadPorts
    const r = await buildTierStatusReport(wiring({ factoryPorts: fakeReads, writeStores: liveWrite }));
    expect(r.tiers.read_only).toBe('fake'); // derived from instanceof — a fake can never be live
  });
  it('an unwired tier ⇒ not-wired', async () => {
    const r = await buildTierStatusReport(wiring({}));
    expect(r.tiers.read_only).toBe('not-wired');
    expect(r.tiers.internal_write).toBe('not-wired');
  });
  it('deriveBacking: instanceof a live class ⇒ live; plain object ⇒ fake; undefined ⇒ not-wired', () => {
    expect(deriveBacking(liveWrite, [LiveWriteStores])).toBe('live');
    expect(deriveBacking({}, [LiveWriteStores])).toBe('fake');
    expect(deriveBacking(undefined, [LiveWriteStores])).toBe('not-wired');
    // even an object carrying a forged label cannot be reported live
    expect(deriveBacking({ backing: 'live' } as object, [LiveWriteStores])).toBe('fake');
  });
});

describe('Tier-Status — FORBIDDEN reported as registered-and-refused', () => {
  it('forbidden tier is a fixed status', async () => {
    const r = await buildTierStatusReport(wiring({ factoryPorts: liveRead, writeStores: liveWrite }));
    expect(r.tiers.forbidden).toBe('registered-and-refused');
  });
});

describe('Tier-Status — observational: no DB probe ⇒ no I/O, reachability unknown', () => {
  it('without a probe, the reporter does no DB I/O and reports unknown', async () => {
    const r = await buildTierStatusReport(wiring({ factoryPorts: liveRead, writeStores: liveWrite }));
    expect(r.database.reachable).toBe('unknown');
    expect(r.database.coreTablesPresent).toBe('unknown');
    expect(r.database.coreTablesExpected).toBe(CORE_TABLES.length);
  });
  it('a failing probe is honestly "not reachable" — never assumed live', async () => {
    const badProbe: DbProbe = async () => { throw new Error('cannot connect'); };
    const r = await buildTierStatusReport(wiring({ factoryPorts: liveRead, writeStores: liveWrite }), badProbe);
    expect(r.database.reachable).toBe(false);
  });
});

describe('Tier-Status — NO secrets in the output (role names / booleans / counts / backings only)', () => {
  it('the serialized report contains no connection string, password, or principal-email value', async () => {
    const probe: DbProbe = async () => ({ reachable: true, coreTablesPresent: 12 });
    const r = await buildTierStatusReport(wiring({ factoryPorts: liveRead, writeStores: liveWrite, draftPorts: fakeDraft, externalSystems: fakeExternal }), probe);
    const json = JSON.stringify(r);
    // no credential VALUES: connection strings, passwords, user:pass@host, or an email-address value
    expect(json).not.toMatch(/postgres:\/\/|password|passwd|PGPASSWORD|:\/\/[^"]*:[^"]*@|@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(r.dbRoles).toEqual({ read: 'ece_app', write: 'ece_writer' }); // role NAMES only
    expect(r.claudeCodeRegistration).toBe('unknown/external');           // honest about what it can't introspect
    expect(r.database.persistenceKnown).toBe(false);
  });
});
