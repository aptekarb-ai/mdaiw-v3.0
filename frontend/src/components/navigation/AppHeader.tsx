import type { RefObject } from 'react';
import { useYukti } from '../../hooks/useYukti';
import './AppHeader.css';

interface AppHeaderProps {
  mobileNavOpen: boolean;
  onOpenMobileNav: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}

export function AppHeader({ mobileNavOpen, onOpenMobileNav, menuButtonRef }: AppHeaderProps) {
  const { open } = useYukti();

  return (
    <header className="app-header">
      <button
        type="button"
        ref={menuButtonRef}
        className="app-header__menu-toggle"
        aria-label="Open navigation menu"
        aria-expanded={mobileNavOpen}
        aria-controls="app-sidebar-nav"
        onClick={onOpenMobileNav}
      >
        <span className="mdaiw-icon mdaiw-icon--menu" aria-hidden="true" />
      </button>

      <div className="app-header__search">
        <span className="mdaiw-icon mdaiw-icon--search" aria-hidden="true" />
        <input
          type="search"
          placeholder="Search or ask Yukti..."
          aria-label="Search or ask Yukti"
          onClick={open}
          readOnly
        />
        <button type="button" aria-label="Talk to Yukti" onClick={open}>
          <span
            className="mdaiw-icon mdaiw-icon--microphone"
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="app-header__actions">
        <button type="button" aria-label="Notifications" disabled>
          <span className="mdaiw-icon mdaiw-icon--bell" aria-hidden="true" />
        </button>
        <div className="app-header__profile">
          <img
            src="/assets/mdaiw/images/profile-placeholder.svg"
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
          />
        </div>
      </div>
    </header>
  );
}
