import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AmpscriptMockValuesPanel } from './AmpscriptMockValuesPanel';

describe('AmpscriptMockValuesPanel', () => {
  it('starts collapsed with a clear summary label', () => {
    render(<AmpscriptMockValuesPanel values={{}} onChange={() => {}} />);
    expect(screen.getByText('AMPscript preview values (optional)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Preview values')).not.toBeVisible();
  });

  it('parses Name = Value lines into a record on change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AmpscriptMockValuesPanel values={{}} onChange={onChange} />);

    await user.click(screen.getByText('AMPscript preview values (optional)'));
    await user.type(screen.getByLabelText('Preview values'), 'FirstName = Alex');

    expect(onChange).toHaveBeenLastCalledWith({ FirstName: 'Alex' });
  });

  it('ignores lines without an "=" separator', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AmpscriptMockValuesPanel values={{}} onChange={onChange} />);

    await user.click(screen.getByText('AMPscript preview values (optional)'));
    await user.type(screen.getByLabelText('Preview values'), 'not a pair');

    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('never claims to save or send values to Salesforce', async () => {
    const user = userEvent.setup();
    render(<AmpscriptMockValuesPanel values={{}} onChange={() => {}} />);
    await user.click(screen.getByText('AMPscript preview values (optional)'));
    expect(screen.getByText(/never saved, never sent to Salesforce Marketing Cloud/)).toBeInTheDocument();
  });
});
