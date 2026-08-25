import { createRoot } from 'react-dom/client';
import { SidePanel } from './SidePanel';
import './index.css';

// Follow the browser's preference; the design tokens key off `.dark`.
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark');
}

const container = document.getElementById('root');
if (!container) throw new Error('root container missing');
createRoot(container).render(<SidePanel />);
