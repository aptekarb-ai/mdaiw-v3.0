import './DashboardPage.css';
import { useAuth } from '../hooks/useAuth';

export function DashboardPage() {
  const { user } = useAuth();
  const displayName = user?.first_name || user?.username || '';

  return (
    <section className="dashboard-page">
      <h1>Welcome back, {displayName}!</h1>
      <p className="dashboard-page__status">
        <span className="mdaiw-icon mdaiw-icon--shield-check" aria-hidden="true" />
        Session authenticated
      </p>

      <div className="dashboard-page__identity">
        <div>
          <span className="dashboard-page__label">Username</span>
          <span>{user?.username}</span>
        </div>
        <div>
          <span className="dashboard-page__label">Email</span>
          <span>{user?.email || '—'}</span>
        </div>
      </div>

      <div className="dashboard-page__cards">
        <article className="dashboard-page__card">
          <h2>My Profile</h2>
          <p>View and update your account details.</p>
        </article>
        <article className="dashboard-page__card">
          <h2>Employees</h2>
          <p>Module functionality will be implemented in a future phase.</p>
        </article>
        <article className="dashboard-page__card">
          <h2>Ask Yukti</h2>
          <p>Yukti text and voice assistance arrives in Checkpoint 6.</p>
        </article>
        <article className="dashboard-page__card">
          <h2>Reports</h2>
          <p>Module functionality will be implemented in a future phase.</p>
        </article>
      </div>
    </section>
  );
}
