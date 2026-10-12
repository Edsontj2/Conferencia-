import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { AppProvider, useApp } from './state';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { EscalaPage } from './pages/Escala';
import { RelatorioPage } from './pages/Relatorio';
import { HistoricoPage } from './pages/Historico';
import { PessoasPage } from './pages/Pessoas';
import { LinhasPage, OnibusPage } from './pages/Linhas';
import { ServicosPage } from './pages/Servicos';
import { ConfiguracoesPage } from './pages/Configuracoes';
import './styles.css';

registerSW({ immediate: true });

function App() {
  const { me, authChecked } = useApp();
  if (!authChecked) return <div className="splash">Carregando…</div>;
  if (!me) return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<EscalaPage />} />
        <Route path="relatorio" element={<RelatorioPage />} />
        <Route path="historico" element={<HistoricoPage />} />
        <Route path="pessoas" element={<PessoasPage />} />
        <Route path="linhas" element={<LinhasPage />} />
        <Route path="onibus" element={<OnibusPage />} />
        <Route path="servicos" element={<ServicosPage />} />
        <Route path="configuracoes" element={<ConfiguracoesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider><App /></AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
