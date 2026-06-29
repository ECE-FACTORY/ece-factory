import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import { PostgresHashChainSink } from './postgres-sink.js';
import { WriteAheadSequencer, AllowAllAuthorizer, type CommittedIntent, type SequencerRequest } from './sequencer.js';

// T1–T4, T11 — the write-ahead sequencer. NO mocks: real PostgreSQL throughout
// (T2's "audit unavailable" uses a real pool pointed at an unreachable port).

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};

const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool);
const seq = new WriteAheadSequencer(sink, new AllowAllAuthorizer());
let su: InstanceType<typeof Client>;

function reqFor(org: string): SequencerRequest {
  return {
    principal: { user_id: `human_${org}`, email: `${org}@ece.ae`, role: 'admin' },
    organization_id: org,
    session: { session_id: `sess_${org}` },
    tool: { name: 'search_clients' },
    environment: 'local',
    via: 'claude', // the model is the conduit, not the actor
  };
}

beforeAll(async () => {
  su = new Client({ ...cfg, user: 'postgres' });
  await su.connect();
});
afterAll(async () => {
  await pool.end();
  await su.end();
});

describe('T1 — log-before-execute (write-ahead ordering)', () => {
  it('the intent is durably committed BEFORE execute runs; the result is not yet present', async () => {
    let intentDurableAtExecute = false;
    let resultAbsentAtExecute = false;
    const out = await seq.run(reqFor('orgT1'), async (committed: CommittedIntent) => {
      const i = await su.query('SELECT 1 FROM audit_intent WHERE intent_id=$1', [committed.intent_id]);
      intentDurableAtExecute = i.rowCount === 1;
      const r = await su.query('SELECT 1 FROM audit_result WHERE intent_id=$1', [committed.intent_id]);
      resultAbsentAtExecute = r.rowCount === 0;
      return { value: 'ok', outcome: { status: 'success' as const } };
    });
    expect(out.status).toBe('completed');
    expect(intentDurableAtExecute).toBe(true); // intent committed before execute
    expect(resultAbsentAtExecute).toBe(true); // result only after execute
  });
});

describe('T2 — fail-closed (audit unavailable ⇒ no execution)', () => {
  it('when intent-commit fails, execute never runs and the action is refused', async () => {
    const deadPool = new Pool({ ...cfg, user: 'ece_app', port: 1, connectionTimeoutMillis: 1500 });
    const deadSink = new PostgresHashChainSink(deadPool);
    const deadSeq = new WriteAheadSequencer(deadSink, new AllowAllAuthorizer());
    let executed = false;
    const out = await deadSeq.run(reqFor('orgT2'), async () => {
      executed = true;
      return { value: 1, outcome: { status: 'success' as const } };
    });
    await deadPool.end();
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('intent-commit');
    expect(executed).toBe(false); // the core guarantee: nothing ran without a durable audit
  });
});

describe('T3 — intent↔result pairing + orphan detection', () => {
  it('a crashed execution (intent, no result) is flagged; a completed run is not', async () => {
    const ok = await seq.run(reqFor('orgT3'), async () => ({ value: 1, outcome: { status: 'success' as const } }));
    expect(ok.status).toBe('completed');
    const completedId = ok.status === 'completed' ? ok.intent.intent_id : '';

    // Simulate a crash mid-execution: an intent committed with no matching result.
    const crashed = await sink.appendIntent({
      organization_id: 'orgT3',
      human_actor: { user_id: 'human_orgT3', email: 'orgT3@ece.ae', role: 'admin' },
      session: { session_id: 'crash' },
      tool: { name: 'search_clients' },
      authz: { decision: 'ALLOW' },
      environment: 'local',
    });

    const orphans = await seq.reconcileOrphans('orgT3', { olderThanSeconds: 0 });
    const ids = orphans.map((o) => o.intent_id);
    expect(ids).toContain(crashed.intent_id); // the orphan is surfaced
    expect(ids).not.toContain(completedId); // the completed run is not an orphan
  });
});

describe('T4 — no-skip (type-enforced)', () => {
  it('a CommittedIntent cannot be fabricated; execute only receives a real committed intent', async () => {
    // COMPILE-TIME proof (validated by `npm run typecheck`): the brand cannot be forged.
    // @ts-expect-error CommittedIntent is branded with a module-private symbol — cannot be forged.
    const fabricated: CommittedIntent = { intent_id: 'x', organization_id: 'o', seq: 1 };
    void fabricated;

    // Runtime: execute receives a real, durable intent id (a uuid).
    let receivedId = '';
    await seq.run(reqFor('orgT4'), async (committed) => {
      receivedId = committed.intent_id;
      return { value: 1, outcome: { status: 'success' as const } };
    });
    expect(receivedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

describe('T11 — human attribution (never "claude")', () => {
  it('records the human as the actor and the model only as the via conduit', async () => {
    const out = await seq.run(reqFor('orgT11'), async () => ({ value: 'ok', outcome: { status: 'success' as const } }));
    expect(out.status).toBe('completed');
    const r = await su.query<{ human_actor: { user_id: string }; via: string }>(
      'SELECT human_actor, via FROM audit_intent WHERE organization_id=$1 ORDER BY seq DESC LIMIT 1', ['orgT11'],
    );
    expect(r.rows[0]!.human_actor.user_id).toBe('human_orgT11');
    expect(r.rows[0]!.human_actor.user_id).not.toBe('claude');
    expect(r.rows[0]!.via).toBe('claude');
  });

  it('refuses a request whose principal is "claude" (validate guard; DB CHECK is the backstop)', async () => {
    const out = await seq.run(
      { ...reqFor('orgT11b'), principal: { user_id: 'claude', email: 'c@x', role: 'bot' } },
      async () => ({ value: 1, outcome: { status: 'success' as const } }),
    );
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('validate');
  });
});
