// Shell — the three-zone frame (left rail · center workspace · right inspector). Step 1 is
// the empty foundation: it renders only static chrome (layer names, nav labels) — NO factory
// state. Operational data arrives with the Command Center in a later step, always through
// <Operational>. The six-layer rail encodes the factory's real architecture (L1…L6), not
// decoration.

import React from 'react';

const LAYERS = ['L1 · LAW', 'L2 · COMMAND', 'L3 · HARVEST', 'L4 · BUILD', 'L5 · ACTION', 'L6 · INTEL'];

export function Shell({ children }: { children?: React.ReactNode }): React.ReactElement {
  return (
    <div className="shell">
      <header className="shell__topbar">
        <span className="shell__brand">ECE · SOVEREIGN COMMAND CONSOLE</span>
        <span className="shell__mode">read-only · foundation</span>
      </header>
      <div className="shell__body">
        <nav className="shell__rail" aria-label="Factory layers and navigation">
          <ol className="rail__layers">
            {LAYERS.map((l) => (
              <li key={l} className="rail__layer">
                {l}
              </li>
            ))}
          </ol>
          <div className="rail__nav">
            <span className="rail__page rail__page--active">Command Center</span>
            <span className="rail__page">Approvals</span>
            <span className="rail__page rail__page--locked">Harvest · locked</span>
            <span className="rail__page rail__page--locked">Build · locked</span>
            <span className="rail__page rail__page--locked">Audit · locked</span>
            <span className="rail__page rail__page--locked">Evidence · locked</span>
            <span className="rail__page rail__page--locked">Law · locked</span>
          </div>
        </nav>
        <main className="shell__workspace">
          {children ?? <p className="workspace__placeholder">Foundation only — pages arrive in later steps.</p>}
        </main>
        <aside className="shell__inspector" aria-label="Inspector">
          <p className="inspector__empty">Select an object to inspect its provenance.</p>
        </aside>
      </div>
    </div>
  );
}
