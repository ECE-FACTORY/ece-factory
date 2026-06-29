// Repo Builder / Operator (Module 29) — a typed PLANNER that, given an approved project, produces a
// governed-repo build plan (Layer 2 §5 structure) + §11 upstream-tracking entries.
//
// CORE GUARANTEE — PLANS, NEVER EXECUTES: no filesystem writes, no git, no network. A plan's status is
// the single literal type 'PLAN-AWAITING-APPROVAL'; there is NO code path and NO type variant that
// creates a real repo or reports "executed"/"created". Repo creation is a real side-effecting action —
// this module recommends; a human approves; actual creation happens later through a gated action layer.
//
// HARVEST-BEFORE-BUILD (inherited): the planner REFUSES to even plan a repo for a project whose
// gateView.clearedToBuild !== true. DENY-BY-DEFAULT: unverifiable input ⇒ refuse, never "probably fine".
//
// STANDALONE-PACKAGEABLE: the only cross-engine reference is `import type` (the Project-Registry gate).

import type { GateView } from '../project-registry/project-registry.js';

/** The required Layer 2 §5 source-of-truth docs (mirrors the Doc Engine's set; listed locally to stay standalone). */
export const REPO_DOCS = [
  'PROJECT_SOURCE_OF_TRUTH', 'PROJECT_MAP', 'ARCHITECTURE', 'IMPLEMENTATION_PLAN', 'FEATURE_REGISTRY',
  'DECISION_LOG', 'REPO_AUDIT', 'OPEN_ITEMS', 'SECURITY_NOTES', 'DEPLOYMENT', 'TESTING', 'UPSTREAM_TRACKING',
] as const;

export interface ForkedRepo {
  name: string;
  upstreamUrl: string;
  license: string;
  forkPointCommit?: string;
}

export interface RepoBuildRequest {
  project: string;
  repo: string;
  gate: GateView;
  features?: string[];
  forkedRepos?: ForkedRepo[];
}

export interface PlannedDir {
  path: string;
}
export interface PlannedFile {
  path: string;
  purpose: string;
}
export interface UpstreamTrackingEntry {
  repo: string;
  upstreamUrl: string;
  license: string;
  forkPointCommit: string | null;
}

export interface BuildPlan {
  project: string;
  repo: string;
  directories: PlannedDir[];
  files: PlannedFile[];
  upstreamTracking: UpstreamTrackingEntry[];
  notes: string[];
}

/** Outcome — a plan awaiting approval, or a refusal. There is NO "executed"/"created" outcome. */
export type RepoBuildOutcome =
  | { status: 'PLAN-AWAITING-APPROVAL'; plan: BuildPlan }
  | { status: 'REFUSED'; reason: string };

export class RepoBuilder {
  /** Produce a build PLAN (never executes). Refuses uncleared / unverifiable projects. */
  plan(req: RepoBuildRequest): RepoBuildOutcome {
    // Deny-by-default: required input must be present and verifiable.
    if (!req?.project?.trim() || !req?.repo?.trim()) {
      return { status: 'REFUSED', reason: 'unverifiable input — project and repo are required (deny-by-default)' };
    }
    if (!req.gate || typeof req.gate.clearedToBuild !== 'boolean') {
      return { status: 'REFUSED', reason: 'unverifiable gate state — clearedToBuild unknown (deny-by-default)' };
    }
    // Harvest-before-build gate inherited: no repo is even PLANNED for an uncleared project.
    if (req.gate.clearedToBuild !== true) {
      return { status: 'REFUSED', reason: `not cleared to build — ${req.gate.reason} (no repo is planned without harvest approval)` };
    }

    const features = req.features ?? [];
    const forked = req.forkedRepos ?? [];

    const directories: PlannedDir[] = [
      { path: 'docs' },
      { path: 'src' },
      { path: 'src/features' },
      { path: 'tests' },
      { path: 'tests/unit' },
      { path: 'tests/integration' },
      { path: 'tests/e2e' },
      { path: 'scripts' },
      { path: 'infra' },
      ...features.flatMap((f) => [{ path: `src/features/${f}` }, { path: `src/features/${f}/tests` }]),
    ];

    const files: PlannedFile[] = [
      { path: 'CLAUDE.md', purpose: 'binding local enforcement file (from org template)' },
      { path: 'README.md', purpose: 'project README (Layer 2 §16)' },
      { path: 'SECURITY.md', purpose: 'security policy (Layer 2 §19)' },
      { path: 'CONTRIBUTING.md', purpose: 'contribution guide' },
      { path: 'CHANGELOG.md', purpose: 'change log' },
      { path: '.env.example', purpose: 'env template — no real secrets (Layer 2 §17)' },
      { path: '.gitignore', purpose: 'ignore node_modules / .env / build artifacts' },
      { path: '.github/workflows/ci.yml', purpose: 'CI: install + lint + typecheck + test + build + security (Layer 2 §20)' },
      ...REPO_DOCS.map((d) => ({ path: `docs/${d}.md`, purpose: `Layer 2 §5 source-of-truth doc: ${d}` })),
      ...features.map((f) => ({ path: `src/features/${f}/${f}.feature.md`, purpose: `feature file (Layer 2 §9) for ${f}` })),
    ];

    const upstreamTracking: UpstreamTrackingEntry[] = forked.map((r) => ({
      repo: r.name, upstreamUrl: r.upstreamUrl, license: r.license, forkPointCommit: r.forkPointCommit ?? null,
    }));

    const notes = [
      'PLAN ONLY — no filesystem/git/network action is taken. Repo creation requires human approval via the gated action layer (Wave 5).',
      ...(forked.length ? [`§11 upstream-tracking entries planned for ${forked.length} forked repo(s); preserve upstream license notices.`] : []),
    ];

    return { status: 'PLAN-AWAITING-APPROVAL', plan: { project: req.project, repo: req.repo, directories, files, upstreamTracking, notes } };
  }
}
