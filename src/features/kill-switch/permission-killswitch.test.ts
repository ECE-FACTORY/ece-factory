import { describe, it, expect } from 'vitest';
import { InMemoryKillSwitch } from './kill-switch.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { createDefaultToolRegistry, type ToolDefinition } from '../tool-registry/tool-registry.js';
import type { AuthorizationRequest } from '../audit-engine/sequencer.js';

// Kill-switch ⨉ Permission Engine — precedence (kill beats ALLOW and STOP) and immediacy.
// Pure-logic: these are decision outcomes, no DB.

function tool(overrides: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: 'x', purpose: 'p', readOrWrite: 'read', classification: 'READ_ONLY', permissionLevel: 'read',
    requiredRole: 'user', approvalRequired: false, serverSideRedaction: true, auditBehavior: 'audited',
    blastRadius: 0, reversible: 'yes', idempotent: true, environments: ['local'], owner: 'ECE', status: 'enabled',
    ...overrides,
  };
}

const registry = createDefaultToolRegistry(); // search_clients READ_ONLY (would ALLOW)
registry.register(tool({ name: 'approval_tool', readOrWrite: 'write', classification: 'WRITE_LOW_RISK', blastRadius: 1, approvalRequired: true })); // would STOP_FOR_APPROVAL
registry.register(tool({ name: 'write_tool', readOrWrite: 'write', classification: 'WRITE_LOW_RISK', blastRadius: 1 })); // would ALLOW

const ks = new InMemoryKillSwitch();
const engine = new PermissionEngine(registry, { killSwitch: ks });

function req(toolName: string, extra: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return { human_actor: { user_id: 'u', email: 'u@ece.ae', role: 'user' }, organization_id: 'org', tool: { name: toolName }, environment: 'local', ...extra };
}
const decide = (toolName: string, extra?: Partial<AuthorizationRequest>) => engine.authorize(req(toolName, extra)).then((d) => d.decision);

describe('Kill switch precedence — kill beats everything', () => {
  it('a killed tool that would be ALLOW is REFUSED', async () => {
    expect(await decide('search_clients')).toBe('ALLOW');
    ks.activate({ type: 'tool', name: 'search_clients' }, 'admin', 'incident');
    expect(await decide('search_clients')).toBe('REFUSE'); // kill beats ALLOW
    ks.deactivate({ type: 'tool', name: 'search_clients' }, 'admin', 'resolved');
  });
  it('a killed tool that would be STOP_FOR_APPROVAL is REFUSED', async () => {
    expect(await decide('approval_tool')).toBe('STOP_FOR_APPROVAL');
    ks.activate({ type: 'tool', name: 'approval_tool' }, 'admin', 'incident');
    expect(await decide('approval_tool')).toBe('REFUSE'); // kill beats STOP_FOR_APPROVAL
    ks.deactivate({ type: 'tool', name: 'approval_tool' }, 'admin', 'resolved');
  });
});

describe('Kill switch immediacy through the engine', () => {
  it('flipping the switch flips the very next decision (no restart)', async () => {
    expect(await decide('search_clients')).toBe('ALLOW');
    ks.activate({ type: 'bridge' }, 'admin', 'full stop');
    expect(await decide('search_clients')).toBe('REFUSE'); // immediately
    ks.deactivate({ type: 'bridge' }, 'admin', 'all clear');
    expect(await decide('search_clients')).toBe('ALLOW'); // immediately
  });
});

describe('Kill switch scopes via the engine', () => {
  it('all-writes kill refuses a write tool but not a read tool', async () => {
    ks.activate({ type: 'all-writes' }, 'admin', 'freeze');
    expect(await decide('write_tool')).toBe('REFUSE');
    expect(await decide('search_clients')).toBe('ALLOW'); // reads still flow
    ks.deactivate({ type: 'all-writes' }, 'admin', 'thaw');
  });
  it('environment / connector / autopilot kills refuse via the request scope', async () => {
    ks.activate({ type: 'environment', env: 'local' }, 'admin', 'env down');
    expect(await decide('search_clients')).toBe('REFUSE');
    ks.deactivate({ type: 'environment', env: 'local' }, 'admin', 'env up');

    ks.activate({ type: 'connector', id: 'c9' }, 'admin', 'bad connector');
    expect(await decide('search_clients', { connector: 'c9' })).toBe('REFUSE');
    expect(await decide('search_clients', { connector: 'c1' })).toBe('ALLOW');
    ks.deactivate({ type: 'connector', id: 'c9' }, 'admin', 'fixed');

    ks.activate({ type: 'autopilot' }, 'admin', 'pause');
    expect(await decide('search_clients', { autopilot: true })).toBe('REFUSE');
    expect(await decide('search_clients', { autopilot: false })).toBe('ALLOW');
    ks.deactivate({ type: 'autopilot' }, 'admin', 'resume');
  });
});
