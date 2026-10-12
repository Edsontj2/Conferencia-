import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FuncApp } from './FuncApp';
import '../styles.css';
import './func.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/func/sw.js', { scope: '/func/' }).catch(() => {}); });
}

createRoot(document.getElementById('root')!).render(<StrictMode><FuncApp /></StrictMode>);
