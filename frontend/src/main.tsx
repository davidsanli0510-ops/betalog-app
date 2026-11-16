import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { Clips } from './replay/clips';
import { registerOffline, requestPersist } from './install';

Clips.load();
requestPersist();
registerOffline();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
