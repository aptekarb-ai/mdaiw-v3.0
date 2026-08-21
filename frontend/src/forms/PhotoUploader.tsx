import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import './PhotoUploader.css';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

interface PhotoUploaderProps {
  value: File | null;
  onChange: (file: File | null) => void;
  error?: string;
}

export function PhotoUploader({ value, onChange, error }: PhotoUploaderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [value]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      setLocalError(undefined);
      onChange(null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setLocalError('Profile photo must be a JPEG, PNG, or WebP image.');
      onChange(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      return;
    }

    if (file.size > MAX_BYTES) {
      setLocalError('Profile photo must be 5 MB or smaller.');
      onChange(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      return;
    }

    setLocalError(undefined);
    onChange(file);
  }

  function handleRemove() {
    setLocalError(undefined);
    onChange(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }

  const displayedError = localError ?? error;

  return (
    <div className="photo-uploader">
      <span className="photo-uploader__label" id="profile-photo-label">
        Profile Photo
      </span>
      <div className="photo-uploader__preview">
        {previewUrl ? (
          <img src={previewUrl} alt="Profile photo preview" className="photo-uploader__image" />
        ) : (
          <span className="mdaiw-icon mdaiw-icon--profile" aria-hidden="true" />
        )}
      </div>
      <div className="photo-uploader__actions">
        <input
          ref={inputRef}
          id="profile-photo-input"
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          aria-labelledby="profile-photo-label"
          aria-invalid={Boolean(displayedError)}
          aria-describedby={displayedError ? 'profile-photo-error' : 'profile-photo-hint'}
          onChange={handleFileChange}
        />
        {value && (
          <button type="button" className="button button--outline" onClick={handleRemove}>
            Remove
          </button>
        )}
      </div>
      <p id="profile-photo-hint" className="photo-uploader__hint">
        JPEG, PNG, or WebP. Maximum size 5 MB. Optional.
      </p>
      {displayedError && (
        <p id="profile-photo-error" className="form-field__error" role="alert">
          {displayedError}
        </p>
      )}
    </div>
  );
}
