// Command Center — renders ONLY real factory state from the read plane, every value through
// <Field>/<Operational> so nothing is un-provenanced and a killed API flips every field to
// "unavailable" (no cached-as-current). The hero is the factory-flow strip: stages light from
// real counts; machinery that doesn't exist yet shows locked, honestly. Injectable client
// (context) so tests drive it with real envelopes or a dead API.
import React from 'react';
import { useEnvelope, type EnvelopeHandle } from '../../data/use-envelope.js';
import { useStateClient } from '../../data/state-context.js';
import { parseGit, parseTests, parseLaws, parseCapabilities, parseStores, parseReports, parseEvidence } from '../../data/parsers.js';
import { Field } from '../../primitives/Field.js';
import { Operational } from '../../primitives/Operational.js';
import { absent } from '../../contracts.js';
import { derivedCount } from './derive.js';
import { detectDiscrepancies } from './discrepancy.js';
import './command-center.css';

// A count derived from a provenanced list read, with the three envelope states handled.
function DerivedStat<D>({ handle, compute, label, route }: { handle: EnvelopeHandle<D>; compute: (d: D) => number; label: string; route: string }): React.ReactElement {
  const s = handle.state;
  if (s.status === 'loading') return <span className="op op--loading" data-loading=""><span className="op__value">…</span></span>;
  const field = s.status === 'unavailable' ? absent<number>(s.reason, new Date().toISOString()) : derivedCount(compute(s.data), route);
  return <Operational field={field} label={label} />;
}

export function CommandCenter(): React.ReactElement {
  const client = useStateClient();
  const git = useEnvelope('/state/git', parseGit, client);
  const tests = useEnvelope('/state/tests', parseTests, client);
  const laws = useEnvelope('/state/laws', parseLaws, client);
  const caps = useEnvelope('/state/capabilities', parseCapabilities, client);
  const stores = useEnvelope('/state/stores', parseStores, client);
  const reports = useEnvelope('/state/reports', parseReports, client);
  const evidence = useEnvelope('/state/evidence', parseEvidence, client);

  // Discrepancy detector (stub) — cross-check the fetched envelopes' HEAD pinning.
  const gitData = git.state.status === 'present' ? git.state.data : undefined;
  const gitHead = gitData && gitData.head.status === 'present' ? gitData.head.value : undefined;
  const recentTopSha = gitData && gitData.recent.status === 'present' ? gitData.recent.value[0]?.sha : undefined;
  const headOf = (h: EnvelopeHandle<unknown>) => (h.state.status === 'present' ? h.state.meta.head : undefined);
  const routeHandles: Array<[string, EnvelopeHandle<unknown>]> = [
    ['/state/tests', tests], ['/state/laws', laws], ['/state/capabilities', caps],
    ['/state/stores', stores], ['/state/reports', reports], ['/state/evidence', evidence],
  ];
  const envelopeHeads = routeHandles
    .map(([route, h]) => ({ route, head: headOf(h) }))
    .filter((e): e is { route: string; head: string } => typeof e.head === 'string');
  const discrepancies = detectDiscrepancies({ gitHead, recentTopSha, envelopeHeads });

  const countBuildPlans = (ev: ReturnType<typeof parseEvidence>) => (ev.status === 'present' ? ev.value.filter((e) => e.kind === 'build-plan').length : 0);

  return (
    <section className="cc" aria-label="Command Center">
      <h1 className="cc__title">Command Center</h1>

      {discrepancies.length > 0 && (
        <div className="banner banner--discrepancy" role="alert">
          <span className="banner__tag">discrepancy</span>
          <ul className="banner__list">
            {discrepancies.map((d) => (
              <li key={d.kind + d.detail}>{d.detail}</li>
            ))}
          </ul>
        </div>
      )}

      {/* HERO — the factory flow. Stages light from real counts; unbuilt machinery = locked. */}
      <div className="cc__flow" aria-label="Factory flow">
        <div className="flow__stage">
          <span className="flow__name">Harvest</span>
          <DerivedStat handle={reports} compute={(r) => r.length} label="harvest.reports" route="/state/reports" />
          <span className="flow__unit">reports</span>
        </div>
        <span className="flow__gate" aria-hidden="true">▣</span>
        <div className="flow__stage">
          <span className="flow__name">Approval</span>
          <Field handle={stores} pick={(d) => d.approvals} label="approval.count" render={(v) => String(v.count)} />
          <span className="flow__unit">records</span>
        </div>
        <span className="flow__gate" aria-hidden="true">▣</span>
        <div className="flow__stage">
          <span className="flow__name">Build</span>
          <DerivedStat handle={evidence} compute={countBuildPlans} label="build.plans" route="/state/evidence" />
          <span className="flow__unit">plans</span>
        </div>
        <span className="flow__gate" aria-hidden="true">▣</span>
        <div className="flow__stage">
          <span className="flow__name">Execute</span>
          <Field handle={stores} pick={(d) => d.executions} label="execute.count" render={(v) => String(v.count)} />
          <span className="flow__unit">runs</span>
        </div>
        <span className="flow__gate" aria-hidden="true">·</span>
        <div className="flow__stage flow__stage--locked">
          <span className="flow__name">Harden</span>
          <span className="flow__locked">locked</span>
          <span className="flow__unit">machinery unbuilt</span>
        </div>
      </div>

      <div className="cc__grid">
        <article className="panel">
          <h2 className="panel__title">Repository</h2>
          <div className="panel__row"><span className="panel__label">HEAD</span><Field handle={git} pick={(d) => d.head} label="git.head" /></div>
          <div className="panel__row"><span className="panel__label">Branch</span><Field handle={git} pick={(d) => d.branch} label="git.branch" /></div>
          <div className="panel__row"><span className="panel__label">Working tree</span><Field handle={git} pick={(d) => d.dirty} label="git.dirty" render={(v) => (v ? 'dirty' : 'clean')} /></div>
        </article>

        <article className="panel">
          <h2 className="panel__title">Tests</h2>
          <div className="panel__row"><span className="panel__label">Total</span><Field handle={tests} pick={(d) => d.total} label="tests.total" /></div>
          <div className="panel__row"><span className="panel__label">Passed</span><Field handle={tests} pick={(d) => d.passed} label="tests.passed" /></div>
          <div className="panel__row"><span className="panel__label">Failed</span><Field handle={tests} pick={(d) => d.failed} label="tests.failed" /></div>
          <div className="panel__row"><span className="panel__label">Skipped</span><Field handle={tests} pick={(d) => d.skipped} label="tests.skipped" /></div>
        </article>

        <article className="panel">
          <h2 className="panel__title">Law</h2>
          <div className="panel__row"><span className="panel__label">Passed</span><Field handle={laws} pick={(d) => d.passed} label="laws.passed" /></div>
          <div className="panel__row"><span className="panel__label">Failed</span><Field handle={laws} pick={(d) => d.failed} label="laws.failed" /></div>
          <div className="panel__row panel__row--wrap">
            <Field
              handle={laws}
              pick={(d) => d.prohibitions}
              label="laws.prohibitions"
              render={(list) => (
                <span className="chips">
                  {list.map((p) => (
                    <span key={p.id} className={`chip chip--${p.status}`} title={p.title}>{p.id}</span>
                  ))}
                </span>
              )}
            />
          </div>
        </article>

        <article className="panel">
          <h2 className="panel__title">Write boundary</h2>
          <div className="panel__row"><span className="panel__label">Sandbox jail</span><Field handle={caps} pick={(d) => d.sandboxJailPrefix} label="cap.jail" /></div>
          <div className="panel__row"><span className="panel__label">Mint</span><Field handle={caps} pick={(d) => d.mintPrivacy} label="cap.mint" render={(v) => v.status} /></div>
          <div className="panel__row panel__row--wrap"><span className="panel__label">Write tools</span><Field handle={caps} pick={(d) => d.writeTools} label="cap.writeTools" render={(v) => v.join('  ·  ')} /></div>
          <div className="panel__row panel__row--wrap"><span className="panel__label">Seam tools</span><Field handle={caps} pick={(d) => d.seamTools} label="cap.seamTools" render={(v) => v.join('  ·  ')} /></div>
        </article>

        <article className="panel panel--wide">
          <h2 className="panel__title">Recent milestones</h2>
          <Field
            handle={git}
            pick={(d) => d.recent}
            label="git.recent"
            render={(list) => (
              <ol className="milestones">
                {list.map((c) => (
                  <li key={c.sha} className="milestone">
                    <span className="milestone__sha">{c.sha.slice(0, 7)}</span>
                    <span className="milestone__subject">{c.subject}</span>
                    <span className="milestone__author">{c.author}</span>
                  </li>
                ))}
              </ol>
            )}
          />
        </article>
      </div>
    </section>
  );
}
