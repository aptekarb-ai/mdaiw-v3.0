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
import { LandingPageValidatorPage } from './pages/LandingPageValidatorPage';
import { EmailBuilderDashboardPage } from './pages/EmailBuilderDashboardPage';
import { CreateEmailPage } from './pages/CreateEmailPage';
import { EmailBuilderPendingPage } from './pages/EmailBuilderPendingPage';
import { AssetPreviewPage } from './pages/dev/AssetPreviewPage';

const MODULE_ROUTES = [
  '/employees',
  '/performance',
  '/recognition',
  '/landing-pages',
  '/personal-finance',
  '/ai-assistants',
  '/reports',
  '/administration',
];

// Module 3's own "Coming Soon" placeholders — not part of the generic
// Module 1 MODULE_ROUTES list above since their copy is Module-3-specific
// (see ModulePlaceholderPage's BODIES map), not the generic
// "implemented in a future phase" text.
const MODULE_3_PLACEHOLDER_ROUTES = ['/module-3/builder', '/module-3/generator'];

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
                <Route path="/module-3/validator" element={<LandingPageValidatorPage />} />
                <Route path="/email-builder" element={<EmailBuilderDashboardPage />} />
                <Route path="/email-builder/create" element={<CreateEmailPage />} />
                <Route path="/email-builder/builder/:id" element={<EmailBuilderPendingPage />} />
                {MODULE_3_PLACEHOLDER_ROUTES.map((path) => (
                  <Route key={path} path={path} element={<ModulePlaceholderPage />} />
                ))}
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
