import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PublicLayout } from './layouts/PublicLayout';
import { AppLayout } from './layouts/AppLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AboutPage } from './pages/AboutPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { ModulePlaceholderPage } from './pages/ModulePlaceholderPage';
import { AssetPreviewPage } from './pages/dev/AssetPreviewPage';

const MODULE_ROUTES = [
  '/employees',
  '/performance',
  '/recognition',
  '/landing-pages',
  '/email-builder',
  '/personal-finance',
  '/ai-assistants',
  '/reports',
  '/administration',
];

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Route>

        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {MODULE_ROUTES.map((path) => (
            <Route key={path} path={path} element={<ModulePlaceholderPage />} />
          ))}
        </Route>

        <Route path="/dev/assets" element={<AssetPreviewPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
