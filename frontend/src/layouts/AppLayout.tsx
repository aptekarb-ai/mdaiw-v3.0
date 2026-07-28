import { Outlet } from 'react-router-dom';
import { AppSidebar } from '../components/navigation/AppSidebar';
import { AppHeader } from '../components/navigation/AppHeader';
import { Footer } from '../components/navigation/Footer';
import './AppLayout.css';

export function AppLayout() {
  return (
    <div className="app-frame">
      <AppSidebar />
      <div className="app-frame__body">
        <AppHeader />
        <main className="app-frame__content">
          <Outlet />
        </main>
        <Footer variant="app" />
      </div>
    </div>
  );
}
