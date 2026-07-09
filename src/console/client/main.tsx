import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { StateClientProvider } from './data/state-context.js';
import './tokens.css';
import './type.css';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <StateClientProvider>
        <App />
      </StateClientProvider>
    </React.StrictMode>,
  );
}
