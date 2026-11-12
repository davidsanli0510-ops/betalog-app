import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { startAutoSync } from './data/sync';
import { Clips } from './replay/clips';
import { requestPersist } from './install';

startAutoSync();
Clips.load();
requestPersist();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
