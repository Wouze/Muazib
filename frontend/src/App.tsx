import { useEffect } from 'react';
import { useLocation } from './lib/router';
import Admin from './pages/Admin';
import Landing from './pages/Landing';
import Workspace from './pages/Workspace';

export default function App() {
  const { pathname } = useLocation();
  const isApp = pathname === '/app' || pathname.startsWith('/app/');
  const isAdmin = pathname === '/admin';

  useEffect(() => {
    document.title = isAdmin
      ? "Mu'azib · Agent metrics"
      : isApp
        ? "Mu'azib · Host workspace"
        : "Mu'azib (مُعَزِّب) | Dar Najd Kitchen AI Host";
  }, [isAdmin, isApp]);

  if (isAdmin) return <Admin />;
  return isApp ? <Workspace /> : <Landing />;
}
