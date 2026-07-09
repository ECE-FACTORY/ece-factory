// Harvest-report parser (Design §3) — parses a committed docs/HARVEST_REPORT_*.md into a typed HarvestReport.
// DISCIPLINE: it READS the stated numbers (never recomputes a score); a stated total that contradicts its own
// candidate row is FLAGGED in `parseIssues`, never silently reconciled. Output is validated against the contract
// schema before return (a shape bug throws loudly rather than producing a malformed report).

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { HarvestReport as HarvestReportSchema } from '../contracts/index.js';
import type { HarvestReport, SubDomainResult, Candidate, DimensionSignal, EvidenceBuckets } from '../contracts/index.js';

const CONFIDENCE = { meas: 'measured', part: 'partial', 'n/m': 'not-mechanizable' } as const;

/** Parse a `dim=value(meas|part|n/m,+N) · …` signal cell into typed DimensionSignals. */
function parseSignals(cell: string): DimensionSignal[] {
  const out: DimensionSignal[] = [];
  for (const tok of cell.split('·').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(.+?)=(.+?)\((meas|part|n\/m),\s*\+?(-?\d+)\)$/.exec(tok);
    if (!m) continue;
    out.push({ dimension: m[1]!, value: m[2]!, confidence: CONFIDENCE[m[3] as keyof typeof CONFIDENCE], delta: Number(m[4]) });
  }
  return out;
}

/** Parse a `MIT · "MIT License"` / `MIT ⚠︎hint≠file · "…"` license cell. detected = the classified short name. */
function parseLicense(cell: string, decision: Candidate['license']['decision']): Candidate['license'] {
  const left = (cell.split('·')[0] ?? '').trim();          // 'MIT' or 'MIT ⚠︎hint≠file'
  const detected = (left.split(/\s+/)[0] ?? 'unknown').trim();
  return { detected, decision, disagreement: /hint/.test(left) };
}

const ROW = /^\|\s*\[([^/\]]+)\/([^\]]+)\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|\s*(ACCEPT|REJECT|NEEDS_REVIEW)\s*\|\s*([a-z-]+)\s*\|\s*([\d.]+)\/100\s*\|\s*([a-z]+)\s*\|\s*(.*?)\s*\|\s*$/;

function parseCandidateRow(line: string): Candidate | null {
  const m = ROW.exec(line);
  if (!m) return null;
  return {
    identity: { host: 'github.com', owner: m[1]!, name: m[2]! },
    repoUrl: m[3]!,
    license: parseLicense(m[4]!, m[5] as Candidate['license']['decision']),
    eligibility: m[6] as Candidate['eligibility'],
    score: { total: Number(m[7]), band: m[8] as Candidate['score']['band'] },
    dimensions: parseSignals(m[9]!),
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function bucketsFor(spine: Candidate | null, humanRequired: string[]): EvidenceBuckets {
  const dims = spine?.dimensions ?? [];
  return {
    facts: spine ? [`license ${spine.license.decision} (${spine.license.detected})${spine.license.disagreement ? ' ⚠ hint≠file' : ''}`, `eligibility ${spine.eligibility}`, `identity ${spine.identity.owner}/${spine.identity.name}`] : [],
    measured: dims.filter((d) => d.confidence === 'measured'),
    judgments: dims.filter((d) => d.confidence === 'partial'),
    unknowns: dims.filter((d) => d.confidence === 'not-mechanizable'),
    humanRequired,
  };
}

/** Parse one `### …` sub-domain block. */
function parseSubDomain(chunk: string, issues: string[]): SubDomainResult {
  const header = /^(.+?)\s+—\s+decision:\s*\*\*([A-Z-]+)\*\*/.exec(chunk);
  const title = header?.[1]?.trim() ?? '(unknown)';
  const decision = (header?.[2] ?? 'NEEDS-ASSESSMENT') as SubDomainResult['decision'];
  const query = /^_Query:_\s*`(.+?)`/m.exec(chunk)?.[1] ?? '';

  const candidates: Candidate[] = [];
  for (const line of chunk.split('\n')) { const c = parseCandidateRow(line); if (c) candidates.push(c); }

  const evidence = chunk.split('\n').filter((l) => /^- /.test(l)).map((l) => l.replace(/^- /, '').trim());
  const unmeasured = (/-\s*unmeasured at decision:\s*(.+)/.exec(chunk)?.[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'none');
  const humanRequired = [...chunk.matchAll(/HUMAN APPROVAL REQUIRED:[^\n]+/g)].map((m) => m[0].trim());

  // Spine: read the stated line, then bind to its candidate ROW (the real graded number). Flag any mismatch.
  const spineLine = /-\s*spine:\s*(\S+?)\/(\S+?)\s+—\s+real score\s+([\d.]+)\/100,\s*band\s*"(\w+)"/.exec(chunk);
  let spine: Candidate | null = null;
  if (spineLine) {
    const [, owner, name, statedScore, statedBand] = spineLine;
    const row = candidates.find((c) => c.identity.owner === owner && c.identity.name === name);
    if (!row) {
      issues.push(`${title}: spine ${owner}/${name} named but not found in candidate table — using the spine line's stated values`);
      spine = { identity: { host: 'github.com', owner: owner!, name: name! }, repoUrl: `https://github.com/${owner}/${name}`, license: { detected: 'unknown', decision: 'NEEDS_REVIEW', disagreement: false }, eligibility: 'eligible', score: { total: Number(statedScore), band: statedBand as Candidate['score']['band'] }, dimensions: [] };
    } else {
      spine = row;
      if (row.score.total !== Number(statedScore)) issues.push(`${title}: parse-inconsistency — spine line states ${statedScore}/100 but the candidate row states ${row.score.total}/100 (using the row value)`);
      if (row.score.band !== statedBand) issues.push(`${title}: parse-inconsistency — spine line band "${statedBand}" ≠ row band "${row.score.band}"`);
    }
  }

  return { key: slug(title), title, query, decision, spine, candidates, unmeasured, evidence, buckets: bucketsFor(spine, humanRequired) };
}

/** Parse harvest-report markdown into a typed HarvestReport. Pure — sha256 is passed in. */
export function parseHarvestReport(markdown: string, sourceFile: string, contentSha256: string): HarvestReport {
  const issues: string[] = [];
  const domain = /^#\s*Harvest Report\s*—\s*(.+)$/m.exec(markdown)?.[1]?.trim() ?? '(unknown)';
  const generatedAtIso = /\*\*Generated:\*\*\s*([^\s·]+)/.exec(markdown)?.[1] ?? '';

  const modeMatch = /\*\*Product mode:\*\*\s*(\w+)/i.exec(markdown);
  let productMode: HarvestReport['productMode'];
  if (modeMatch) productMode = modeMatch[1]!.toLowerCase() as HarvestReport['productMode'];
  else { productMode = 'sovereign'; issues.push('productMode absent in file (pre-Stage-2 report) — defaulted to sovereign, not inferred from content'); }

  // Split into `### …` sub-domain blocks (drop the pre-first-### preamble); stop each block at the next `##`/`###`.
  const blocks = markdown.split(/\n### /).slice(1).map((b) => b.split(/\n## /)[0]!);
  const subDomains = blocks.map((b) => parseSubDomain(b, issues));

  const report = {
    domain, productMode, generatedAtIso, sourceFile, contentSha256,
    status: 'STOP-AWAITING-HUMAN-APPROVAL' as const, subDomains, parseIssues: issues,
  };
  return HarvestReportSchema.parse(report); // conformance self-check — a shape bug throws, never a malformed report
}

/** Read a committed report file → typed HarvestReport, stamping the content sha256. */
export function parseHarvestReportFile(absPath: string): HarvestReport {
  const text = readFileSync(absPath, 'utf8');
  const sha256 = createHash('sha256').update(text).digest('hex');
  let rel = absPath; try { rel = relative(process.cwd(), absPath); } catch { /* keep abs */ }
  return parseHarvestReport(text, rel, sha256);
}
