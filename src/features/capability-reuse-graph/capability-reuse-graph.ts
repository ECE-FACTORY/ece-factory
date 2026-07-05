// Capability Reuse Graph (Venture Intelligence Wave — Phase 1, STRUCTURAL engine).
//
// The single most load-bearing engine of the venture layer: a STRUCTURAL, re-derivable index of everything ECE
// has built or planned — engines, features, APIs, DB tables, UI surfaces, workflows, tests, docs — each carrying
// its lineage (where the fact was derived) and its audit/redaction/packageable posture. It is SEARCHABLE, so the
// later reuse/venture engines can ask "do we already have this?" before proposing a build.
//
// STRUCTURAL, NOT JUDGMENT (§3 of REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md): every node/edge is a fact that can
// be independently re-derived from the codebase/registry ("the Audit Engine exists, at this path, with this
// posture"). This engine makes NO recommendation — reuse/build/buy is Phase 2+. There is NO advisory output here.
//
// PLAN-ONLY / READ-ONLY (type-level safety): this module holds NO gate/approval/mint/bridge-write reference and
// exposes NO method to execute/create/approve/mutate/deploy — its only capabilities are build (a pure function)
// and query. Those verbs are UNREPRESENTABLE in its surface (a source-scan + structural test enforce it). It
// reads facts; it writes nothing consequential.
//
// INSTRUCTION-BOUNDARY: any free text it ingests (descriptions) is inert DATA — stored, secret-scrubbed, never
// interpreted as a command. The module contains no eval/exec and reaches no network.
//
// STANDALONE-PACKAGEABLE: the only cross-engine reference is `import type` (the Feature Registry's FeatureEntry
// shape — REUSED, not reimplemented) and the redactor port. Zero runtime engine coupling.

import type { FeatureEntry } from '../feature-registry/feature-registry.js';
import type { TextRedactor } from '../build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import type { RedactionEngine } from '../redaction-engine/redaction-engine.js';

export type CapabilityKind = 'engine' | 'feature' | 'api' | 'db-table' | 'ui' | 'workflow' | 'test' | 'doc';

/** Re-derivable posture flags. Deny-by-default: an unknown/absent posture is `false`, never fabricated `true`. */
export interface CapabilityPosture {
  hasAudit: boolean;
  hasRedaction: boolean;
  hasTests: boolean;
  packageable: boolean;
  hasPermissions: boolean;
}
export interface CapabilityNode {
  /** stable, derived id — e.g. `feature:audit-engine`, `db-table:audit_intent`, `api:issueCredential` */
  id: string;
  kind: CapabilityKind;
  name: string;
  /** inert DATA (instruction-boundary), secret-scrubbed */
  description: string;
  /** lineage — where this fact was derived (a path / a registry) */
  source: string;
  posture: CapabilityPosture;
}
export type CapabilityRel = 'exposes' | 'persists-to' | 'renders' | 'runs' | 'tested-by' | 'documented-by';
export interface CapabilityEdge { from: string; to: string; rel: CapabilityRel }
export interface CapabilityGraph { nodes: CapabilityNode[]; edges: CapabilityEdge[] }

/** A filesystem-derived structural fact about a src/features module (re-derivable by re-reading the repo). */
export interface RawModuleFact {
  name: string;
  path: string;
  kind: 'engine' | 'feature';
  description?: string;
  hasTests: boolean;
  documented: boolean;
  hasAudit: boolean;
  hasRedaction: boolean;
  packageable: boolean;
  /** paths of test files under the module (each becomes a `test` node) */
  tests: string[];
  /** paths of doc/feature-file(s) for the module (each becomes a `doc` node) */
  docs: string[];
  /** db tables the module's code references (edges to db-table nodes) */
  dbTables: string[];
}
/** DB tables discovered structurally (e.g. from migrations) — name + the source that declared them. */
export interface RawTableFact { name: string; source: string }

/** The re-derivable inputs. `features` is the Feature Registry read-model (REUSED via the guard stack — the one
 *  door — never reimplemented/mutated). `modules`/`tables` are filesystem-derivable structural facts. */
export interface CapabilityFacts {
  modules: RawModuleFact[];
  tables: RawTableFact[];
  features?: FeatureEntry[];
}
export type CapabilitySource = () => CapabilityFacts | Promise<CapabilityFacts>;

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };
const EMPTY_POSTURE: CapabilityPosture = { hasAudit: false, hasRedaction: false, hasTests: false, packageable: false, hasPermissions: false };

function slug(s: string): string { return String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
/** DB-table id preserves the real table name (underscores are meaningful — audit_intent ≠ audit-intent). */
function tableId(name: string): string { return `db-table:${String(name ?? '').trim().toLowerCase()}`; }
function byId(a: { id: string }, b: { id: string }): number { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
function edgeKey(e: CapabilityEdge): string { return `${e.from}|${e.rel}|${e.to}`; }

/**
 * Build the CapabilityGraph from re-derivable facts — a PURE, DETERMINISTIC function (same facts ⇒ identical
 * graph; nodes/edges sorted, de-duplicated). It merges filesystem module facts with the reused Feature Registry
 * entries. It makes NO judgment. Descriptions are secret-scrubbed and stored as inert data.
 */
export function buildCapabilityGraph(facts: CapabilityFacts, redactor: TextRedactor = IDENTITY_REDACTOR): CapabilityGraph {
  const nodes = new Map<string, CapabilityNode>();
  const edges = new Map<string, CapabilityEdge>();
  const put = (n: CapabilityNode): void => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const link = (from: string, rel: CapabilityRel, to: string): void => { const e = { from, rel, to }; edges.set(edgeKey(e), e); };
  const desc = (s: string | undefined): string => redactor.redact(String(s ?? ''));

  // registry entries keyed by name for merge (REUSE — the FeatureEntry shape is authoritative for apis/tables/etc.)
  const reg = new Map<string, FeatureEntry>();
  for (const f of facts.features ?? []) reg.set(f.name, f);

  // 1. module nodes (engine|feature) with re-derivable posture, merged with the registry entry where present.
  for (const m of facts.modules) {
    const id = `${m.kind}:${slug(m.name)}`;
    const r = reg.get(m.name);
    const posture: CapabilityPosture = {
      hasAudit: m.hasAudit,
      hasRedaction: m.hasRedaction,
      hasTests: m.hasTests || r?.hasTests === true,
      packageable: m.packageable,
      hasPermissions: !!(r?.permissions && r.permissions.length > 0),
    };
    put({ id, kind: m.kind, name: m.name, description: desc(m.description ?? r?.name), source: m.path, posture });

    // structural edges from filesystem facts
    for (const t of m.dbTables) link(id, 'persists-to', tableId(t));
    for (const tp of m.tests) { const tid = `test:${slug(tp)}`; put({ id: tid, kind: 'test', name: tp.split('/').pop() ?? tp, description: '', source: tp, posture: { ...EMPTY_POSTURE } }); link(id, 'tested-by', tid); }
    for (const dp of m.docs) { const did = `doc:${slug(dp)}`; put({ id: did, kind: 'doc', name: dp.split('/').pop() ?? dp, description: '', source: dp, posture: { ...EMPTY_POSTURE } }); link(id, 'documented-by', did); }

    // structural edges from the REUSED registry entry (apis/ui/workflows/tables) — deny-by-default: absent ⇒ nothing
    if (r) {
      for (const a of r.apis ?? []) { const aid = `api:${slug(a)}`; put({ id: aid, kind: 'api', name: a, description: '', source: m.path, posture: { ...EMPTY_POSTURE } }); link(id, 'exposes', aid); }
      for (const c of r.components ?? []) { const cid = `ui:${slug(c)}`; put({ id: cid, kind: 'ui', name: c, description: '', source: m.path, posture: { ...EMPTY_POSTURE } }); link(id, 'renders', cid); }
      for (const s of r.services ?? []) { const sid = `workflow:${slug(s)}`; put({ id: sid, kind: 'workflow', name: s, description: '', source: m.path, posture: { ...EMPTY_POSTURE } }); link(id, 'runs', sid); }
      for (const t of r.dbTables ?? []) link(id, 'persists-to', tableId(t));
    }
  }

  // 2. db-table nodes from structural sources (migrations). A table referenced by an edge but never declared here
  //    stays edge-only (deny-by-default: we do not fabricate a node we cannot source).
  for (const t of facts.tables) {
    const id = tableId(t.name);
    put({ id, kind: 'db-table', name: t.name, description: '', source: t.source, posture: { ...EMPTY_POSTURE } });
  }

  return {
    nodes: [...nodes.values()].sort(byId),
    edges: [...edges.values()].sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : edgeKey(a) > edgeKey(b) ? 1 : 0)),
  };
}

export interface CapabilityQuery {
  kind?: CapabilityKind;
  /** case-insensitive substring over name + description (inert data match — NOT executed) */
  text?: string;
  /** require these posture flags to be true */
  posture?: Partial<CapabilityPosture>;
}
export interface LineageView { node: CapabilityNode; outgoing: CapabilityEdge[]; incoming: CapabilityEdge[]; related: CapabilityNode[] }

/**
 * The searchable, READ-ONLY graph surface. Its ONLY methods are search()/lineageOf()/get graph — all pure reads
 * returning FACTS (matching nodes + lineage). It exposes NOTHING that could execute/create/approve/mutate/deploy,
 * and it emits NO recommendation (structural, not judgment).
 */
export class CapabilityReuseGraph {
  readonly #graph: CapabilityGraph;
  constructor(graph: CapabilityGraph) {
    // freeze the indexed facts — the query surface cannot mutate the graph it was handed.
    this.#graph = { nodes: Object.freeze([...graph.nodes]) as CapabilityNode[], edges: Object.freeze([...graph.edges]) as CapabilityEdge[] };
  }

  get graph(): CapabilityGraph { return { nodes: [...this.#graph.nodes], edges: [...this.#graph.edges] }; }
  get size(): { nodes: number; edges: number } { return { nodes: this.#graph.nodes.length, edges: this.#graph.edges.length }; }

  /** "Does a capability matching X exist?" — returns the matching FACTS (nodes), never an opinion. */
  search(q: CapabilityQuery = {}): CapabilityNode[] {
    const text = q.text?.trim().toLowerCase();
    return this.#graph.nodes.filter((n) => {
      if (q.kind && n.kind !== q.kind) return false;
      if (text && !(`${n.name} ${n.description}`.toLowerCase().includes(text))) return false;
      if (q.posture) { for (const k of Object.keys(q.posture) as (keyof CapabilityPosture)[]) { if (q.posture[k] && !n.posture[k]) return false; } }
      return true;
    });
  }

  /** The lineage of a capability — its node + the edges/nodes structurally related to it. */
  lineageOf(id: string): LineageView | null {
    const node = this.#graph.nodes.find((n) => n.id === id);
    if (!node) return null;
    const outgoing = this.#graph.edges.filter((e) => e.from === id);
    const incoming = this.#graph.edges.filter((e) => e.to === id);
    const relIds = new Set<string>([...outgoing.map((e) => e.to), ...incoming.map((e) => e.from)]);
    const related = this.#graph.nodes.filter((n) => relIds.has(n.id));
    return { node, outgoing, incoming, related };
  }
}

// ── audit tie-in (reuse) — record what the graph indexed / was asked, immutably ─────────────────────────────
export const CAPGRAPH_AUDIT_ALLOWLIST: readonly string[] = [
  'capabilityGraph', 'event', 'nodes', 'edges', 'kinds', 'kind', 'text', 'posture', 'hits', 'environment',
];

export type CapGraphEvent =
  | { type: 'graph.indexed'; nodes: number; edges: number; kinds: Record<string, number> }
  | { type: 'graph.queried'; query: CapabilityQuery; hits: number };

/**
 * Records a graph index/query event to the append-only, hash-chained audit via the audit-of-reads path — the
 * SAME store + pattern #2/#3/#4 use — so "what the graph indexed / was asked" is inspectable. Holds ONLY
 * `appendRead` + a redactor; it cannot approve/commit/act/mutate. The query text is inert data (allowlisted).
 */
export class CapabilityGraphAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'capability-reuse-graph' },
  ) {}

  async record(event: CapGraphEvent): Promise<AppendResult> {
    const base = event.type === 'graph.indexed'
      ? { capabilityGraph: 'index', event: event.type, nodes: event.nodes, edges: event.edges, kinds: event.kinds }
      : { capabilityGraph: 'query', event: event.type, kind: event.query.kind ?? null, text: event.query.text ?? null, posture: event.query.posture ?? null, hits: event.hits };
    const summary = this.redactor.redactSummary({ ...base, environment: this.environment });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: event.type === 'graph.queried' ? event.hits : event.nodes });
  }
}

/** Convenience: node counts per kind (for an index audit event). */
export function kindCounts(graph: CapabilityGraph): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of graph.nodes) out[n.kind] = (out[n.kind] ?? 0) + 1;
  return out;
}
