// StateClientProvider — supplies the EnvelopeClient (default: the real GET client). Injectable
// so tests drive pages with real captured envelopes or a killed API, with no network. Pages read
// the client from context and hand it to useEnvelope.
import React, { createContext, useContext } from 'react';
import { getEnvelope } from './state-client.js';
import type { EnvelopeClient } from './use-envelope.js';

const StateClientContext = createContext<EnvelopeClient>(getEnvelope);

export function StateClientProvider({ client, children }: { client?: EnvelopeClient; children: React.ReactNode }): React.ReactElement {
  return <StateClientContext.Provider value={client ?? getEnvelope}>{children}</StateClientContext.Provider>;
}

export function useStateClient(): EnvelopeClient {
  return useContext(StateClientContext);
}
