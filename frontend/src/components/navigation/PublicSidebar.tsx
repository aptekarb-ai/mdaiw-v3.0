import { NavLink } from 'react-router-dom';
import './PublicSidebar.css';

const PUBLIC_NAV = [
  { to: '/login', label: 'Login' },
  { to: '/register', label: 'Registration' },
  { to: '/about', label: 'About MDAIW' },
];

export function PublicSidebar() {
  return (
    <aside className="public-sidebar">
      <div className="public-sidebar__brand">
        <a
          href="https://www.marketone.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="public-sidebar__logo"
        >
          <img
            src="/assets/mdaiw/images/mdaiw-wordmark.svg"
            alt="MarketOne logo"
            height={32}
          />
        </a>
        <p className="public-sidebar__title">MDAIW</p>
        <p className="public-sidebar__subtitle">Digital AI Workspace</p>
      </div>

      <nav className="public-sidebar__nav" aria-label="Public navigation">
        {PUBLIC_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive
                ? 'public-sidebar__link public-sidebar__link--active'
                : 'public-sidebar__link'
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="public-sidebar__spacer" />

      <div className="public-sidebar__yukti">
        <img
          src="/assets/mdaiw/images/yukti-assistant.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
        />
        <div>
          <p className="public-sidebar__yukti-label">Ask Yukti</p>
          <p className="public-sidebar__yukti-sub">Your AI Assistant</p>
        </div>
        <button
          type="button"
          className="public-sidebar__yukti-mic"
          aria-label="Talk to Yukti"
          disabled
        >
          <span
            className="mdaiw-icon mdaiw-icon--microphone"
            aria-hidden="true"
          />
        </button>
      </div>

      <p className="public-sidebar__copyright">
        &copy; {new Date().getFullYear()} MarketOne
      </p>
    </aside>
  );
}
