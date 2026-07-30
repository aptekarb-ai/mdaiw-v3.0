import { Link } from 'react-router';
import './LandingPage.css';

export function LandingPage() {
  return (
    <section className="landing-hero">
      <div className="landing-hero__text">
        <p className="landing-hero__eyebrow">Welcome to</p>
        <h1 className="landing-hero__heading">MDAIW</h1>
        <h2 className="landing-hero__subheading">Digital AI Workspace</h2>
        <p className="landing-hero__body">
          A unified workspace to manage employees, performance, recognition,
          landing pages, email, personal finance, AI assistants, and more
          &mdash; all in one intelligent platform.
        </p>
        <div className="landing-hero__actions">
          <Link to="/login" className="button button--primary">
            Login
          </Link>
          <Link to="/register" className="button button--outline">
            Register
          </Link>
        </div>
      </div>
      <div className="landing-hero__illustration">
        <img
          src="/assets/mdaiw/images/mdaiw-ai-hero.svg"
          alt="MDAIW connected AI workspace"
        />
      </div>
    </section>
  );
}
