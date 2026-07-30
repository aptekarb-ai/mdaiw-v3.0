import { useLocation, Link } from 'react-router';
import './PlaceholderPage.css';

const TITLES: Record<string, string> = {
  '/employees': 'Employees',
  '/performance': 'Performance',
  '/recognition': 'Recognition',
  '/landing-pages': 'Landing Pages Builder',
  '/email-builder': 'Email Builder',
  '/personal-finance': 'Personal Finance',
  '/ai-assistants': 'AI Assistants',
  '/reports': 'Reports',
  '/administration': 'Administration',
};

export function ModulePlaceholderPage() {
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'Module';

  return (
    <section className="placeholder-page">
      <h1 className="placeholder-page__heading">{title}</h1>
      <p className="placeholder-page__body">
        Module functionality will be implemented in a future phase.
      </p>
      <div style={{ marginTop: 'var(--space-6)' }}>
        <Link to="/dashboard" className="button button--primary">
          Back to Dashboard
        </Link>
      </div>
    </section>
  );
}
