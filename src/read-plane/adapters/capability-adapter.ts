// CapabilityAdapter — reports the factory's capability posture by IMPORTING the real source constants, never
// restating them (Design §4, Rule 0.3). If the executor changes a constant, this follows automatically; there is
// no hardcoded '/tmp/ece-dryrun-' literal here, so the value cannot silently drift. Provenance source is
// 'source-constant' with the exact module + export it was read from. Read-only: it holds no write/mint power
// (importing a string constant grants nothing) — frozen by Rule 0.2.

import { JAIL_PREFIX, FILESYSTEM_EXECUTE_TOOL } from '../../layer-5-action/filesystem-executor/filesystem-executor.js';
import { FILESYSTEM_SCAFFOLD_TOOL } from '../../layer-5-action/filesystem-adapter-dryrun/filesystem-adapter-dryrun.js';
import { TOOL_CLASSES } from '../../layer-5-action/mcp-bridge/tool-classes.js';
import { EXECUTE_CONFIRM_TOKEN } from '../../layer-4-build-harden/build-chain-orchestrator/build-chain-orchestrator.js';
import { APPROVE_BUILD_DECISION_TOOL } from '../../layer-2-command/build-decision-seam/build-decision-seam.js';
import { APPROVE_BUILD_DECISION_SUBSCRIPTION_TOOL } from '../../layer-2-command/subscription-decision-seam/subscription-decision-seam.js';
import { present } from '../contracts/index.js';
import type { CapabilityState, Provenanced } from '../contracts/index.js';

const nowIso = () => new Date().toISOString();

function fromConstant<T>(value: T, moduleRel: string, exportName: string, now: () => string): Provenanced<T> {
  return present(value, { source: 'source-constant', locator: { kind: 'module', module: moduleRel, export: exportName }, pin: { kind: 'none' }, readAt: now() });
}

export function capabilityState(now: () => string = nowIso): CapabilityState {
  return {
    sandboxJailPrefix: fromConstant(JAIL_PREFIX, 'src/layer-5-action/filesystem-executor/filesystem-executor.ts', 'JAIL_PREFIX', now),
    toolClasses: fromConstant([...TOOL_CLASSES], 'src/layer-5-action/mcp-bridge/tool-classes.ts', 'TOOL_CLASSES', now),
    writeTools: fromConstant([FILESYSTEM_EXECUTE_TOOL, FILESYSTEM_SCAFFOLD_TOOL], 'src/layer-5-action', 'FILESYSTEM_EXECUTE_TOOL,FILESYSTEM_SCAFFOLD_TOOL', now),
    seamTools: fromConstant([APPROVE_BUILD_DECISION_TOOL, APPROVE_BUILD_DECISION_SUBSCRIPTION_TOOL], 'src/layer-2-command', 'APPROVE_BUILD_DECISION_TOOL,APPROVE_BUILD_DECISION_SUBSCRIPTION_TOOL', now),
    confirmToken: fromConstant(EXECUTE_CONFIRM_TOKEN, 'src/layer-4-build-harden/build-chain-orchestrator/build-chain-orchestrator.ts', 'EXECUTE_CONFIRM_TOKEN', now),
    // 'gated' = reachable only through a human gate. Proof phrased WITHOUT the private identifiers (Rule 0.2).
    mintPrivacy: fromConstant(
      { status: 'gated' as const, proof: 'the approval-token mint + its brand symbol are module-private to the bridge (Prohibition 4a); each deciding→building seam constructs a decision ONLY inside a token-gated write handler (Prohibitions 4i / 4k)' },
      'src/architecture/write-asks-read-first.test.ts', 'Prohibition 4a / 4i / 4k', now,
    ),
  };
}
