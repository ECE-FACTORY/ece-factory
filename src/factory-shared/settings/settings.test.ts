import { describe, it, expect } from 'vitest';
import { SettingsRegistry, crossesGuardFloor, DEFAULT_FACTORY_SETTINGS, type SettingDefinition } from './settings.js';

// Settings (Module 25) — pure-logic: the typed model, the read/change tier mapping, deny-by-default, the
// SECURITY_CRITICAL floor, and THE HARD FLOOR (no setting can disable/weaken a guard).

const reg = new SettingsRegistry(DEFAULT_FACTORY_SETTINGS);

describe('Settings — tier mapping (read vs change)', () => {
  it('reading is READ_ONLY; changing is APPROVAL_REQUIRED_WRITE', () => {
    expect(reg.tierForRead()).toBe('READ_ONLY');
    expect(reg.tierForChange()).toBe('APPROVAL_REQUIRED_WRITE');
  });
});

describe('Settings — deny-by-default', () => {
  it('an unknown key ⇒ rejected (not silently created)', () => {
    const r = reg.validate('totally.unknown', 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unknown setting key/);
  });
  it('an invalid value for the key type ⇒ rejected', () => {
    expect(reg.validate('harvest.min_score', 'not-a-number' as unknown as number).ok).toBe(false);
    expect(reg.validate('reporting.timezone', 123 as unknown as string).ok).toBe(false);
  });
  it('a value not in allowedValues ⇒ rejected', () => {
    expect(reg.validate('project.default_environment', 'mars').ok).toBe(false);
    expect(reg.validate('project.default_environment', 'production').ok).toBe(true);
  });
  it('a valid OPERATIONAL change validates', () => {
    expect(reg.validate('harvest.min_score', 80).ok).toBe(true);
  });
});

describe('Settings — THE HARD FLOOR: no setting can disable/weaken a guard (the core)', () => {
  it('guard-disabling keys are UNREPRESENTABLE — not in the registry (deny-by-default rejects them)', () => {
    for (const k of ['audit.enabled', 'redaction.enabled', 'kill_switch.enabled', 'kill_switch.disabled', 'approval.required', 'permission.enforce', 'tool.force_delete_repo.forbidden']) {
      expect(reg.has(k)).toBe(false);
      const r = reg.validate(k, false);
      expect(r.ok, k).toBe(false); // rejected — cannot turn off a guard via settings
    }
  });
  it('crossesGuardFloor refuses any guard-subsystem key set to a disabling value', () => {
    expect(crossesGuardFloor('audit.enabled', false)).toBe(true);
    expect(crossesGuardFloor('audit.retention_days', 0)).toBe(true);
    expect(crossesGuardFloor('redaction.mode', 'off')).toBe(true);
    expect(crossesGuardFloor('kill-switch.active', 'disabled')).toBe(true);
    expect(crossesGuardFloor('approval.required', false)).toBe(true);
    expect(crossesGuardFloor('permission.enforce', 'bypass')).toBe(true);
    expect(crossesGuardFloor('tool.x.forbidden', false)).toBe(true);
    // a non-guard operational key is NOT floored
    expect(crossesGuardFloor('harvest.min_score', 0)).toBe(false);
    expect(crossesGuardFloor('reporting.timezone', 'off')).toBe(false);
  });
  it('a registered SECURITY_CRITICAL key cannot cross into a guarantee-weakening value', () => {
    // audit retention can be tuned, but never to 0 (which would weaken audit)
    expect(reg.validate('audit.retention_days', 90).ok).toBe(true);
    expect(reg.validate('audit.retention_days', 0).ok).toBe(false);
    // redaction strictness can be tuned, but "off" is not allowed
    expect(reg.validate('redaction.mode', 'strict').ok).toBe(true);
    expect(reg.validate('redaction.mode', 'off').ok).toBe(false);
    // approval window can be tuned, but never 0 (which would disable approval)
    expect(reg.validate('approval.window_minutes', 30).ok).toBe(true);
    expect(reg.validate('approval.window_minutes', 0).ok).toBe(false);
  });
});

describe('Settings — classification', () => {
  it('OPERATIONAL vs SECURITY_CRITICAL are correctly assigned', () => {
    expect(reg.get('harvest.min_score')!.classification).toBe('OPERATIONAL');
    expect(reg.get('audit.retention_days')!.classification).toBe('SECURITY_CRITICAL');
    expect(reg.get('redaction.mode')!.classification).toBe('SECURITY_CRITICAL');
  });
  it('a SECURITY_CRITICAL fixture key still cannot be floored below the guarantee', () => {
    const r = new SettingsRegistry([
      ...DEFAULT_FACTORY_SETTINGS,
      { key: 'audit.mode', type: 'enum', scope: 'factory-wide', classification: 'SECURITY_CRITICAL', default: 'on', allowedValues: ['on', 'verbose'] } as SettingDefinition,
    ]);
    // even though 'off' isn't in allowedValues, the floor independently refuses turning audit off
    expect(r.validate('audit.mode', 'off').ok).toBe(false);
    expect(r.validate('audit.mode', 'verbose').ok).toBe(true);
  });
});
