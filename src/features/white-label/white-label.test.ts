import { describe, it, expect } from 'vitest';
import { assessWhiteLabel, type BrandingElement, type ElementAction } from './white-label.js';

// White-Label Hardening Engine (Module 13). Pure-logic: verdict + actions are a pure function of the elements.

const find = (r: { actions: ElementAction[] }, id: string): ElementAction => r.actions.find((a) => a.id === id)!;

describe('White-Label — per-element classification', () => {
  it('a replaceable element (logo / product name) ⇒ replace action', () => {
    const r = assessWhiteLabel([
      { id: 'logo.svg', category: 'replaceable' },
      { id: 'product-name', category: 'replaceable' },
    ]);
    expect(find(r, 'logo.svg').action).toBe('replace');
    expect(find(r, 'product-name').directive).toMatch(/replace.*ECE/i);
    expect(r.verdict).toBe('Ready-after-stripping');
  });

  it('telemetry / analytics ⇒ disable action', () => {
    const r = assessWhiteLabel([{ id: 'analytics-key', category: 'disable' }]);
    expect(find(r, 'analytics-key').action).toBe('disable');
  });

  it('an unclassified element ⇒ trademark-caution / needs-review (deny-by-default)', () => {
    const r = assessWhiteLabel([{ id: 'mystery-string' }]); // no category
    const a = find(r, 'mystery-string');
    expect(a.category).toBe('trademark-caution');
    expect(a.action).toBe('review');
    expect(a.directive).toMatch(/unclassified/i);
    expect(r.verdict).toBe('Ready-after-stripping'); // never silently Ready
  });
});

describe('White-Label — legal core (must-keep never stripped)', () => {
  it('a must-keep license notice ⇒ preserve, present in the action list, NEVER stripped', () => {
    const r = assessWhiteLabel([{ id: 'apache-NOTICE', category: 'must-keep' }]);
    const a = find(r, 'apache-NOTICE');
    expect(a.action).toBe('preserve');
    expect(a.directive).toMatch(/preserve/i);
    expect(r.verdict).toBe('Ready'); // only must-keep, nothing to strip
  });

  it('white-labeling that would require removing a required attribution ⇒ Blocked-by-legal-obligation (not a strip)', () => {
    const r = assessWhiteLabel([
      { id: 'mit-copyright', category: 'must-keep', whiteLabelingRequiresRemoval: true },
      { id: 'logo.svg', category: 'replaceable' },
    ]);
    expect(r.verdict).toBe('Blocked-by-legal-obligation');
    const a = find(r, 'mit-copyright');
    expect(a.action).toBe('preserve'); // STILL preserve — never strip
    expect(a.legalConflict).toBe(true);
  });

  it('NO must-keep element ever receives a strip/replace/disable action (structural)', () => {
    const elements: BrandingElement[] = [
      { id: 'apache-NOTICE', category: 'must-keep' },
      { id: 'powered-by', category: 'must-keep', whiteLabelingRequiresRemoval: true },
      { id: 'logo', category: 'replaceable' },
      { id: 'telemetry', category: 'disable' },
      { id: 'name', category: 'trademark-caution' },
    ];
    const r = assessWhiteLabel(elements);
    for (const a of r.actions) {
      if (a.category === 'must-keep') {
        expect(a.action).toBe('preserve');
        expect(['replace', 'disable']).not.toContain(a.action);
      }
    }
  });
});

describe('White-Label — verdict cases', () => {
  it('only must-keep (no conflict) ⇒ Ready', () => {
    expect(assessWhiteLabel([{ id: 'notice', category: 'must-keep' }]).verdict).toBe('Ready');
  });
  it('replaceable / disable present ⇒ Ready-after-stripping', () => {
    expect(assessWhiteLabel([{ id: 'logo', category: 'replaceable' }, { id: 'notice', category: 'must-keep' }]).verdict).toBe('Ready-after-stripping');
  });
  it('a must-keep legal conflict ⇒ Blocked-by-legal-obligation', () => {
    expect(assessWhiteLabel([{ id: 'notice', category: 'must-keep', whiteLabelingRequiresRemoval: true }]).verdict).toBe('Blocked-by-legal-obligation');
  });
});
