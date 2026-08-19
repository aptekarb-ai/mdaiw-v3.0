import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useYukti } from '../../hooks/useYukti';
import { ConfirmDialog } from '../ConfirmDialog';
import './AppSidebar.css';

const COLLAPSE_STORAGE_KEY = 'mdaiw.sidebar.collapsed';

interface NavLeaf {
  to: string;
  label: string;
  icon: string;
  disabled?: boolean;
}

interface NavGroup {
  label: string;
  icon: string;
  children: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry;
}

function groupIdFor(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}

function routeGroupId(pathname: string): string | null {
  for (const entry of APP_NAV) {
    if (isGroup(entry) && entry.children.some((child) => pathname.startsWith(child.to))) {
      return groupIdFor(entry.label);
    }
  }
  return null;
}

function iconClass(icon: string): string {
  return `mdaiw-icon mdaiw-icon--${icon} app-sidebar__link-icon`;
}

const APP_NAV: NavEntry[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/employees', label: 'Employees', icon: 'employees' },
  { to: '/performance', label: 'Performance', icon: 'performance' },
  { to: '/recognition', label: 'Recognition', icon: 'recognition' },
  {
    label: 'Landing Pages Builder',
    icon: 'landing-page',
    children: [
      { to: '/module-3/validator', label: 'LP Validator & AI Fixer', icon: 'shield-check' },
      { to: '/module-3/builder', label: 'LP Builder', icon: 'landing-page' },
      { to: '/module-3/generator', label: 'AI LP Generator', icon: 'ai-assistants' },
    ],
  },
  {
    label: 'AI Email Builder',
    icon: 'email',
    children: [
      { to: '/email-builder', label: 'Email Dashboard', icon: 'dashboard' },
      { to: '/email-builder/create', label: 'Create Email', icon: 'file' },
      { to: '/email-builder/emails', label: 'My Emails', icon: 'email', disabled: true },
      { to: '/email-builder/templates', label: 'Templates', icon: 'landing-page', disabled: true },
      { to: '/email-builder/modules', label: 'Module Library', icon: 'department', disabled: true },
      { to: '/email-builder/assets', label: 'Assets / Brand Kit', icon: 'camera', disabled: true },
      { to: '/email-builder/validation', label: 'Preview & Validation', icon: 'eye', disabled: true },
      { to: '/email-builder/ai-engineer', label: 'AI Engineer', icon: 'ai-assistants', disabled: true },
    ],
  },
  { to: '/personal-finance', label: 'Personal Finance', icon: 'finance' },
  { to: '/ai-assistants', label: 'AI Assistants', icon: 'ai-assistants' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
  { to: '/administration', label: 'Administration', icon: 'administration' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

interface FlyoutPosition {
  top: number;
  left: number;
}

interface CollapsedFlyoutProps {
  group: NavGroup;
  groupId: string;
  pathname: string;
  position: FlyoutPosition;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

function CollapsedFlyout({ group, groupId, pathname, position, onClose, triggerRef }: CollapsedFlyoutProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, triggerRef]);

  return createPortal(
    <div
      ref={panelRef}
      className="app-sidebar__flyout"
      role="group"
      aria-label={group.label}
      style={{ top: position.top, left: position.left }}
    >
      <div className="app-sidebar__flyout-heading">{group.label}</div>
      <div className="app-sidebar__flyout-children">
        {group.children.map((child) =>
          child.disabled ? (
            <span
              key={child.to}
              className="app-sidebar__link app-sidebar__link--child app-sidebar__link--disabled"
              aria-disabled="true"
              title="Coming soon"
            >
              <span className={iconClass(child.icon)} aria-hidden="true" />
              {child.label}
            </span>
          ) : (
            <NavLink
              key={child.to}
              to={child.to}
              end
              onClick={onClose}
              className={({ isActive }) =>
                isActive
                  ? 'app-sidebar__link app-sidebar__link--active app-sidebar__link--child'
                  : 'app-sidebar__link app-sidebar__link--child'
              }
              aria-current={pathname === child.to ? 'page' : undefined}
            >
              <span className={iconClass(child.icon)} aria-hidden="true" />
              {child.label}
            </NavLink>
          ),
        )}
      </div>
    </div>,
    document.body,
    `app-sidebar-flyout-${groupId}`,
  );
}

export function AppSidebar() {
  const { logout } = useAuth();
  const { open: openYukti } = useYukti();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  // Only one major module NavGroup (Landing Pages Builder, AI Email Builder)
  // is ever open at once — a single id, not a per-group record, is what
  // makes that an accordion rather than independent toggles.
  const [expandedGroup, setExpandedGroup] = useState<string | null>(() => routeGroupId(pathname));
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [flyoutGroup, setFlyoutGroup] = useState<string | null>(null);
  const [flyoutPosition, setFlyoutPosition] = useState<FlyoutPosition>({ top: 0, left: 0 });
  const groupTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // The icon-only rail/flyout is a desktop-only affordance (req 14): a
  // collapsed preference persisted from an earlier desktop session must
  // not suppress the mobile/tablet drawer's inline children.
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    try {
      return window.innerWidth >= 1024;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    function handleResize() {
      const desktop = window.innerWidth >= 1024;
      setIsDesktop(desktop);
      if (!desktop) setFlyoutGroup(null);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const effectiveCollapsed = collapsed && isDesktop;

  useEffect(() => {
    const matched = routeGroupId(pathname);
    if (matched) setExpandedGroup(matched);
    setFlyoutGroup(null);
  }, [pathname]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
    } catch {
      // Preference persistence is a nicety; ignore storage failures
      // (e.g. private browsing) rather than breaking navigation.
    }
    setFlyoutGroup(null);
  }, [collapsed]);

  useLayoutEffect(() => {
    if (!flyoutGroup) return;
    const trigger = groupTriggerRefs.current[flyoutGroup];
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setFlyoutPosition({ top: rect.top, left: rect.right + 8 });
  }, [flyoutGroup]);

  async function handleConfirmLogout() {
    setConfirmingLogout(false);
    await logout();
    navigate('/login', { replace: true });
  }

  function handleGroupToggle(groupId: string) {
    if (effectiveCollapsed) {
      setFlyoutGroup((current) => (current === groupId ? null : groupId));
    } else {
      setExpandedGroup((current) => (current === groupId ? null : groupId));
    }
  }

  const openFlyoutEntry = flyoutGroup
    ? (APP_NAV.find((entry) => isGroup(entry) && groupIdFor(entry.label) === flyoutGroup) as NavGroup | undefined)
    : undefined;

  return (
    <aside className="app-sidebar" data-collapsed={effectiveCollapsed}>
      <div className="app-sidebar__brand-row">
        <a
          href="https://www.marketone.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="app-sidebar__logo"
        >
          <img
            src={
              effectiveCollapsed
                ? '/assets/mdaiw/images/mdaiw-favicon.svg'
                : '/assets/mdaiw/images/mdaiw-wordmark.svg'
            }
            alt="MarketOne logo"
            height={28}
          />
        </a>
        <button
          type="button"
          className="app-sidebar__collapse-toggle"
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          onClick={() => setCollapsed((current) => !current)}
        >
          <span className="mdaiw-icon mdaiw-icon--menu" aria-hidden="true" />
        </button>
      </div>

      <nav className="app-sidebar__nav" aria-label="Application navigation">
        {APP_NAV.map((item) => {
          if (isGroup(item)) {
            const groupId = groupIdFor(item.label);
            const childIsActive = item.children.some((child) => pathname.startsWith(child.to));
            const expanded = effectiveCollapsed ? flyoutGroup === groupId : expandedGroup === groupId;
            return (
              <div key={groupId} className="app-sidebar__group">
                <button
                  type="button"
                  ref={(el) => {
                    groupTriggerRefs.current[groupId] = el;
                  }}
                  className={
                    childIsActive
                      ? 'app-sidebar__link app-sidebar__link--active app-sidebar__group-toggle'
                      : 'app-sidebar__link app-sidebar__group-toggle'
                  }
                  aria-expanded={expanded}
                  aria-haspopup={effectiveCollapsed ? 'true' : undefined}
                  aria-controls={`app-sidebar-group-${groupId}`}
                  title={effectiveCollapsed ? item.label : undefined}
                  onClick={() => handleGroupToggle(groupId)}
                >
                  <span className={iconClass(item.icon)} aria-hidden="true" />
                  <span className="app-sidebar__label">{item.label}</span>
                  <span
                    className={
                      expanded
                        ? 'mdaiw-icon mdaiw-icon--chevron-down app-sidebar__group-chevron'
                        : 'mdaiw-icon mdaiw-icon--chevron-right app-sidebar__group-chevron'
                    }
                    aria-hidden="true"
                  />
                </button>
                {!effectiveCollapsed && expanded && (
                  <div id={`app-sidebar-group-${groupId}`} className="app-sidebar__group-children">
                    {item.children.map((child) =>
                      child.disabled ? (
                        <span
                          key={child.to}
                          className="app-sidebar__link app-sidebar__link--child app-sidebar__link--disabled"
                          aria-disabled="true"
                          title="Coming soon"
                        >
                          <span className={iconClass(child.icon)} aria-hidden="true" />
                          {child.label}
                        </span>
                      ) : (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          end
                          aria-current={pathname === child.to ? 'page' : undefined}
                          className={({ isActive }) =>
                            isActive
                              ? 'app-sidebar__link app-sidebar__link--active app-sidebar__link--child'
                              : 'app-sidebar__link app-sidebar__link--child'
                          }
                        >
                          <span className={iconClass(child.icon)} aria-hidden="true" />
                          {child.label}
                        </NavLink>
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={effectiveCollapsed ? item.label : undefined}
              aria-current={pathname === item.to ? 'page' : undefined}
              className={({ isActive }) =>
                isActive
                  ? 'app-sidebar__link app-sidebar__link--active'
                  : 'app-sidebar__link'
              }
            >
              <span className={iconClass(item.icon)} aria-hidden="true" />
              <span className="app-sidebar__label">{item.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className="app-sidebar__link app-sidebar__logout"
          title={effectiveCollapsed ? 'Logout' : undefined}
          onClick={() => setConfirmingLogout(true)}
        >
          <span className="mdaiw-icon mdaiw-icon--logout app-sidebar__link-icon" aria-hidden="true" />
          <span className="app-sidebar__label">Logout</span>
        </button>
      </nav>

      <div className="app-sidebar__spacer" />

      <button
        type="button"
        className="app-sidebar__yukti"
        title={effectiveCollapsed ? 'Ask Yukti' : undefined}
        onClick={openYukti}
      >
        <img
          src="/assets/mdaiw/images/yukti-assistant.svg"
          alt=""
          aria-hidden="true"
          width={24}
          height={24}
        />
        <span className="app-sidebar__label app-sidebar__yukti-label">
          Ask Yukti
          <span className="app-sidebar__yukti-sublabel">AI Assistant</span>
        </span>
      </button>

      {effectiveCollapsed && flyoutGroup && openFlyoutEntry && (
        <CollapsedFlyout
          group={openFlyoutEntry}
          groupId={flyoutGroup}
          pathname={pathname}
          position={flyoutPosition}
          onClose={() => setFlyoutGroup(null)}
          triggerRef={{ current: groupTriggerRefs.current[flyoutGroup] ?? null }}
        />
      )}

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
