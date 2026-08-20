import { Outlet, useLocation } from 'react-router';
import { AppSidebar } from '../components/navigation/AppSidebar';
import { AppHeader } from '../components/navigation/AppHeader';
import { Footer } from '../components/navigation/Footer';
import './AppLayout.css';

export function AppLayout() {
  const { pathname } = useLocation();
  // The email builder workspace is a full-height editor, not a normal
  // scrolling content page — it manages its own internal scroll regions
  // and doesn't need the app footer competing for vertical space. Scoped
  // to this one route rather than a general AppLayout redesign.
  const isFullWorkspace = pathname.startsWith('/email-builder/builder/');

  return (
    <div className="app-frame">
      <AppSidebar />
      <div className="app-frame__body">
        <AppHeader />
        <main className={isFullWorkspace ? 'app-frame__content app-frame__content--full' : 'app-frame__content'}>
          <Outlet />
        </main>
        {!isFullWorkspace && <Footer variant="app" />}
      </div>
    </div>
  );
}
