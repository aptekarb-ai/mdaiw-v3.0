import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import './LoginPage.css';

const REMEMBERED_USERNAME_KEY = 'mdaiw.rememberedUsername';

interface FieldErrors {
  username?: string;
  password?: string;
}

export function LoginPage() {
  const { login, error: serverError, clearError } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberUsername, setRememberUsername] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(REMEMBERED_USERNAME_KEY);
    if (stored) {
      setUsername(stored);
      setRememberUsername(true);
    }
  }, []);

  function handleUsernameChange(value: string) {
    setUsername(value);
    if (fieldErrors.username) {
      setFieldErrors((prev) => ({ ...prev, username: undefined }));
    }
    if (serverError) {
      clearError();
    }
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    if (fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: undefined }));
    }
    if (serverError) {
      clearError();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const nextErrors: FieldErrors = {};
    if (!username.trim()) {
      nextErrors.username = 'Username is required.';
    }
    if (!password) {
      nextErrors.password = 'Password is required.';
    }

    if (nextErrors.username || nextErrors.password) {
      setFieldErrors(nextErrors);
      if (nextErrors.username) {
        usernameRef.current?.focus();
      } else {
        passwordRef.current?.focus();
      }
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await login({ username: username.trim(), password });

      if (rememberUsername) {
        window.localStorage.setItem(REMEMBERED_USERNAME_KEY, username.trim());
      } else {
        window.localStorage.removeItem(REMEMBERED_USERNAME_KEY);
      }

      navigate('/dashboard', { replace: true });
    } catch {
      passwordRef.current?.focus();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <p className="login-page__eyebrow">Welcome back</p>
      <h1 className="login-page__heading">Sign in to Digital AI Workspace</h1>
      <p className="login-page__supporting">Use your username and password to log in.</p>

      <form className="login-page__form" onSubmit={handleSubmit} noValidate>
        {serverError && (
          <div className="login-page__alert" role="alert">
            {serverError}
          </div>
        )}

        <div className="form-field">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            ref={usernameRef}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => handleUsernameChange(event.target.value)}
            aria-invalid={Boolean(fieldErrors.username)}
            aria-describedby={fieldErrors.username ? 'login-username-error' : undefined}
          />
          {fieldErrors.username && (
            <p id="login-username-error" className="form-field__error">
              {fieldErrors.username}
            </p>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="login-password">Password</label>
          <div className="form-field__password-wrapper">
            <input
              id="login-password"
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => handlePasswordChange(event.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
            />
            <button
              type="button"
              className="form-field__toggle-visibility"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <span
                className={`mdaiw-icon mdaiw-icon--${showPassword ? 'eye-off' : 'eye'}`}
                aria-hidden="true"
              />
            </button>
          </div>
          {fieldErrors.password && (
            <p id="login-password-error" className="form-field__error">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <label className="login-page__remember">
          <input
            type="checkbox"
            checked={rememberUsername}
            onChange={(event) => setRememberUsername(event.target.checked)}
          />
          Remember my username
        </label>

        <button type="submit" className="button button--primary login-page__submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign In →'}
        </button>

        <div className="login-page__divider">
          <span>OR</span>
        </div>

        <button
          type="button"
          className="button button--outline login-page__face-button"
          disabled
          aria-describedby="login-face-note"
        >
          <span className="mdaiw-icon mdaiw-icon--face-scan" aria-hidden="true" />
          Sign in with Face Recognition
        </button>
        <p id="login-face-note" className="login-page__face-note">
          Face Recognition login will be available in Checkpoint 5.
        </p>

        <button type="button" className="login-page__yukti-button" disabled>
          <span className="mdaiw-icon mdaiw-icon--microphone" aria-hidden="true" />
          Ask Yukti to help me sign in
        </button>

        <p className="login-page__register-link">
          New employee? <Link to="/register">Register</Link>
        </p>
      </form>
    </div>
  );
}
