// Live Capability Reuse Graph wiring (Venture Intelligence Wave — Phase 1, composition layer). Derives the
// re-derivable structural facts from the REAL repo (src/features modules + infra/migrations tables), reusing the
// Feature Registry's FeatureEntry read-model where supplied (the one door — never reimplemented/mutated). Thin
// composition: NO guard logic, NO gate/bridge, NO mutation — it only reads files and builds/queries the graph.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../layer-4-build-harden/build-observer/build-observer.js';
import type { AuditSink } from '../factory-shared/audit-engine/sink.js';
import type { HumanActor, Environment } from '../factory-shared/audit-engine/schema.js';
import type { FeatureEntry } from '../layer-4-build-harden/feature-registry/feature-registry.js';
import {
  buildCapabilityGraph,
  CapabilityReuseGraph,
  CapabilityGraphAuditor,
  CAPGRAPH_AUDIT_ALLOWLIST,
  type CapabilityFacts,
  type RawModuleFact,
  type RawTableFact,
} from '../factory-shared/capability-reuse-graph/capability-reuse-graph.js';

const ENGINE_RE = /-(engine|registry|gate|bridge|checker|scheduler|spine|builder)$/;

/** Discover the DB tables declared in the SQL migrations (structural, re-derivable). */
export function deriveTableFacts(repoRoot: string): RawTableFact[] {
  const dir = path.join(repoRoot, 'infra', 'migrations');
  const tables: RawTableFact[] = [];
  if (!existsSync(dir)) return tables;
  const seen = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
      const name = m[1].toLowerCase();
      if (!seen.has(name)) { seen.add(name); tables.push({ name, source: `infra/migrations/${f}` }); }
    }
  }
  return tables;
}

/** The layer directories a factory module can live in after the six-layer restructure.
 *  factory-shared holds cross-cutting infra; the six layer-* dirs hold the layered modules.
 *  (Pre-restructure 'features' is included for backward-compat so the derivation works in both layouts.) */
const MODULE_PARENT_DIRS = [
  'features',
  'factory-shared',
  'layer-1-law',
  'layer-2-command',
  'layer-3-harvest',
  'layer-4-build-harden',
  'layer-5-action',
  'layer-6-venture-intel',
];

/** Derive one structural fact per factory module by re-reading the repo (deterministic; no opinion).
 *  Walks every layer directory so the capability graph reflects the six-layer architecture. */
export function deriveModuleFacts(repoRoot: string, tableNames: string[]): RawModuleFact[] {
  const out: RawModuleFact[] = [];
  const seenNames = new Set<string>();
  for (const parent of MODULE_PARENT_DIRS) {
    const parentDir = path.join(repoRoot, 'src', parent);
    if (!existsSync(parentDir)) continue;
    for (const name of readdirSync(parentDir).sort()) {
      const modDir = path.join(parentDir, name);
      if (!statSync(modDir).isDirectory()) continue;
      if (seenNames.has(name)) continue; // a module lives in exactly one layer; first hit wins
      const files = readdirSync(modDir);
      const tsFiles = files.filter((f) => f.endsWith('.ts'));
      if (tsFiles.length === 0) continue;
      seenNames.add(name);
      const relBase = `src/${parent}/${name}`;
      const tests = files.filter((f) => f.endsWith('.test.ts')).map((f) => `${relBase}/${f}`).sort();
      const docs = files.filter((f) => f.endsWith('.feature.md') || f.endsWith('.md')).map((f) => `${relBase}/${f}`).sort();
      // concatenate the NON-test source for posture derivation
      const src = tsFiles.filter((f) => !f.endsWith('.test.ts')).map((f) => { try { return readFileSync(path.join(modDir, f), 'utf8'); } catch { return ''; } }).join('\n');
      const dbTables = tableNames.filter((t) => new RegExp(`\\b${t}\\b`).test(src)).sort();
      out.push({
        name,
        path: relBase,
        kind: ENGINE_RE.test(name) ? 'engine' : 'feature',
        description: firstDocLine(src),
        hasTests: tests.length > 0,
        documented: docs.some((d) => d.endsWith('.feature.md')),
        hasAudit: /audit-engine|appendRead|AuditSink|PostgresHashChainSink|hash-chain/i.test(src),
        hasRedaction: /redaction-engine|RedactionEngine|redactSummary|SecretPatternRedactor/i.test(src),
        packageable: /STANDALONE-PACKAGEABLE/i.test(src),
        tests,
        docs,
        dbTables,
      });
    }
  }
  return out;
}

/** The first meaningful comment line of a module — an inert one-line description (secret-scrubbing happens in build). */
function firstDocLine(src: string): string {
  const m = /^\/\/\s*(.+)$/m.exec(src);
  return m ? m[1].slice(0, 200) : '';
}

/** Re-derivable facts from the real repo: filesystem module facts + migration table facts (+ optional registry). */
export function deriveCapabilityFacts(repoRoot: string, features?: FeatureEntry[]): CapabilityFacts {
  const tables = deriveTableFacts(repoRoot);
  const modules = deriveModuleFacts(repoRoot, tables.map((t) => t.name));
  return { modules, tables, features };
}

/** Build the searchable Capability Reuse Graph from the real repo (secret-scrubbed descriptions). */
export function factoryCapabilityGraph(repoRoot: string, features?: FeatureEntry[]): CapabilityReuseGraph {
  return new CapabilityReuseGraph(buildCapabilityGraph(deriveCapabilityFacts(repoRoot, features), SecretPatternRedactor));
}

/** Service identity for capability-graph evidence (a service actor, never 'claude'/a fake human). */
export const CAPGRAPH_ACTOR: HumanActor = { user_id: 'capability-reuse-graph', email: '', role: 'service' };

export function factoryCapabilityGraphAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = CAPGRAPH_ACTOR,
  environment: Environment = 'local',
): CapabilityGraphAuditor {
  return new CapabilityGraphAuditor(sink, new RedactionEngine(CAPGRAPH_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
