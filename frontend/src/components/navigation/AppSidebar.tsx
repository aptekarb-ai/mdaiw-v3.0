import { NavLink } from 'react-router-dom';
import './AppSidebar.css';

const APP_NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/employees', label: 'Employees' },
  { to: '/performance', label: 'Performance' },
  { to: '/recognition', label: 'Recognition' },
  { to: '/landing-pages', label: 'Landing Pages Builder' },
  { to: '/email-builder', label: 'Email Builder' },
  { to: '/personal-finance', label: 'Personal Finance' },
  { to: '/ai-assistants', label: 'AI Assistants' },
  { to: '/reports', label: 'Reports' },
  { to: '/administration', label: 'Administration' },
  { to: '/settings', label: 'Settings' },
];

export function AppSidebar() {
  return (
    <aside className="app-sidebar">
      <a
        href="https://www.marketone.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="app-sidebar__logo"
      >
        <img
          src="/assets/mdaiw/images/mdaiw-wordmark.svg"
          alt="MarketOne logo"
          height={28}
        />
      </a>

      <nav className="app-sidebar__nav" aria-label="Application navigation">
        {APP_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive
                ? 'app-sidebar__link app-sidebar__link--active'
                : 'app-sidebar__link'
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="app-sidebar__spacer" />

      <div className="app-sidebar__yukti">
        <img
          src="/assets/mdaiw/images/yukti-assistant.svg"
          alt=""
          aria-hidden="true"
          width={24}
          height={24}
        />
        <span>Ask Yukti</span>
      </div>
    </aside>
  );
}
