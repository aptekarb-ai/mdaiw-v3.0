import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { AuthProvider } from './context/AuthProvider';
import { YuktiProvider } from './context/YuktiProvider';
import { YuktiDrawer } from './yukti/YuktiDrawer';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { PublicOnlyRoute } from './routes/PublicOnlyRoute';
import { PublicLayout } from './layouts/PublicLayout';
import { AppLayout } from './layouts/AppLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { FaceEnrollmentPage } from './pages/FaceEnrollmentPage';
import { FaceLoginPage } from './pages/FaceLoginPage';
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
      <AuthProvider>
        <YuktiProvider>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<LandingPage />} />
              <Route element={<PublicOnlyRoute />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/face-login" element={<FaceLoginPage />} />
              </Route>
              <Route path="/face-enrollment" element={<FaceEnrollmentPage />} />
            </Route>

            <Route element={<AppLayout />}>
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/settings" element={<SettingsPage />} />
                {MODULE_ROUTES.map((path) => (
                  <Route key={path} path={path} element={<ModulePlaceholderPage />} />
                ))}
              </Route>
            </Route>

            <Route path="/dev/assets" element={<AssetPreviewPage />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <YuktiDrawer />
        </YuktiProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
