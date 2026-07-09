// <Operational> — the ONLY sanctioned way to put a factory value on screen (design §6.1).
//
// It is a pure function of its `field` prop, with no cache and no default: a PRESENT
// provenanced value renders the value plus its provenance stamp; an ABSENT value (or a
// missing field) renders the explicit "unavailable" state and shows NO provenance. There is
// no branch that emits a bare, unsourced value — that is Rule 0 made structural at the leaf.
//
// Every rendered node carries data-* attributes so the later trace test (0c.5) can walk the
// DOM and assert each operational value traces to a real, non-absent provenance.

import React from 'react';
import type { PresentProvenance, Provenanced } from '../contracts.js';

const SOURCE_GLYPH: Record<string, string> = {
  git: '◆',
  'report-file': '▤',
  'test-run': '⟳',
  'source-constant': '◇',
  'store-file': '▤',
  derived: '·',
};

function pinLabel(pin: PresentProvenance['pin']): string {
  if (pin.kind === 'commit') return pin.commit.slice(0, 7);
  if (pin.kind === 'hash') return pin.sha256.slice(0, 8);
  return 'none';
}

function locatorText(prov: PresentProvenance): string {
  const l = prov.locator;
  if (l.kind === 'path') return l.path;
  if (l.kind === 'cmd') return l.cmd;
  return `${l.module}::${l.export}`;
}

export interface OperationalProps<T> {
  /** The provenanced value. `undefined` is treated as absent — the component never invents one. */
  field: Provenanced<T> | undefined;
  /** Field name — surfaced as data-field for the trace test and the Inspector. */
  label: string;
  /** Optional custom value renderer; defaults to String(value). */
  render?: (value: T) => React.ReactNode;
  /** Machine value (hash/path/commit) → monospace. Default true. */
  mono?: boolean;
}

export function Operational<T>({ field, label, render, mono = true }: OperationalProps<T>): React.ReactElement {
  if (!field || field.status === 'absent') {
    const reason = field?.status === 'absent' ? field.provenance.reason : 'no data read';
    return (
      <span
        className="op op--unavailable"
        data-operational=""
        data-field={label}
        data-prov-source="absent"
        data-unavailable=""
      >
        <span className="op__value">unavailable</span>
        <span className="op__stamp op__stamp--absent">∅ {reason}</span>
      </span>
    );
  }

  const { value, provenance } = field;
  const glyph = SOURCE_GLYPH[provenance.source] ?? '·';
  // Scalar values expose data-value so the trace test (0c.5) can assert value∈envelope.
  // Custom renders (arrays/objects) omit it — their leaves trace via provenance source.
  const scalarValue = render ? undefined : String(value);
  return (
    <span
      className={mono ? 'op op--mono' : 'op'}
      data-operational=""
      data-field={label}
      data-prov-source={provenance.source}
      data-prov-pin={pinLabel(provenance.pin)}
      data-value={scalarValue}
    >
      <span className="op__value">{render ? render(value) : String(value)}</span>
      <span className="op__stamp" title={`${provenance.source} · ${locatorText(provenance)} · read ${provenance.readAt}`}>
        {glyph} {provenance.source} @{pinLabel(provenance.pin)}
      </span>
    </span>
  );
}
