import type {
  ApiError,
  CurrentUserResponse,
  LoginRequest,
  LoginSuccessResponse,
} from '../types/auth';
import type { RegistrationResponse } from '../types/registration';
import type {
  CreateEmailAssetExternalInput, CreateEmailAssetUploadInput, CreateEmailAttachmentResponse,
  CreateEmailDocumentInput, CreateSavedModuleInput, EmailAsset, EmailAttachment, EmailDocument,
  SavedEmailModule, UpdateEmailAssetInput, UpdateEmailDocumentInput,
} from '../emailbuilder/types';
import type { AICommandRequest, AICommandResponse } from '../emailbuilder/aiCommand';

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

export async function deleteEmailDocument(id: number | string): Promise<void> {
  await apiRequest<void>(`/api/v1/email-builder/emails/${id}/`, {
    method: 'DELETE',
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

export async function listEmailAssets(
  params: { search?: string; category?: string } = {},
): Promise<EmailAsset[]> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest<EmailAsset[]>(`/api/v1/email-builder/assets/${suffix}`);
}

export async function createEmailAssetUpload(input: CreateEmailAssetUploadInput): Promise<EmailAsset> {
  const formData = new FormData();
  formData.set('name', input.name);
  formData.set('category', input.category);
  formData.set('source_type', 'upload');
  formData.set('alt_text', input.alt_text ?? '');
  formData.set('file', input.file);
  return apiRequest<EmailAsset>('/api/v1/email-builder/assets/', {
    method: 'POST',
    body: formData,
  });
}

export async function createEmailAssetExternal(input: CreateEmailAssetExternalInput): Promise<EmailAsset> {
  return apiRequest<EmailAsset>('/api/v1/email-builder/assets/', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      category: input.category,
      source_type: 'external',
      alt_text: input.alt_text ?? '',
      external_url: input.external_url,
    }),
  });
}

export async function updateEmailAsset(
  id: number | string, input: UpdateEmailAssetInput,
): Promise<EmailAsset> {
  if (input.file) {
    const formData = new FormData();
    if (input.name !== undefined) formData.set('name', input.name);
    if (input.category !== undefined) formData.set('category', input.category);
    if (input.alt_text !== undefined) formData.set('alt_text', input.alt_text);
    formData.set('file', input.file);
    return apiRequest<EmailAsset>(`/api/v1/email-builder/assets/${id}/`, {
      method: 'PATCH',
      body: formData,
    });
  }
  return apiRequest<EmailAsset>(`/api/v1/email-builder/assets/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteEmailAsset(id: number | string): Promise<void> {
  await apiRequest<void>(`/api/v1/email-builder/assets/${id}/`, {
    method: 'DELETE',
  });
}

// D4-B (Feature 14 V4) — Email AI Engineer attachment/input ingestion.
// One request does validate+extract synchronously; the response carries
// both the metadata-only attachment record and the (never persisted)
// extracted facts. Every attachment belongs to exactly one EmailDocument
// (D4-B hardening) — the backend 404s if `documentId` isn't owned by the
// caller before it reads a single byte of `file`.
export async function createEmailAttachment(
  file: File, documentId: number | string,
): Promise<CreateEmailAttachmentResponse> {
  const formData = new FormData();
  formData.set('file', file);
  formData.set('document', String(documentId));
  return apiRequest<CreateEmailAttachmentResponse>('/api/v1/email-builder/attachments/', {
    method: 'POST',
    body: formData,
  });
}

// D4-B hardening — document-scoped by construction: the backend returns
// an empty list for any request that omits `?document=`, so this is the
// only way to list attachments at all. Used to restore metadata-only
// chips (id/filename/detected type/status/size/warnings/error — no
// facts, since those were never persisted) when the AI Engineer panel
// mounts/remounts for a given document.
export async function listEmailAttachments(documentId: number | string): Promise<EmailAttachment[]> {
  return apiRequest<EmailAttachment[]>(
    `/api/v1/email-builder/attachments/?document=${encodeURIComponent(String(documentId))}`,
  );
}

export async function deleteEmailAttachment(id: number | string): Promise<void> {
  await apiRequest<void>(`/api/v1/email-builder/attachments/${id}/`, {
    method: 'DELETE',
  });
}

// Feature 14 — AI Engineer Voice. Stateless single call: the server only
// interprets `message` into a validated action; applying it happens
// entirely client-side (see EmailBuilderWorkspacePage's
// handleApplyAiAction) through the existing builder mutation functions.
export async function requestAICommand(input: AICommandRequest): Promise<AICommandResponse> {
  return apiRequest<AICommandResponse>('/api/v1/email-builder/ai-command/', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
