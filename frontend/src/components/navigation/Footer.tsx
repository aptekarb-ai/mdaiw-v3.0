import './Footer.css';

export function Footer({ variant }: { variant: 'public' | 'app' }) {
  return (
    <footer className={`site-footer site-footer--${variant}`}>
      <span>Privacy</span>
      <span>Terms</span>
      <span>Help</span>
      <span className="site-footer__copyright">
        &copy; {new Date().getFullYear()} MarketOne
      </span>
    </footer>
  );
}
