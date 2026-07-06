// Kill Switch / Emergency Control (Module 33).
//
// Runtime, deployment-free disabling at six scopes: one tool, all write tools, a named connector,
// an environment, the entire bridge, Autopilot. Activation takes effect IMMEDIATELY — the next
// authorization decision sees it (in-memory current state; no redeploy, no restart).
//
// Activating/deactivating a kill switch is a security-critical, audit-worthy event ("who killed
// what, when, why"). State changes are emitted through an injected KillSwitchAuditHook port, which
// the composition routes to the Audit Engine — even though current state is held in memory.
//
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine. Defines its own types and audit
// port; the Audit Engine adapter is injected.

export interface KillSwitchQuery {
  toolName: string;
  readOrWrite?: 'read' | 'write';
  connector?: string;
  environment?: string;
  autopilot?: boolean;
}

/** Read-only interface the Permission Engine consults (least privilege). */
export interface KillSwitchReader {
  /** True iff this call is killed by any active scope. */
  isKilled(q: KillSwitchQuery): boolean;
  /** Human-readable reason if killed, else null (used for refusal reasons). */
  reason(q: KillSwitchQuery): string | null;
}

export type KillScope =
  | { type: 'tool'; name: string }
  | { type: 'all-writes' }
  | { type: 'connector'; id: string }
  | { type: 'environment'; env: string }
  | { type: 'bridge' }
  | { type: 'autopilot' };

export interface KillSwitchChangeEvent {
  action: 'activate' | 'deactivate';
  scope: KillScope;
  actor: string; // the human who flipped it (never "claude")
  reason: string; // why
  at: string; // ISO timestamp (when)
}

/** Port for auditing state changes — the composition injects an Audit Engine adapter. */
export interface KillSwitchAuditHook {
  record(event: KillSwitchChangeEvent): void | Promise<void>;
}

export class InMemoryKillSwitch implements KillSwitchReader {
  private bridge = false;
  private autopilotKilled = false;
  private allWrites = false;
  private readonly tools = new Set<string>();
  private readonly connectors = new Set<string>();
  private readonly environments = new Set<string>();
  private readonly log: KillSwitchChangeEvent[] = [];

  constructor(private readonly audit?: KillSwitchAuditHook) {}

  reason(q: KillSwitchQuery): string | null {
    if (this.bridge) return 'entire bridge is killed';
    if (this.autopilotKilled && q.autopilot) return 'autopilot is killed';
    if (this.allWrites && q.readOrWrite === 'write') return 'all write tools are killed';
    if (this.tools.has(q.toolName)) return `tool "${q.toolName}" is killed`;
    if (q.connector && this.connectors.has(q.connector)) return `connector "${q.connector}" is killed`;
    if (q.environment && this.environments.has(q.environment)) return `environment "${q.environment}" is killed`;
    return null;
  }

  isKilled(q: KillSwitchQuery): boolean {
    return this.reason(q) !== null;
  }

  /** Activate a kill (takes effect immediately) and emit an audit event. */
  activate(scope: KillScope, actor: string, reason: string): void {
    this.apply(scope, true);
    this.emit('activate', scope, actor, reason);
  }

  /** Deactivate a kill (takes effect immediately) and emit an audit event. */
  deactivate(scope: KillScope, actor: string, reason: string): void {
    this.apply(scope, false);
    this.emit('deactivate', scope, actor, reason);
  }

  /** Local change log (introspection); the injected hook carries these to the Audit Engine. */
  changeLog(): readonly KillSwitchChangeEvent[] {
    return [...this.log];
  }

  private apply(scope: KillScope, on: boolean): void {
    switch (scope.type) {
      case 'bridge': this.bridge = on; break;
      case 'autopilot': this.autopilotKilled = on; break;
      case 'all-writes': this.allWrites = on; break;
      case 'tool': if (on) this.tools.add(scope.name); else this.tools.delete(scope.name); break;
      case 'connector': if (on) this.connectors.add(scope.id); else this.connectors.delete(scope.id); break;
      case 'environment': if (on) this.environments.add(scope.env); else this.environments.delete(scope.env); break;
    }
  }

  private emit(action: 'activate' | 'deactivate', scope: KillScope, actor: string, reason: string): void {
    if (actor.trim().toLowerCase() === 'claude') throw new Error('kill-switch actor may not be "claude" — must be a real human');
    const event: KillSwitchChangeEvent = { action, scope, actor, reason, at: new Date().toISOString() };
    this.log.push(event);
    void this.audit?.record(event);
  }
}
