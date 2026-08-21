import { useLocation, Link } from 'react-router';
import './PlaceholderPage.css';

const TITLES: Record<string, string> = {
  '/employees': 'Employees',
  '/performance': 'Performance',
  '/recognition': 'Recognition',
  '/landing-pages': 'Landing Pages Builder',
  '/personal-finance': 'Personal Finance',
  '/ai-assistants': 'AI Assistants',
  '/reports': 'Reports',
  '/administration': 'Administration',
  '/module-3/builder': 'LP Builder',
  '/module-3/generator': 'AI LP Generator',
};

const DEFAULT_BODY = 'Module functionality will be implemented in a future phase.';

// Module 3's own placeholders state their own priority explicitly, per
// their own build order, rather than the generic Module 1 copy above.
const BODIES: Record<string, string> = {
  '/module-3/builder': 'LP Builder will be implemented in Priority 2.',
  '/module-3/generator': 'AI LP Generator will be implemented in Priority 3.',
};

export function ModulePlaceholderPage() {
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'Module';
  const body = BODIES[pathname] ?? DEFAULT_BODY;

  return (
    <section className="placeholder-page">
      <h1 className="placeholder-page__heading">{title}</h1>
      <p className="placeholder-page__body">{body}</p>
      <div style={{ marginTop: 'var(--space-6)' }}>
        <Link to="/dashboard" className="button button--primary">
          Back to Dashboard
        </Link>
      </div>
    </section>
  );
}
