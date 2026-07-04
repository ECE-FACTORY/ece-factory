// Live App-Packaging wiring (Factory capability #4, composition layer) — supplies the Node fs/crypto ports, a
// DEFAULT pluggable Mac bundler (a structured .app directory a real .dmg/pkgbuild step consumes), and the SBOM
// dependency resolver (reusing the factory's Module-10 license classifier). Thin composition: NO guard logic, NO
// gate/bridge, NO external publish. It only writes local artifacts + a manifest; producing a local package is
// generate-only. Swapping in a real electron/tauri/pkgbuild bundler = replace `StructuredDirBundler`, nothing else.

import { mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import { classifyLicense } from '../features/license-compliance/license-compliance.js';
import { nodeArtifactProbe } from './live-build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  AppPackagingFlow,
  PackagingAuditor,
  PACKAGING_AUDIT_ALLOWLIST,
  type MacBundler,
  type BundleRequest,
  type BundleResult,
  type DependencyResolver,
  type PackageWriter,
  type ExistingVersions,
  type PackageManifest,
  type RawDependency,
  type PackagingConfig,
} from '../features/app-packaging/app-packaging.js';

/**
 * DEFAULT Mac bundler — produces a structured `<name>-<version>.app` directory (Contents/MacOS + Resources +
 * Info.plist) with the source artifacts copied into Resources and a launcher stub. Pure local fs (no shell, no
 * network) — non-consequential generation. A real .dmg/notarize step consumes this directory; a real
 * electron/tauri/pkgbuild bundler implements the same `MacBundler` interface and drops in unchanged.
 */
export const StructuredDirBundler: MacBundler = {
  async bundle(req: BundleRequest): Promise<BundleResult> {
    const appRoot = path.join(req.outDir, `${req.name}-${req.version}.app`);
    const macos = path.join(appRoot, 'Contents', 'MacOS');
    const resources = path.join(appRoot, 'Contents', 'Resources');
    mkdirSync(macos, { recursive: true });
    mkdirSync(resources, { recursive: true });

    const infoPlist = path.join(appRoot, 'Contents', 'Info.plist');
    writeFileSync(infoPlist, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      `  <key>CFBundleName</key><string>${req.name}</string>`,
      `  <key>CFBundleShortVersionString</key><string>${req.version}</string>`,
      `  <key>CFBundleIdentifier</key><string>ae.ece.${req.name.replace(/[^A-Za-z0-9.]/g, '-')}</string>`,
      '  <key>CFBundlePackageType</key><string>APPL</string>',
      '</dict></plist>',
      '',
    ].join('\n'));

    const artifactPaths: string[] = [infoPlist];
    for (const a of req.sourceArtifacts) {
      const dest = path.join(resources, path.basename(a.path));
      try { copyFileSync(a.path, dest); artifactPaths.push(dest); } catch { /* source artifact missing on disk — skip; checksums cover only what landed */ }
    }
    const launcher = path.join(macos, 'run');
    writeFileSync(launcher, `#!/bin/sh\n# launcher stub for ${req.name} ${req.version}\necho "run ${req.name} ${req.version}"\n`);
    artifactPaths.push(launcher);

    return {
      bundler: 'structured-dir-bundler/1',
      format: 'macapp-dir',
      artifactPaths,
      installInstructions: `Copy ${req.name}-${req.version}.app to /Applications and open it — no source repo required.`,
    };
  },
};

/** Writes the package manifest as JSON alongside the artifact (one file per name+version — no clobber). */
export const nodePackageWriter: PackageWriter = async (manifest: PackageManifest, outDir: string) => {
  mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, `${manifest.name}-${manifest.version}.package.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { manifestPath };
};

/** Scans outDir for already-written package manifests of a name → the set of versions already packaged. */
export const nodeExistingVersions: ExistingVersions = (name: string, outDir: string) => {
  const versions = new Set<string>();
  if (!existsSync(outDir)) return versions;
  const re = new RegExp(`^${name.replace(/[^A-Za-z0-9]/g, '\\$&')}-(.+)\\.package\\.json$`);
  for (const f of readdirSync(outDir)) {
    const m = re.exec(f);
    if (m) versions.add(m[1]);
  }
  return versions;
};

/** Best-effort SBOM dependency resolver: reads a package.json's dependencies + each dep's LICENSE/declared SPDX
 *  from node_modules where available (reusing the factory's dependency/license knowledge). */
export function factoryDependencyResolver(pkgJsonPath: string): DependencyResolver {
  return () => {
    const out: RawDependency[] = [];
    let pkg: { dependencies?: Record<string, string> } = {};
    try { pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')); } catch { return out; }
    const root = path.dirname(pkgJsonPath);
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      const modDir = path.join(root, 'node_modules', name);
      let declaredSpdx: string | undefined;
      let licenseText: string | undefined;
      try { declaredSpdx = (JSON.parse(readFileSync(path.join(modDir, 'package.json'), 'utf8')) as { license?: string }).license; } catch { /* dep not installed */ }
      for (const lf of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) {
        try { licenseText = readFileSync(path.join(modDir, lf), 'utf8'); break; } catch { /* try next */ }
      }
      out.push({ name, version: String(version).replace(/^[^0-9]*/, '') || String(version), declaredSpdx, licenseText });
    }
    return out;
  };
}

/** The factory's governed packaging flow, wired to the default Mac bundler + real fs/crypto + license classifier. */
export function factoryPackagingFlow(deps: DependencyResolver, cfg: PackagingConfig = {}): AppPackagingFlow {
  return new AppPackagingFlow(
    StructuredDirBundler,
    deps,
    classifyLicense,
    nodeArtifactProbe,
    nodePackageWriter,
    { redactor: SecretPatternRedactor, existingVersions: nodeExistingVersions, ...cfg },
  );
}

/** Service identity for packaging evidence (a service actor, never 'claude'/a fake human). */
export const PACKAGING_ACTOR: HumanActor = { user_id: 'app-packaging', email: '', role: 'service' };

/** The packaging auditor, wired to the factory's real hash-chain sink with the allowlist redactor. */
export function factoryPackagingAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = PACKAGING_ACTOR,
  environment: Environment = 'local',
): PackagingAuditor {
  return new PackagingAuditor(sink, new RedactionEngine(PACKAGING_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
