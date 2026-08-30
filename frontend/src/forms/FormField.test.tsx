import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormField } from './FormField';

// Visual QA — FormField.css targets inputs by literal attribute selector
// (input[type='text'], input[type='email'], ...). Any caller that omits
// `type` used to render a completely unstyled native <input> (no height/
// padding/border/radius/font-size), because a missing attribute never
// matches an attribute selector even though the browser treats it as
// text behaviorally. Defaulting `type` to 'text' fixes every current and
// future caller that omits it, at the one shared source.
describe('FormField', () => {
  it('defaults to type="text" so the shared input styling always applies', () => {
    render(<FormField id="f1" label="Email Name" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Email Name')).toHaveAttribute('type', 'text');
  });

  it('still respects an explicitly passed type', () => {
    render(<FormField id="f2" label="Work Email" type="email" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Work Email')).toHaveAttribute('type', 'email');
  });
});
