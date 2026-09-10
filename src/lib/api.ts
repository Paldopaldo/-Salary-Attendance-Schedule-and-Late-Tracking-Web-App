const API_BASE = '/api';

export function getAuthToken(): string | null {
  return localStorage.getItem('salary_tracker_token');
}

export function setAuthToken(token: string) {
  localStorage.setItem('salary_tracker_token', token);
}

export function clearAuthToken() {
  localStorage.removeItem('salary_tracker_token');
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `HTTP error ${response.status}`);
  }

  return data;
}
