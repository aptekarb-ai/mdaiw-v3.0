import { useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CSS_SOURCE_TYPES, type CssSourceType } from '../types/landingpages';
import './StylesheetSourceControl.css';

export interface StylesheetSourceControlProps {
  value: CssSourceType;
  // Fires only once the change is confirmed (or immediately when
  // `sourceIsEmpty` is true, since there is nothing to reinterpret) — the
  // caller never needs to know a confirmation step happened.
  onChange: (next: CssSourceType) => void;
  // Whether the stylesheet editor currently has any content — an empty
  // source has nothing to reinterpret, so switching type skips the
  // confirmation dialog entirely.
  sourceIsEmpty: boolean;
  disabled?: boolean;
}

export function StylesheetSourceControl({ value, onChange, sourceIsEmpty, disabled }: StylesheetSourceControlProps) {
  const [pendingValue, setPendingValue] = useState<CssSourceType | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const pendingLabel = pendingValue ? CSS_SOURCE_TYPES.find((entry) => entry.key === pendingValue)?.label : '';

  function handleSelect(next: CssSourceType) {
    if (next === value) return;
    if (sourceIsEmpty) {
      onChange(next);
      return;
    }
    setPendingValue(next);
  }

  function handleConfirm() {
    if (pendingValue) onChange(pendingValue);
    setPendingValue(null);
  }

  function handleCancel() {
    setPendingValue(null);
    selectRef.current?.focus();
  }

  return (
    <div className="stylesheet-source-control">
      <label htmlFor="stylesheet-source-type" className="stylesheet-source-control__label">
        Stylesheet type
      </label>
      <select
        id="stylesheet-source-type"
        ref={selectRef}
        className="stylesheet-source-control__select"
        value={value}
        disabled={disabled}
        onChange={(event) => handleSelect(event.target.value as CssSourceType)}
      >
        {CSS_SOURCE_TYPES.map((entry) => (
          <option key={entry.key} value={entry.key}>
            {entry.label}
          </option>
        ))}
      </select>

      <ConfirmDialog
        open={pendingValue !== null}
        heading="Change stylesheet type?"
        body={`The existing stylesheet source will be interpreted as ${pendingLabel}. Previous stylesheet results and generated CSS will be cleared.`}
        confirmLabel="Change Type"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}
