import { describe, it, expect } from 'vitest';
import { PermissionEngine } from './permission-engine.js';
import { createDefaultToolRegistry, type ToolDefinition } from '../../layer-5-action/tool-registry/tool-registry.js';
import type { AuthorizationRequest } from '../../factory-shared/audit-engine/sequencer.js';

// Permission Engine (Module 22) — decision matrix. Pure-logic: the decision is a pure function of
// (registry entry, principal role, environment), so no DB is needed here (integration is separate).

function tool(overrides: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: 'x', purpose: 'p', readOrWrite: 'read', classification: 'READ_ONLY', permissionLevel: 'read',
    requiredRole: 'user', approvalRequired: false, serverSideRedaction: true, auditBehavior: 'audited',
    blastRadius: 0, reversible: 'yes', idempotent: true, environments: ['local'], owner: 'ECE', status: 'enabled',
    ...overrides,
  };
}

const registry = createDefaultToolRegistry(); // seeds search_clients (READ_ONLY, requiredRole user)
registry.register(tool({ name: 'admin_read', requiredRole: 'admin' }));
registry.register(tool({ name: 'approval_tool', readOrWrite: 'write', classification: 'WRITE_LOW_RISK', blastRadius: 1, approvalRequired: true }));
registry.register(tool({ name: 'critical_tool', readOrWrite: 'write', classification: 'DESTRUCTIVE_ACTION', blastRadius: 1 }));
registry.register(tool({ name: 'staging_only', environments: ['staging'] }));
registry.register(tool({ name: 'disabled_tool', status: 'disabled' }));

const engine = new PermissionEngine(registry);

function req(toolName: string, role: string, environment: 'local' | 'staging' | 'production' = 'local'): AuthorizationRequest {
  return { human_actor: { user_id: 'u', email: 'u@ece.ae', role }, organization_id: 'org', tool: { name: toolName }, environment };
}
const decide = (t: string, role: string, env: 'local' | 'staging' | 'production' = 'local') => engine.authorize(req(t, role, env)).then((d) => d.decision);

describe('Permission Engine — decision matrix (deny-by-default)', () => {
  it('unknown tool ⇒ REFUSE (fail-closed via the registry)', async () => {
    expect(await decide('ghost_tool', 'admin')).toBe('REFUSE');
  });
  it('insufficient role ⇒ REFUSE', async () => {
    expect(await decide('admin_read', 'user')).toBe('REFUSE');
  });
  it('sufficient role ⇒ ALLOW', async () => {
    expect(await decide('admin_read', 'admin')).toBe('ALLOW');
  });
  it('approval-required tool ⇒ STOP_FOR_APPROVAL', async () => {
    expect(await decide('approval_tool', 'user')).toBe('STOP_FOR_APPROVAL');
  });
  it('critical classification ⇒ STOP_FOR_APPROVAL', async () => {
    expect(await decide('critical_tool', 'user')).toBe('STOP_FOR_APPROVAL');
  });
  it('tool not available in environment ⇒ REFUSE', async () => {
    expect(await decide('staging_only', 'user', 'local')).toBe('REFUSE');
    expect(await decide('staging_only', 'user', 'staging')).toBe('ALLOW');
  });
  it('disabled tool ⇒ REFUSE', async () => {
    expect(await decide('disabled_tool', 'user')).toBe('REFUSE');
  });
  it('allowed read ⇒ ALLOW', async () => {
    expect(await decide('search_clients', 'user')).toBe('ALLOW');
  });
  it('unknown principal role ⇒ REFUSE (deny-by-default)', async () => {
    expect(await decide('search_clients', 'stranger')).toBe('REFUSE');
  });
});
