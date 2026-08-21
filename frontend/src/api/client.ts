import type {
  ApiError,
  CurrentUserResponse,
  LoginRequest,
  LoginSuccessResponse,
} from '../types/auth';
import type { RegistrationResponse } from '../types/registration';
import type {
  CreateEmailDocumentInput, CreateSavedModuleInput, EmailDocument, SavedEmailModule,
  UpdateEmailDocumentInput,
} from '../emailbuilder/types';

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

interface ApiErrorBody {
  message?: string;
  code?: string;
  errors?: Record<string, string[]>;
  request_id?: string;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  const isFormData = options.body instanceof FormData;

  if (options.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (UNSAFE_METHODS.has(method)) {
    const csrfToken = getCookie('csrftoken');
    if (csrfToken) {
      headers.set('X-CSRFToken', csrfToken);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include',
    });
  } catch (caught) {
    // An abort (whether from a caller-supplied timeout or an explicit user
    // cancel) is not a network failure — re-throw it as-is so callers can
    // tell the two apart and show the right message, instead of collapsing
    // every fetch failure into the same generic text.
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      throw caught;
    }
    const error: ApiError = {
      message: 'We could not connect. Check your connection and try again.',
    };
    throw error;
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const body = (data ?? {}) as ApiErrorBody;
    const error: ApiError = {
      message: body.message ?? 'Something went wrong. Please try again.',
      code: body.code,
      status: response.status,
      errors: body.errors,
      requestId: body.request_id,
    };
    throw error;
  }

  return data as T;
}

export async function initializeCsrf(): Promise<void> {
  await apiRequest<{ success: boolean; message: string }>('/api/v1/auth/csrf/');
}

export async function loginWithPassword(
  credentials: LoginRequest,
): Promise<LoginSuccessResponse> {
  return apiRequest<LoginSuccessResponse>('/api/v1/auth/login/', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export async function logout(): Promise<void> {
  await apiRequest<{ success: boolean; message: string }>('/api/v1/auth/logout/', {
    method: 'POST',
  });
}

export async function getCurrentUser(): Promise<CurrentUserResponse> {
  return apiRequest<CurrentUserResponse>('/api/v1/auth/me/');
}

export async function registerEmployee(formData: FormData): Promise<RegistrationResponse> {
  return apiRequest<RegistrationResponse>('/api/v1/auth/register/', {
    method: 'POST',
    body: formData,
  });
}

export async function createEmailDocument(input: CreateEmailDocumentInput): Promise<EmailDocument> {
  return apiRequest<EmailDocument>('/api/v1/email-builder/emails/', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listEmailDocuments(): Promise<EmailDocument[]> {
  return apiRequest<EmailDocument[]>('/api/v1/email-builder/emails/');
}

export async function getEmailDocument(id: number | string): Promise<EmailDocument> {
  return apiRequest<EmailDocument>(`/api/v1/email-builder/emails/${id}/`);
}

export async function updateEmailDocument(
  id: number | string, input: UpdateEmailDocumentInput,
): Promise<EmailDocument> {
  return apiRequest<EmailDocument>(`/api/v1/email-builder/emails/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function listSavedModules(): Promise<SavedEmailModule[]> {
  return apiRequest<SavedEmailModule[]>('/api/v1/email-builder/saved-modules/');
}

export async function createSavedModule(input: CreateSavedModuleInput): Promise<SavedEmailModule> {
  return apiRequest<SavedEmailModule>('/api/v1/email-builder/saved-modules/', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteSavedModule(id: number | string): Promise<void> {
  await apiRequest<void>(`/api/v1/email-builder/saved-modules/${id}/`, {
    method: 'DELETE',
  });
}
