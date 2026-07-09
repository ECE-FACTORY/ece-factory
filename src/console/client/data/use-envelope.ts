// useEnvelope — the console's ONLY way to hold factory state, and the reason "kill the
// API → unavailable" is structural rather than disciplined.
//
// The invariant: this hook has NO last-good cache. Its state is exactly one of three
// values — loading | present | unavailable — and on ANY fetch failure it transitions to
// `unavailable`, DISCARDING whatever `present` value it held. There is no module-level
// cache, no ref that survives an error, no stale-while-revalidate. So when the State API
// dies, every field driven by this hook flips to `unavailable`; there is no code path that
// could re-show a previous value cached-as-current (Rule 0 / masterbuild M3.1).
//
// (This is exactly why the design rejects TanStack Query: a caching layer's whole job is to
// retain last-good data, which would defeat the honesty contract.)

import { useEffect, useRef, useState } from 'react';
import { getEnvelope } from './state-client.js';
import type { EnvelopeMeta, FactoryStateEnvelope } from '../contracts.js';

export type EnvelopeState<T> =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'present'; data: T; meta: EnvelopeMeta };

export interface EnvelopeHandle<T> {
  state: EnvelopeState<T>;
  /** Re-read from the API (manual refresh; M4 has no live push). Goes loading → present|unavailable. */
  reload: () => void;
}

/** The client function type — injectable so tests can drive present/kill without a network. */
export type EnvelopeClient = (path: string) => Promise<FactoryStateEnvelope<unknown>>;

export function useEnvelope<T>(
  path: string,
  parse: (data: unknown) => T,
  client: EnvelopeClient = getEnvelope,
): EnvelopeHandle<T> {
  const [state, setState] = useState<EnvelopeState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  // parse/client captured in refs so callers may pass inline functions without re-firing
  // the effect every render. The effect depends only on (path, nonce).
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    let alive = true;
    // Reset to loading on every (path, reload). We NEVER carry a prior `present` value
    // forward — there is deliberately no branch that keeps old data on the next read.
    setState({ status: 'loading' });
    clientRef
      .current(path)
      .then((env) => {
        const data = parseRef.current(env.data);
        if (alive) setState({ status: 'present', data, meta: env.meta });
      })
      .catch((err: unknown) => {
        // Failure/emptiness ⇒ `unavailable`. The previous value (if any) is dropped here;
        // it is not stored anywhere, so it cannot resurface as current.
        if (alive) setState({ status: 'unavailable', reason: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, [path, nonce]);

  return { state, reload: () => setNonce((n) => n + 1) };
}
