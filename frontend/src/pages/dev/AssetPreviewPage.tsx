import { useState } from 'react';
import './AssetPreviewPage.css';

const ICONS = [
  'about', 'administration', 'ai-assistants', 'arrow-left', 'arrow-right',
  'audio-wave', 'bell', 'briefcase', 'calendar', 'camera', 'check',
  'check-circle', 'chevron-down', 'chevron-right', 'close', 'dashboard',
  'delete', 'department', 'edit', 'email', 'employees', 'error-circle',
  'eye', 'eye-off', 'face-scan', 'file', 'finance', 'help', 'home',
  'id-card', 'landing-page', 'location', 'lock', 'login', 'logout',
  'manager', 'menu', 'microphone', 'microphone-off', 'pause', 'performance',
  'phone', 'play', 'profile', 'recognition', 'refresh', 'registration',
  'reports', 'search', 'send', 'settings', 'shield-check', 'spinner',
  'stop', 'unlock', 'upload', 'user-check', 'volume', 'volume-off', 'warning',
];

const IMAGES = [
  'face-scan-frame', 'mdaiw-ai-hero', 'mdaiw-favicon', 'mdaiw-wordmark',
  'profile-placeholder', 'success-celebration', 'voice-wave', 'yukti-assistant',
];

export function AssetPreviewPage() {
  const [failedImages, setFailedImages] = useState<string[]>([]);

  return (
    <div className="asset-preview" data-testid="asset-preview-page">
      <h1>MDAIW Asset Preview</h1>
      <p>Dev-only page confirming every icon and illustration resolves under /assets/mdaiw/.</p>

      <section>
        <h2>Icons ({ICONS.length})</h2>
        <ul className="asset-preview__icon-grid" data-testid="icon-grid">
          {ICONS.map((name) => (
            <li key={name} className="asset-preview__icon-item">
              <span
                className={`mdaiw-icon mdaiw-icon--${name}`}
                aria-hidden="true"
              />
              <span className="asset-preview__icon-label">{name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Illustrations ({IMAGES.length})</h2>
        <ul className="asset-preview__image-grid" data-testid="image-grid">
          {IMAGES.map((name) => (
            <li key={name} className="asset-preview__image-item">
              <img
                src={`/assets/mdaiw/images/${name}.svg`}
                alt={name}
                onError={() => setFailedImages((prev) => [...prev, name])}
              />
              <span>{name}</span>
            </li>
          ))}
        </ul>
        {failedImages.length > 0 && (
          <p className="asset-preview__error" data-testid="image-load-errors">
            Failed images: {failedImages.join(', ')}
          </p>
        )}
      </section>
    </div>
  );
}
