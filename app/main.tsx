import { createRoot } from 'react-dom/client';
import { CockpitApp } from './CockpitApp';
import './cockpit.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Cockpit mount point #root is missing');
}

createRoot(root).render(<CockpitApp />);
