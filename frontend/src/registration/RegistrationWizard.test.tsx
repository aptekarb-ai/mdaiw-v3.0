import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationWizard } from './RegistrationWizard';
import { registerEmployee } from '../api/client';
import type { RegistrationResponse } from '../types/registration';

vi.mock('../api/client', () => ({
  registerEmployee: vi.fn(),
}));

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelField(text: string) {
  return screen.getByLabelText(new RegExp(`^${escapeRegExp(text)}`));
}

async function findLabelField(text: string) {
  return screen.findByLabelText(new RegExp(`^${escapeRegExp(text)}`));
}

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegistrationWizard />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAccountStep(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<Record<string, string>> = {},
) {
  await user.type(labelField('Username'), overrides.username ?? 'new.employee');
  await user.type(labelField('Work Email'), overrides.workEmail ?? 'new.employee@example.com');
  await user.type(labelField('Password'), overrides.password ?? 'StrongPass123');
  await user.type(labelField('Confirm Password'), overrides.confirmPassword ?? 'StrongPass123');
  await user.click(screen.getByRole('button', { name: 'Next →' }));
}

async function fillEmployeeStep(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<Record<string, string>> = {},
) {
  await user.type(labelField('Employee ID'), overrides.employeeId ?? 'MDAIW-001');
  await user.type(labelField('First Name'), overrides.firstName ?? 'New');
  await user.type(labelField('Last Name'), overrides.lastName ?? 'Employee');
  await user.type(labelField('Designation'), overrides.designation ?? 'Software Engineer');
  await user.type(labelField('Department'), overrides.department ?? 'Engineering');
  await user.type(labelField('Location'), overrides.location ?? 'India');
  await user.type(labelField('Reporting Manager'), overrides.managerName ?? 'Priya Rao');
  await user.type(labelField('Date of Joining'), overrides.dateOfJoining ?? '2026-01-05');
  await user.type(labelField('Phone Number'), overrides.phone ?? '+919876543210');
  await user.type(labelField('Date of Birth'), overrides.dateOfBirth ?? '1990-06-15');
  await user.click(screen.getByRole('button', { name: 'Next →' }));
}

async function advanceToReview(user: ReturnType<typeof userEvent.setup>) {
  await fillAccountStep(user);
  await fillEmployeeStep(user);
  await user.click(screen.getByRole('button', { name: 'Continue to Review →' }));
}

describe('RegistrationWizard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the registration wizard', () => {
    renderWizard();
    expect(screen.getByRole('heading', { name: 'Employee Registration' })).toBeInTheDocument();
  });

  it('shows all four step labels', () => {
    renderWizard();
    expect(screen.getByText('Account Details')).toBeInTheDocument();
    expect(screen.getByText('Employee Details')).toBeInTheDocument();
    expect(screen.getByText('Face Enrollment')).toBeInTheDocument();
    expect(screen.getByText('Review and Submit')).toBeInTheDocument();
  });

  it('requires Step 1 fields before advancing', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: 'Next →' }));

    expect(await screen.findByText('Username is required.')).toBeInTheDocument();
    expect(screen.getByText('Work email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
  });

  it('rejects mismatched passwords', async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(labelField('Username'), 'new.employee');
    await user.type(labelField('Work Email'), 'new.employee@example.com');
    await user.type(labelField('Password'), 'StrongPass123');
    await user.type(labelField('Confirm Password'), 'Different123');
    await user.click(screen.getByRole('button', { name: 'Next →' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
  });

  it('toggles password visibility on the account step', async () => {
    const user = userEvent.setup();
    renderWizard();

    const passwordInput = labelField('Password') as HTMLInputElement;
    await user.type(passwordInput, 'StrongPass123');
    expect(passwordInput.type).toBe('password');

    await user.click(screen.getAllByRole('button', { name: 'Show password' })[0]);
    expect(passwordInput.type).toBe('text');
    expect(passwordInput.value).toBe('StrongPass123');
  });

  it('advances from Step 1 to Step 2 with valid data', async () => {
    const user = userEvent.setup();
    renderWizard();

    await fillAccountStep(user);

    expect(await findLabelField('Employee ID')).toBeInTheDocument();
  });

  it('requires Step 2 fields before advancing', async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillAccountStep(user);

    await user.click(screen.getByRole('button', { name: 'Next →' }));

    expect(await screen.findByText('Employee ID is required.')).toBeInTheDocument();
  });

  it('validates phone number format', async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillAccountStep(user);
    await fillEmployeeStep(user, { phone: 'abc' });

    expect(await screen.findByText('Enter a valid phone number.')).toBeInTheDocument();
  });

  it('validates date of birth cannot be in the future', async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillAccountStep(user);
    await fillEmployeeStep(user, { dateOfBirth: '2099-01-01' });

    expect(
      await screen.findByText('Date of birth cannot be today or in the future.'),
    ).toBeInTheDocument();
  });

  it('shows a profile photo preview after selecting a valid image', async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillAccountStep(user);

    const file = new File(['image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const input = document.getElementById('profile-photo-input') as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByAltText('Profile photo preview')).toBeInTheDocument();
  });

  it('rejects an unsupported image type client-side', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWizard();
    await fillAccountStep(user);

    const file = new File(['gif-bytes'], 'photo.gif', { type: 'image/gif' });
    const input = document.getElementById('profile-photo-input') as HTMLInputElement;
    await user.upload(input, file);

    expect(
      await screen.findByText('Profile photo must be a JPEG, PNG, or WebP image.'),
    ).toBeInTheDocument();
  });

  it('rejects an oversized image client-side', async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillAccountStep(user);

    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', {
      type: 'image/jpeg',
    });
    const input = document.getElementById('profile-photo-input') as HTMLInputElement;
    await user.upload(input, oversized);

    expect(await screen.findByText('Profile photo must be 5 MB or smaller.')).toBeInTheDocument();
  });

  it('preserves entered data when navigating backward', async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillAccountStep(user);
    await fillEmployeeStep(user);

    await user.click(screen.getByRole('button', { name: '← Back' }));
    expect(await findLabelField('Employee ID')).toHaveValue('MDAIW-001');

    await user.click(screen.getByRole('button', { name: '← Back' }));
    expect(await findLabelField('Username')).toHaveValue('new.employee');
  });

  it('shows the Face Enrollment informational step without requesting camera access', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });

    const user = userEvent.setup();
    renderWizard();
    await fillAccountStep(user);
    await fillEmployeeStep(user);

    expect(
      await screen.findByRole('heading', { name: 'Face Recognition Enrollment' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No camera access is requested here/)).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('shows the review screen without displaying passwords', async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToReview(user);

    expect(screen.getByText('Review & Confirm')).toBeInTheDocument();
    expect(screen.queryByText('StrongPass123')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText('new.employee')).toBeInTheDocument();
  });

  it('returns to the correct step when editing from review', async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToReview(user);

    const editButtons = screen.getAllByRole('button', { name: /Edit/ });
    await user.click(editButtons[0]);

    expect(await findLabelField('Username')).toHaveValue('new.employee');
  });

  it('requires the confirmation checkbox before submitting', async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToReview(user);

    await user.click(screen.getByRole('button', { name: 'Create Account →' }));

    expect(
      await screen.findByText('Please confirm that the entered information is correct.'),
    ).toBeInTheDocument();
    expect(registerEmployee).not.toHaveBeenCalled();
  });

  it('prevents duplicate submission while a request is in flight', async () => {
    let resolveRequest: (value: RegistrationResponse) => void = () => {};
    vi.mocked(registerEmployee).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const user = userEvent.setup();
    renderWizard();
    await advanceToReview(user);
    await user.click(labelField('I confirm that the entered information is correct'));

    const submitButton = screen.getByRole('button', { name: 'Create Account →' });
    await user.click(submitButton);
    expect(submitButton).toBeDisabled();

    await user.click(submitButton);
    expect(registerEmployee).toHaveBeenCalledTimes(1);

    resolveRequest({
      success: true,
      message: 'Registration details saved. Complete Face Enrollment to activate your account.',
      registration: {
        user_id: 1,
        username: 'new.employee',
        employee_id: 'MDAIW-001',
        work_email: 'new.employee@example.com',
        registration_status: 'PENDING_FACE_ENROLLMENT',
        face_enrollment_required: true,
      },
    });

    expect(await screen.findByText('Registration details saved')).toBeInTheDocument();
  });

  it('maps backend validation errors to the correct fields and step', async () => {
    vi.mocked(registerEmployee).mockRejectedValue({
      message: 'Please correct the highlighted fields.',
      code: 'VALIDATION_ERROR',
      status: 400,
      errors: { employee_id: ['This Employee ID is already registered.'] },
    });

    const user = userEvent.setup();
    renderWizard();
    await advanceToReview(user);
    await user.click(labelField('I confirm that the entered information is correct'));
    await user.click(screen.getByRole('button', { name: 'Create Account →' }));

    expect(await screen.findByText('This Employee ID is already registered.')).toBeInTheDocument();
    expect(labelField('Employee ID')).toBeInTheDocument();
  });

  it('shows the success screen with pending Face Enrollment status after registration', async () => {
    vi.mocked(registerEmployee).mockResolvedValue({
      success: true,
      message: 'Registration details saved. Complete Face Enrollment to activate your account.',
      registration: {
        user_id: 1,
        username: 'new.employee',
        employee_id: 'MDAIW-001',
        work_email: 'new.employee@example.com',
        registration_status: 'PENDING_FACE_ENROLLMENT',
        face_enrollment_required: true,
      },
    });

    const user = userEvent.setup();
    renderWizard();
    await advanceToReview(user);
    await user.click(labelField('I confirm that the entered information is correct'));
    await user.click(screen.getByRole('button', { name: 'Create Account →' }));

    expect(await screen.findByText('Registration details saved')).toBeInTheDocument();
    expect(screen.getByText('Pending Face Enrollment')).toBeInTheDocument();
    const badge = screen.getByText('Face Enrollment required').closest('p');
    expect(within(badge!).getByText('Face Enrollment required')).toBeInTheDocument();
  });

  it('never stores passwords in localStorage or sessionStorage', async () => {
    const user = userEvent.setup();
    renderWizard();
    await fillAccountStep(user);

    const localValues = Object.values(window.localStorage).join(' ');
    const sessionValues = Object.values(window.sessionStorage).join(' ');
    expect(localValues).not.toContain('StrongPass123');
    expect(sessionValues).not.toContain('StrongPass123');
  });
});
