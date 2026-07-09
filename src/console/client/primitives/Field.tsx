// <Field> — bridges an envelope's three states to <Operational>. Loading shows a quiet
// placeholder; UNAVAILABLE synthesizes an absent value so <Operational> renders "unavailable"
// (the killed-API honesty, structural via useEnvelope's no-cache); present passes the real
// provenanced field straight through. No value is ever invented — an unavailable envelope
// yields an absent provenance, never a stale or placeholder value.
import React from 'react';
import { Operational } from './Operational.js';
import { absent } from '../contracts.js';
import type { Provenanced } from '../contracts.js';
import type { EnvelopeHandle } from '../data/use-envelope.js';

export interface FieldProps<D, V> {
  handle: EnvelopeHandle<D>;
  pick: (data: D) => Provenanced<V> | undefined;
  label: string;
  render?: (value: V) => React.ReactNode;
  mono?: boolean;
}

export function Field<D, V>({ handle, pick, label, render, mono }: FieldProps<D, V>): React.ReactElement {
  const s = handle.state;
  if (s.status === 'loading') {
    return (
      <span className="op op--loading" data-loading="" aria-busy="true">
        <span className="op__value">…</span>
      </span>
    );
  }
  const field: Provenanced<V> | undefined =
    s.status === 'unavailable' ? absent<V>(s.reason, new Date().toISOString()) : pick(s.data);
  return <Operational field={field} label={label} render={render} mono={mono} />;
}
