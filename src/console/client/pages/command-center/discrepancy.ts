// Discrepancy Detector — M4 STUB (the full walkable-lineage version is M7). It cross-checks the
// already-fetched envelopes for internal inconsistency and returns any mismatch to render red.
// A pure function of its inputs (no I/O), so it is trivially testable and holds no factory power.
//
// M4 checks: (1) every envelope is pinned to the same HEAD as git (a read that drifted from HEAD
// is suspect); (2) HEAD is the top of the git log (a shown HEAD not at the log tip is a red flag).
// Extended in later steps (report referenced but missing, commit shown but absent from log).

export interface Discrepancy {
  kind: 'head-not-latest' | 'envelope-head-drift';
  detail: string;
}

export interface DiscrepancyInput {
  gitHead?: string;
  recentTopSha?: string;
  envelopeHeads: Array<{ route: string; head: string }>;
}

export function detectDiscrepancies(input: DiscrepancyInput): Discrepancy[] {
  const out: Discrepancy[] = [];
  const short = (s: string) => s.slice(0, 7);

  if (input.gitHead && input.recentTopSha && input.gitHead !== input.recentTopSha) {
    out.push({
      kind: 'head-not-latest',
      detail: `HEAD ${short(input.gitHead)} is not the top of the git log (${short(input.recentTopSha)})`,
    });
  }
  if (input.gitHead) {
    for (const e of input.envelopeHeads) {
      if (e.head && e.head !== input.gitHead) {
        out.push({
          kind: 'envelope-head-drift',
          detail: `${e.route} is pinned to ${short(e.head)} ≠ HEAD ${short(input.gitHead)}`,
        });
      }
    }
  }
  return out;
}
