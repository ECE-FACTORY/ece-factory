// derivedCount — an aggregate count DERIVED from a provenanced list read (e.g. #reports,
// #build-plan evidence). Honest: source 'derived' (a first-class ProvenanceSource), locator
// names the exact route it was derived from; the underlying items keep their own provenance.
// The value still traces to an API field — it is a function of one.
import { present } from '../../contracts.js';
import type { Provenanced } from '../../contracts.js';

export function derivedCount(n: number, fromRoute: string, readAt = new Date().toISOString()): Provenanced<number> {
  return present(n, { source: 'derived', locator: { kind: 'cmd', cmd: `GET ${fromRoute}` }, pin: { kind: 'none' }, readAt });
}
