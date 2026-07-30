import { Outlet } from 'react-router';
import { PublicSidebar } from '../components/navigation/PublicSidebar';
import { Footer } from '../components/navigation/Footer';
import './PublicLayout.css';

export function PublicLayout() {
  return (
    <div className="public-frame">
      <PublicSidebar />
      <div className="public-frame__body">
        <main className="public-frame__content">
          <Outlet />
        </main>
        <Footer variant="public" />
      </div>
    </div>
  );
}
