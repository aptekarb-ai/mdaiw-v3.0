import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useYukti } from '../../hooks/useYukti';
import { ConfirmDialog } from '../ConfirmDialog';
import './AppSidebar.css';

interface NavLeaf {
  to: string;
  label: string;
}

interface NavGroup {
  label: string;
  children: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry;
}

const APP_NAV: NavEntry[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/employees', label: 'Employees' },
  { to: '/performance', label: 'Performance' },
  { to: '/recognition', label: 'Recognition' },
  {
    label: 'Landing Pages Builder',
    children: [
      { to: '/module-3/validator', label: 'LP Validator & AI Fixer' },
      { to: '/module-3/builder', label: 'LP Builder' },
      { to: '/module-3/generator', label: 'AI LP Generator' },
    ],
  },
  { to: '/email-builder', label: 'Email Builder' },
  { to: '/personal-finance', label: 'Personal Finance' },
  { to: '/ai-assistants', label: 'AI Assistants' },
  { to: '/reports', label: 'Reports' },
  { to: '/administration', label: 'Administration' },
  { to: '/settings', label: 'Settings' },
];

export function AppSidebar() {
  const { logout } = useAuth();
  const { open: openYukti } = useYukti();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [manuallyExpanded, setManuallyExpanded] = useState<Record<string, boolean>>({});

  async function handleConfirmLogout() {
    setConfirmingLogout(false);
    await logout();
    navigate('/login', { replace: true });
  }

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
        {APP_NAV.map((item) => {
          if (isGroup(item)) {
            const groupId = item.label.toLowerCase().replace(/\s+/g, '-');
            const childIsActive = item.children.some((child) => pathname.startsWith(child.to));
            const expanded = childIsActive || Boolean(manuallyExpanded[groupId]);
            return (
              <div key={groupId} className="app-sidebar__group">
                <button
                  type="button"
                  className={
                    childIsActive
                      ? 'app-sidebar__link app-sidebar__link--active app-sidebar__group-toggle'
                      : 'app-sidebar__link app-sidebar__group-toggle'
                  }
                  aria-expanded={expanded}
                  aria-controls={`app-sidebar-group-${groupId}`}
                  onClick={() =>
                    setManuallyExpanded((previous) => ({ ...previous, [groupId]: !expanded }))
                  }
                >
                  <span
                    className={
                      expanded
                        ? 'mdaiw-icon mdaiw-icon--chevron-down app-sidebar__group-chevron'
                        : 'mdaiw-icon mdaiw-icon--chevron-right app-sidebar__group-chevron'
                    }
                    aria-hidden="true"
                  />
                  {item.label}
                </button>
                {expanded && (
                  <div id={`app-sidebar-group-${groupId}`} className="app-sidebar__group-children">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        className={({ isActive }) =>
                          isActive
                            ? 'app-sidebar__link app-sidebar__link--active app-sidebar__link--child'
                            : 'app-sidebar__link app-sidebar__link--child'
                        }
                      >
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
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
          );
        })}
        <button
          type="button"
          className="app-sidebar__link app-sidebar__logout"
          onClick={() => setConfirmingLogout(true)}
        >
          Logout
        </button>
      </nav>

      <div className="app-sidebar__spacer" />

      <button type="button" className="app-sidebar__yukti" onClick={openYukti}>
        <img
          src="/assets/mdaiw/images/yukti-assistant.svg"
          alt=""
          aria-hidden="true"
          width={24}
          height={24}
        />
        <span>Ask Yukti</span>
      </button>

      <ConfirmDialog
        open={confirmingLogout}
        heading="Log out of MDAIW?"
        body="You will need to sign in again to access your workspace."
        confirmLabel="Log Out"
        onConfirm={handleConfirmLogout}
        onCancel={() => setConfirmingLogout(false)}
      />
    </aside>
  );
}
