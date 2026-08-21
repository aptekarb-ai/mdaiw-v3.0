import { NavLink } from 'react-router';
import { useYukti } from '../../hooks/useYukti';
import './PublicSidebar.css';

const PUBLIC_NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/login', label: 'Login' },
  { to: '/register', label: 'Registration' },
];

export function PublicSidebar() {
  const { open: openYukti } = useYukti();

  return (
    <aside className="public-sidebar">
      <NavLink to="/" className="public-sidebar__brand" aria-label="Digital AI Workspace home">
        <img
          src="/assets/mdaiw/images/mdaiw-wordmark.svg"
          alt=""
          aria-hidden="true"
          className="public-sidebar__logo"
        />
        <span className="public-sidebar__subtitle">Digital AI Workspace</span>
      </NavLink>

      <nav className="public-sidebar__nav" aria-label="Public navigation">
        {PUBLIC_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
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
        <button type="button" className="public-sidebar__yukti-label-button" onClick={openYukti}>
          <p className="public-sidebar__yukti-label">Ask Yukti</p>
          <p className="public-sidebar__yukti-sub">Your AI Assistant</p>
        </button>
        <button
          type="button"
          className="public-sidebar__yukti-mic"
          aria-label="Talk to Yukti"
          onClick={openYukti}
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
