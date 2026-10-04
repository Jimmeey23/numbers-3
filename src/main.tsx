import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { initializeCloudSync } from './sync/cloud';

await initializeCloudSync();
const { default: App } = await import('./App.tsx');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
