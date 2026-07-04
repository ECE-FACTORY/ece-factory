// Live Local-Preview wiring (Factory capability #3, composition layer) — supplies the factory-wired generator +
// auditor and an EXAMPLE manifest for a real factory-built thing (the Trust Layer slice, the subject named in
// REQUIREMENT_PRODUCT_DELIVERY_AND_LOCAL_RUNNABLE.md §5). Thin composition: NO guard logic, NO gate/bridge; it
// only generates a report and records it. It launches NOTHING — executing a preview command is the operator's
// action (or the Observer's local, non-consequential spawn), never a gated external action.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  LocalPreviewGenerator,
  PreviewAuditor,
  PREVIEW_AUDIT_ALLOWLIST,
  type PreviewManifest,
} from '../features/local-preview/local-preview.js';

/** The factory's Preview/Status generator, reusing the Observer's free-text secret scrubber. */
export function factoryPreviewGenerator(): LocalPreviewGenerator {
  return new LocalPreviewGenerator(SecretPatternRedactor);
}

/** Service identity for preview-report evidence (a service actor, never 'claude'/a fake human). */
export const PREVIEW_ACTOR: HumanActor = { user_id: 'local-preview', email: '', role: 'service' };

/** The preview auditor, wired to the factory's real hash-chain sink with the allowlist redactor. */
export function factoryPreviewAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = PREVIEW_ACTOR,
  environment: Environment = 'local',
): PreviewAuditor {
  return new PreviewAuditor(sink, new RedactionEngine(PREVIEW_AUDIT_ALLOWLIST), organizationId, actor, environment);
}

/**
 * EXAMPLE manifest for a real factory-built thing — the ECE Trust Layer slice (products/ece-trust-layer). It is
 * declared HONESTLY per the Local Preview Standard: present capabilities are the ones actually built (offline-
 * proven VC verify + hash-chain attestation), and packaging/installer + UI are declared `absent` (that is
 * capability #4, not built yet). This is the first subject the generator is wired to; the generator is reusable
 * for any future built thing.
 */
export const TRUST_LAYER_PREVIEW_MANIFEST: PreviewManifest = {
  name: 'ece-trust-layer',
  kind: 'product-slice',
  version: '0.1.0',
  runCommands: {
    install: 'cd products/ece-trust-layer && npm ci',
    run: 'cd products/ece-trust-layer && npm test',
    preview: 'cd products/ece-trust-layer && node --test test/*.test.ts',
    status: 'cd products/ece-trust-layer && node --test test/*.test.ts 2>&1 | tail -5',
  },
  demo: {
    command: 'cd products/ece-trust-layer && node --test test/*.test.ts',
    description: 'Runs the offline VC verify + hash-chain attestation slice against seed credentials (air-gapped).',
  },
  capabilities: [
    { id: 'vc-verify-offline', description: 'Verify a W3C VC fully offline (air-gap document loader throws on remote fetch)', state: 'present' },
    { id: 'hash-chain-attestation', description: 'Tamper-evident hash-chained attestation ledger', state: 'present' },
    { id: 'did-key', description: 'did:key issuance/verification', state: 'present' },
    { id: 'operator-ui', description: 'Operator-visible local UI for the trust layer', state: 'absent' },
    { id: 'downloadable-app', description: 'Packaged, versioned Mac app/installer (capability #4)', state: 'absent' },
  ],
  artifacts: [],
};
