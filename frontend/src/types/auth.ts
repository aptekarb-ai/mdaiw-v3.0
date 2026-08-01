export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginSuccessResponse {
  success: true;
  message: string;
  user: User;
}

export interface LoginFailureResponse {
  success: false;
  code: string;
  message: string;
}

export type LoginResponse = LoginSuccessResponse | LoginFailureResponse;

export interface CurrentUserResponse {
  authenticated: boolean;
  user: User | null;
}

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
  errors?: Record<string, string[]>;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  setAuthenticatedUser: (user: User) => void;
}
