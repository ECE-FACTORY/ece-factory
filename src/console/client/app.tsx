// App — step 1 mounts only the empty shell. Command Center / Approvals arrive in later steps.
import React from 'react';
import { Shell } from './shell/Shell.js';

export function App(): React.ReactElement {
  return <Shell />;
}
