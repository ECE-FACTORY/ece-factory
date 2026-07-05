// Live Capability Reuse Graph wiring (Venture Intelligence Wave — Phase 1, composition layer). Derives the
// re-derivable structural facts from the REAL repo (src/features modules + infra/migrations tables), reusing the
// Feature Registry's FeatureEntry read-model where supplied (the one door — never reimplemented/mutated). Thin
// composition: NO guard logic, NO gate/bridge, NO mutation — it only reads files and builds/queries the graph.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import type { FeatureEntry } from '../features/feature-registry/feature-registry.js';
import {
  buildCapabilityGraph,
  CapabilityReuseGraph,
  CapabilityGraphAuditor,
  CAPGRAPH_AUDIT_ALLOWLIST,
  type CapabilityFacts,
  type RawModuleFact,
  type RawTableFact,
} from '../features/capability-reuse-graph/capability-reuse-graph.js';

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

/** Derive one structural fact per src/features module by re-reading the repo (deterministic; no opinion). */
export function deriveModuleFacts(repoRoot: string, tableNames: string[]): RawModuleFact[] {
  const featuresDir = path.join(repoRoot, 'src', 'features');
  const out: RawModuleFact[] = [];
  if (!existsSync(featuresDir)) return out;
  for (const name of readdirSync(featuresDir).sort()) {
    const modDir = path.join(featuresDir, name);
    if (!statSync(modDir).isDirectory()) continue;
    const files = readdirSync(modDir);
    const tsFiles = files.filter((f) => f.endsWith('.ts'));
    if (tsFiles.length === 0) continue;
    const tests = files.filter((f) => f.endsWith('.test.ts')).map((f) => `src/features/${name}/${f}`).sort();
    const docs = files.filter((f) => f.endsWith('.feature.md') || f.endsWith('.md')).map((f) => `src/features/${name}/${f}`).sort();
    // concatenate the NON-test source for posture derivation
    const src = tsFiles.filter((f) => !f.endsWith('.test.ts')).map((f) => { try { return readFileSync(path.join(modDir, f), 'utf8'); } catch { return ''; } }).join('\n');
    const dbTables = tableNames.filter((t) => new RegExp(`\\b${t}\\b`).test(src)).sort();
    out.push({
      name,
      path: `src/features/${name}`,
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
