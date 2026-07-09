// StoreAdapter — approvals / audit / executions stores land in M3. In M2 they DO NOT EXIST, so this returns an
// HONEST typed absent (value null + a reason) — never a mocked record (Design §6, Rule 0.4). When M3 lands the
// real stores, the `absent` branches flip to `present` with real provenance; the contract is unchanged (the
// Provenanced union already models both).

import { absent } from '../contracts/index.js';
import type { StoreState, StoreSnapshot } from '../contracts/index.js';

const nowIso = () => new Date().toISOString();
const REASON = 'store not built — approvals / audit / executions land in M3 (StoreAdapter). Honest absent, never a mocked record.';

export function storeState(now: () => string = nowIso): StoreState {
  return {
    approvals: absent<StoreSnapshot>(REASON, now()),
    audit: absent<StoreSnapshot>(REASON, now()),
    executions: absent<StoreSnapshot>(REASON, now()),
  };
}
