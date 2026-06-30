// Tier-Status Health Reporter (Phase 9.2, OPEN_ITEM #10) — an operational, READ-ONLY reporter that makes
// the BACKING of each MCP tier explicit so a fake can never be mistaken for live.
//
// THE CORE: status is DERIVED FROM THE REAL INJECTED OBJECT, not a label. A tier is reported `live` only if
// the injected port is an `instanceof` that tier's known LIVE adapter class — a plain-object/closure fake (or
// any object that is not the live adapter) is structurally reported `fake`. There is no string a fake can set
// to claim `live`; it would have to actually BE the live adapter. Lives at the composition root (it legitimately
// inspects concrete wiring); it touches no guard logic, performs no writes, consumes no token, calls no
// external system, and emits NO secrets (role names / booleans / counts / backings only).

import { LiveFactoryReadPorts } from './live-read-adapters.js';
import { LiveWriteStores } from './live-write-adapters.js';
import { LiveGitHubRepoAdapter } from './live-github-adapter.js';
import { EXTERNAL_TOOLS, type ExternalTool } from '../features/mcp-bridge/external-tools.js';

export type TierBacking = 'live' | 'fake' | 'disabled' | 'not-wired';
/** The external tier can be MIXED once some actions go live and others stay fake (Phase 9.4). */
export type ExternalAggregateBacking = TierBacking | 'partial';

/** The external actions — reported per-action so a mixed tier (one live, five fake) is honest. Canonical
 *  source is the bridge's EXTERNAL_TOOLS (single source of truth — no re-hardcoded action names here). */
export const EXTERNAL_ACTIONS = EXTERNAL_TOOLS;
export type ExternalAction = ExternalTool;

export interface TierStatusReport {
  tiers: {
    read_only: TierBacking;
    draft_only: TierBacking;
    internal_write: TierBacking;
    external: ExternalAggregateBacking;
    forbidden: 'registered-and-refused';
  };
  /** Per-action external backing — derived from the REAL injected adapter instance (never a label). */
  externalByAction: Record<ExternalAction, TierBacking>;
  toolCounts: { read_only: number; draft_only: number; internal_write: number; external: number; forbidden: number };
  database: {
    /** true/false from a read-only probe; 'unknown' if no probe was supplied. */
    reachable: boolean | 'unknown';
    /** Whether the DB is persistent vs a throwaway cluster cannot be introspected — reported honestly. */
    persistenceKnown: false;
    /** Count of known migration-created core tables present (a proxy for migrations applied). */
    coreTablesPresent: number | 'unknown';
    coreTablesExpected: number;
  };
  /** Role NAMES only — never credentials/connection strings. */
  dbRoles: { read: string; write: string };
  /** The actual Claude Code registration is external to this process — reported honestly as not introspectable. */
  claudeCodeRegistration: 'unknown/external';
  generatedNote: string;
}

/** The known migration-created core tables (proxy for "migrations applied"). Names match the actual schema. */
export const CORE_TABLES = [
  'audit_intent', 'audit_result', 'audit_refusal', 'audit_read_log', 'repo_evaluation', 'domain_registration',
  'project_registration', 'risk_register', 'clients', 'review_log_entries', 'open_items', 'settings', 'field_definitions',
] as const;

/** A read-only DB probe (SELECT 1 + count of core tables). Injected so the reporter itself does no I/O. */
export interface DbProbe {
  (): Promise<{ reachable: boolean; coreTablesPresent: number }>;
}

export interface TierWiring {
  factoryPorts?: object;     // READ_ONLY backing
  draftPorts?: object;       // DRAFT_ONLY backing
  writeStores?: object;      // internal-write backing
  externalSystems?: object;  // external backing (single object — used as the fallback per-action backing)
  /**
   * Per-action external backing OBJECTS (the real adapter instances the bridge delegates to). When present,
   * each action's backing is derived from ITS instance (instanceof the live class) — so a partially-live
   * external tier is reported honestly. When absent, every action falls back to `externalSystems`.
   */
  externalAdapters?: Partial<Record<ExternalAction, object>>;
  readRole: string;          // role NAME only
  writeRole: string;         // role NAME only
  toolCounts: TierStatusReport['toolCounts'];
}

/** Aggregate the per-action external backings: all-live ⇒ live, all-not-wired ⇒ not-wired, none-live ⇒ fake, mixed ⇒ partial. */
function aggregateExternal(byAction: Record<ExternalAction, TierBacking>): ExternalAggregateBacking {
  const vals = EXTERNAL_ACTIONS.map((a) => byAction[a]);
  if (vals.every((v) => v === 'live')) return 'live';
  if (vals.every((v) => v === 'not-wired')) return 'not-wired';
  if (vals.some((v) => v === 'live')) return 'partial'; // some live + some not ⇒ honestly partial
  return 'fake';
}

/**
 * Derive a tier's backing from the ACTUAL injected object. `live` requires the object to be an instance of a
 * known live adapter class for that tier; missing ⇒ `not-wired`; anything else ⇒ `fake`. (Draft/external have
 * no live adapter class yet, so any injected backing for them is reported `fake` — never `live`.)
 */
export function deriveBacking(injected: object | undefined, liveClasses: ReadonlyArray<new (...args: never[]) => object>): TierBacking {
  if (injected === undefined || injected === null) return 'not-wired';
  for (const Cls of liveClasses) {
    if (injected instanceof Cls) return 'live';
  }
  return 'fake';
}

/** Build the tier-status report from the real wiring (sync) + an optional read-only DB probe. No side effects. */
export async function buildTierStatusReport(wiring: TierWiring, probe?: DbProbe): Promise<TierStatusReport> {
  let reachable: boolean | 'unknown' = 'unknown';
  let coreTablesPresent: number | 'unknown' = 'unknown';
  if (probe) {
    try {
      const r = await probe();
      reachable = r.reachable;
      coreTablesPresent = r.coreTablesPresent;
    } catch {
      reachable = false; // a failed probe is honestly "not reachable" — never assumed live
    }
  }
  // Per-action external backing — each derived from ITS real adapter instance (instanceof the live class);
  // fall back to the single `externalSystems` object when no per-action map is supplied. A fake is NEVER live.
  const externalByAction = Object.fromEntries(
    EXTERNAL_ACTIONS.map((a) => [a, deriveBacking(wiring.externalAdapters?.[a] ?? wiring.externalSystems, [LiveGitHubRepoAdapter])]),
  ) as Record<ExternalAction, TierBacking>;

  return {
    tiers: {
      read_only: deriveBacking(wiring.factoryPorts, [LiveFactoryReadPorts]),
      draft_only: deriveBacking(wiring.draftPorts, []),         // no live draft adapter exists ⇒ fake/not-wired
      internal_write: deriveBacking(wiring.writeStores, [LiveWriteStores]),
      external: aggregateExternal(externalByAction),            // live create_github_repo + fake others ⇒ partial
      forbidden: 'registered-and-refused',
    },
    externalByAction,
    toolCounts: wiring.toolCounts,
    database: { reachable, persistenceKnown: false, coreTablesPresent, coreTablesExpected: CORE_TABLES.length },
    dbRoles: { read: wiring.readRole, write: wiring.writeRole },
    claudeCodeRegistration: 'unknown/external',
    generatedNote: 'tier backings derived from the actual injected adapters (instanceof the live-class); a fake is never reported as live; this report carries only role names, booleans, counts and backings',
  };
}

/** A real read-only DB probe over a pg-like pool (SELECT 1 + core-table count). No writes. */
export function makeDbProbe(pool: { query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> }): DbProbe {
  return async () => {
    await pool.query('SELECT 1');
    // pg_catalog.pg_tables lists ALL tables in the schema regardless of the role's table privileges (so a
    // least-privilege role still gets the true migration state — information_schema would be privilege-filtered).
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename = ANY($1)`,
      [CORE_TABLES as unknown as string[]],
    );
    return { reachable: true, coreTablesPresent: Number(r.rows[0]?.n ?? 0) };
  };
}
