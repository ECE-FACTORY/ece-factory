// @vitest-environment jsdom
// <Operational> and useEnvelope — the two structural guarantees of Rule 0 at the leaf:
//   1. <Operational> renders a provenanced value OR "unavailable" — never a bare, unsourced value.
//   2. useEnvelope holds NO last-good cache — a failed read flips to `unavailable`, dropping any
//      prior value, so the API dying can never leave a stale value shown cached-as-current.
// Written as .test.ts (no JSX) via createElement, so vitest.config stays untouched.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import { Operational } from './client/primitives/Operational.js';
import { useEnvelope, type EnvelopeClient } from './client/data/use-envelope.js';
import { present, absent } from './client/contracts.js';
import type { PresentProvenance } from './client/contracts.js';

const PROV: PresentProvenance = {
  source: 'store-file',
  locator: { kind: 'path', path: 'factory-state/approvals.jsonl' },
  pin: { kind: 'hash', sha256: 'deadbeefcafebabe' },
  readAt: '2026-07-09T00:00:00.000Z',
};

describe('<Operational> — renders a sourced value or an honest "unavailable"', () => {
  it('an ABSENT value renders "unavailable" with NO provenance stamp', () => {
    const { container } = render(createElement(Operational, { field: absent('approvals store not read', 'ISO'), label: 'HEAD' }));
    const node = container.querySelector('[data-operational]')!;
    expect(node).toBeTruthy();
    expect(node.getAttribute('data-prov-source')).toBe('absent');
    expect(node.hasAttribute('data-unavailable')).toBe(true);
    expect(node.getAttribute('data-prov-pin')).toBeNull();       // absent carries no pin
    expect(node.textContent).toContain('unavailable');
    expect(container.querySelector('.op__stamp:not(.op__stamp--absent)')).toBeNull(); // no source stamp
  });

  it('a MISSING field (undefined) also renders "unavailable" — never a bare value', () => {
    const { container } = render(createElement(Operational, { field: undefined, label: 'HEAD' }));
    const node = container.querySelector('[data-operational]')!;
    expect(node.getAttribute('data-prov-source')).toBe('absent');
    expect(node.hasAttribute('data-unavailable')).toBe(true);
    expect(node.textContent).toContain('unavailable');
  });

  it('a PRESENT value renders the value AND its provenance source', () => {
    const { container } = render(createElement(Operational, { field: present('ea2deb9', PROV), label: 'HEAD' }));
    const node = container.querySelector('[data-operational]')!;
    expect(node.getAttribute('data-prov-source')).toBe('store-file');
    expect(node.hasAttribute('data-unavailable')).toBe(false);
    expect(node.textContent).toContain('ea2deb9');
    expect(node.textContent).toContain('store-file'); // the provenance stamp is shown
  });
});

describe('useEnvelope — no last-good cache; a killed API flips to "unavailable"', () => {
  const meta = { apiVersion: 'read-plane/1', head: 'ea2deb9', generatedAt: 'ISO' };

  it('present read → present; a subsequent failed read → unavailable, dropping the prior value', async () => {
    const okClient: EnvelopeClient = async () => ({ data: 'ea2deb9', meta });
    const killClient: EnvelopeClient = async () => {
      throw new Error('ECONNREFUSED: state API down');
    };

    const { result, rerender } = renderHook(({ client }) => useEnvelope('/state/git', (d) => d as string, client), {
      initialProps: { client: okClient },
    });

    await waitFor(() => expect(result.current.state.status).toBe('present'));
    expect(result.current.state).toMatchObject({ status: 'present', data: 'ea2deb9' });

    // Swap in a dead API and re-read.
    rerender({ client: killClient });
    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
    // The proof of no-cache: the prior 'ea2deb9' is GONE — the state carries no data field.
    expect(result.current.state).not.toHaveProperty('data');
    expect(result.current.state).toMatchObject({ status: 'unavailable' });
  });
});
