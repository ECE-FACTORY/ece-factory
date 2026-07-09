// ReportAdapter — the §3 parser over the committed docs/HARVEST_REPORT_*.md, wrapped with provenance
// {source:'report-file', locator:{path}, pin:{sha256}}. Read-only: reads files, never writes.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseHarvestReportFile } from '../report-parser/report-parser.js';
import { present, absent } from '../contracts/index.js';
import type { Run, HarvestReport, Provenanced } from '../contracts/index.js';

const nowIso = () => new Date().toISOString();

export interface ReportAdapterOpts { docsDir?: string; now?: () => string; }

function reportProv(report: HarvestReport, now: () => string): Parameters<typeof present>[1] {
  return { source: 'report-file', locator: { kind: 'path', path: report.sourceFile }, pin: { kind: 'hash', sha256: report.contentSha256 }, readAt: now() };
}

function toRun(r: HarvestReport): Run {
  const verdicts = { FORK: 0, EXTEND: 0, BUILD: 0, 'NEEDS-ASSESSMENT': 0 };
  for (const s of r.subDomains) verdicts[s.decision] += 1;
  return { domain: r.domain, productMode: r.productMode, reportPath: r.sourceFile, generatedAtIso: r.generatedAtIso, verdicts };
}

export function loadReports(opts: ReportAdapterOpts = {}): HarvestReport[] {
  const docsDir = opts.docsDir ?? join(process.cwd(), 'docs');
  return readdirSync(docsDir).filter((f) => /^HARVEST_REPORT_.*\.md$/.test(f)).sort()
    .map((f) => parseHarvestReportFile(join(docsDir, f)));
}

export function listReports(opts: ReportAdapterOpts = {}): Provenanced<Run>[] {
  const now = opts.now ?? nowIso;
  return loadReports(opts).map((r) => present(toRun(r), reportProv(r, now)));
}

export function getReport(domain: string, opts: ReportAdapterOpts = {}): Provenanced<HarvestReport> {
  const now = opts.now ?? nowIso;
  const match = loadReports(opts).find((r) => r.domain === domain || r.domain.toLowerCase().includes(domain.toLowerCase()));
  return match ? present(match, reportProv(match, now)) : absent<HarvestReport>(`no committed harvest report matches "${domain}"`, now());
}
