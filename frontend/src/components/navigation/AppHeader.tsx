import './AppHeader.css';

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header__search">
        <span className="mdaiw-icon mdaiw-icon--search" aria-hidden="true" />
        <input
          type="search"
          placeholder="Search or ask Yukti..."
          aria-label="Search or ask Yukti"
        />
        <button type="button" aria-label="Talk to Yukti" disabled>
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
