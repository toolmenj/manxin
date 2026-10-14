import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/base.css';
import './styles/prototype.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(<App />);
