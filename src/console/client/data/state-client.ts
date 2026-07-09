// state-client — the console's sole conduit to the factory, and it speaks ONLY GET.
// Every failure (unreachable, non-2xx, malformed) becomes a thrown StateApiUnavailable,
// which useEnvelope turns into the `unavailable` state. There is no POST/PUT/DELETE here
// and nowhere else in the client — the console holds no write/gate/mint path by construction.

import type { FactoryStateEnvelope } from '../contracts.js';

export class StateApiUnavailable extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'StateApiUnavailable';
  }
}

/** Same-origin GET; the dev proxy / prod host maps /state/* and /healthz to server/serve.ts. */
export async function getEnvelope(path: string): Promise<FactoryStateEnvelope<unknown>> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'GET', headers: { accept: 'application/json' } });
  } catch (e) {
    throw new StateApiUnavailable(path, `state API unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new StateApiUnavailable(path, `state API returned ${res.status} for ${path}`);
  const json = (await res.json()) as unknown;
  if (!json || typeof json !== 'object' || !('data' in json) || !('meta' in json)) {
    throw new StateApiUnavailable(path, `malformed envelope for ${path}`);
  }
  return json as FactoryStateEnvelope<unknown>;
}
