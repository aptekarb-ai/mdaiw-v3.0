import { useState } from 'react';
import './AmpscriptMockValuesPanel.css';

export interface AmpscriptMockValuesPanelProps {
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

// One `Name = Value` pair per line — matches the exact syntax shown in the
// Secure Preview spec's own example (`FirstName = Alex`), so there is
// nothing new for a user to learn beyond what the feature already
// documents. These are PREVIEW-ONLY substitutions for `%%=v(@name)=%%` —
// see backend/landingpages/preview/ampscript_preview.py. They are never
// saved as production Salesforce values and never sent to SFMC.
function parseMockValueLines(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

function formatMockValueLines(values: Record<string, string>): string {
  return Object.entries(values).map(([name, value]) => `${name} = ${value}`).join('\n');
}

export function AmpscriptMockValuesPanel({ values, onChange }: AmpscriptMockValuesPanelProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => formatMockValueLines(values));

  return (
    <details className="ampscript-mock-values" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>AMPscript preview values (optional)</summary>
      <div className="ampscript-mock-values__body">
        <p className="ampscript-mock-values__hint">
          One <code>Name = Value</code> pair per line. Used only to simulate <code>%%=v(@Name)=%%</code> in the
          preview — never saved, never sent to Salesforce Marketing Cloud.
        </p>
        <label htmlFor="ampscript-mock-values-input">Preview values</label>
        <textarea
          id="ampscript-mock-values-input"
          rows={3}
          placeholder={'FirstName = Alex\nEmailAddress = alex@example.com'}
          value={text}
          onChange={(event) => {
            const nextText = event.target.value;
            setText(nextText);
            onChange(parseMockValueLines(nextText));
          }}
        />
      </div>
    </details>
  );
}
