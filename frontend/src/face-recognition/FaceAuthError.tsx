import './FaceRecognition.css';

interface FaceAuthErrorProps {
  message: string;
  onRetry?: () => void;
  onUsePassword?: () => void;
}

export function FaceAuthError({ message, onRetry, onUsePassword }: FaceAuthErrorProps) {
  return (
    <div className="face-auth-error" role="alert">
      <span className="mdaiw-icon mdaiw-icon--error-circle" aria-hidden="true" />
      <p className="face-auth-error__message">{message}</p>
      <div className="face-auth-error__actions">
        {onRetry && (
          <button type="button" className="button button--outline" onClick={onRetry}>
            Try Again
          </button>
        )}
        {onUsePassword && (
          <button type="button" className="button button--primary" onClick={onUsePassword}>
            Use Password Login
          </button>
        )}
      </div>
    </div>
  );
}
