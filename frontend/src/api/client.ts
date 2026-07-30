import type {
  ApiError,
  CurrentUserResponse,
  LoginRequest,
  LoginSuccessResponse,
} from '../types/auth';

const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

interface ApiErrorBody {
  message?: string;
  code?: string;
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (options.body && !headers.has('Content-Type')) {
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
  } catch {
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
