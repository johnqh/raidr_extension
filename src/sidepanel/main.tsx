import { createRoot } from 'react-dom/client';
import { SidePanel } from './SidePanel';

const container = document.getElementById('root');
if (!container) throw new Error('root container missing');
createRoot(container).render(<SidePanel />);
