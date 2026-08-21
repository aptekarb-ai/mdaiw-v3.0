import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StylesheetSourceControl } from './StylesheetSourceControl';

describe('StylesheetSourceControl', () => {
  it('has a visible label and lists all four source types', () => {
    render(<StylesheetSourceControl value="css" onChange={vi.fn()} sourceIsEmpty />);
    const select = screen.getByLabelText('Stylesheet type');
    expect(select).toHaveValue('css');
    expect(screen.getByRole('option', { name: 'SCSS' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sass' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'LESS' })).toBeInTheDocument();
  });

  it('calls onChange immediately when the source is empty', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StylesheetSourceControl value="css" onChange={onChange} sourceIsEmpty />);
    await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
    expect(onChange).toHaveBeenCalledWith('scss');
    expect(screen.queryByText('Change stylesheet type?')).not.toBeInTheDocument();
  });

  it('asks for confirmation when the source is non-empty, and only calls onChange after confirming', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StylesheetSourceControl value="css" onChange={onChange} sourceIsEmpty={false} />);

    await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'less');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Change stylesheet type?')).toBeInTheDocument();
    expect(screen.getByText(/interpreted as LESS/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change Type' }));
    expect(onChange).toHaveBeenCalledWith('less');
  });

  it('Cancel discards the pending change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StylesheetSourceControl value="css" onChange={onChange} sourceIsEmpty={false} />);

    await user.selectOptions(screen.getByLabelText('Stylesheet type'), 'scss');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Change stylesheet type?')).not.toBeInTheDocument();
  });

  it('disables the select when disabled is passed', () => {
    render(<StylesheetSourceControl value="css" onChange={vi.fn()} sourceIsEmpty disabled />);
    expect(screen.getByLabelText('Stylesheet type')).toBeDisabled();
  });
});
