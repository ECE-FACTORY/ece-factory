// App — mounts the shell with the Command Center in the workspace (step 2). Approvals arrives next.
import React from 'react';
import { Shell } from './shell/Shell.js';
import { CommandCenter } from './pages/command-center/CommandCenter.js';

export function App(): React.ReactElement {
  return (
    <Shell>
      <CommandCenter />
    </Shell>
  );
}
