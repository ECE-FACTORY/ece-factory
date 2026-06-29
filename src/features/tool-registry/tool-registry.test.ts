import { describe, it, expect } from 'vitest';
import {
  InMemoryToolRegistry,
  createDefaultToolRegistry,
  ToolNotRegisteredError,
  ToolRegistrationError,
  type ToolDefinition,
  type ToolRegistryReader,
  type RiskClassification,
} from './tool-registry.js';

// Tool Registry (Module 21). Pure-logic tests (in-memory, config-driven — see feature file).
// No DB: the registry is a declared catalog, not user-mutated runtime state.

function readTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'search_clients', purpose: 'read clients', readOrWrite: 'read', classification: 'READ_ONLY',
    permissionLevel: 'read', requiredRole: 'user', approvalRequired: false, serverSideRedaction: true,
    auditBehavior: 'write-ahead audited', blastRadius: 0, reversible: 'yes', idempotent: true,
    environments: ['local'], owner: 'ECE', status: 'enabled', ...overrides,
  };
}

// Stand-in for how Module 22 (Permission Engine) will consume the registry: it depends on the
// READER interface and looks up classification. An unregistered tool makes this throw → deny.
function classificationFor(reg: ToolRegistryReader, name: string): RiskClassification {
  return reg.require(name).classification;
}

describe('Tool Registry — no hidden tools', () => {
  it('registers and looks up a valid tool', () => {
    const r = new InMemoryToolRegistry();
    r.register(readTool());
    expect(r.has('search_clients')).toBe(true);
    expect(r.require('search_clients').classification).toBe('READ_ONLY');
    expect(r.list()).toHaveLength(1);
  });

  it('rejects a tool with an invalid/missing risk classification (§13 integrity)', () => {
    const r = new InMemoryToolRegistry();
    expect(() => r.register(readTool({ classification: 'NONSENSE' as RiskClassification }))).toThrow(ToolRegistrationError);
    expect(r.has('search_clients')).toBe(false); // nothing registered
  });

  it('rejects a duplicate registration', () => {
    const r = new InMemoryToolRegistry();
    r.register(readTool());
    expect(() => r.register(readTool())).toThrow(ToolRegistrationError);
  });

  it('rejects a write tool that does not declare blastRadius=1', () => {
    const r = new InMemoryToolRegistry();
    expect(() => r.register(readTool({ name: 'update_client', readOrWrite: 'write', classification: 'WRITE_LOW_RISK', blastRadius: 100 }))).toThrow(ToolRegistrationError);
  });

  it('unknown-tool lookup FAILS CLOSED (the no-hidden-tools guarantee)', () => {
    const r = new InMemoryToolRegistry();
    expect(r.has('ghost_tool')).toBe(false);
    expect(() => r.require('ghost_tool')).toThrow(ToolNotRegisteredError);
  });

  it('the consumer reader interface forces deny on an unregistered tool', () => {
    const reg = createDefaultToolRegistry();
    // registered → returns its classification
    expect(classificationFor(reg, 'search_clients')).toBe('READ_ONLY');
    // unregistered → throws (a Permission Engine built on this is forced to deny)
    expect(() => classificationFor(reg, 'delete_everything')).toThrow(ToolNotRegisteredError);
  });

  it('the default registry seeds the Phase-1 read-only tool', () => {
    const reg = createDefaultToolRegistry();
    expect(reg.has('search_clients')).toBe(true);
    expect(reg.require('search_clients').readOrWrite).toBe('read');
  });
});
