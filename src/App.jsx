import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

const AdminPage = lazy(() => import('./pages/AdminPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-6 text-[var(--text-primary)]">
      <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--panel)] px-6 py-5 text-center shadow-[var(--card-shadow)]">
        <p className="text-sm uppercase tracking-[0.28em] text-[var(--accent-strong)]">Cargando</p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">Preparando la vista solicitada...</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<RegisterPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
