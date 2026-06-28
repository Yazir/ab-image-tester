const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

export function api<T>(url: string, init?: RequestInit): Promise<T> {
  return request<T>(url, init);
}

export function authHeaders(token: string): Record<string, string> {
  return { 'x-admin-token': token };
}

function getFingerprint(): string {
  let fp = localStorage.getItem('voterFingerprint');
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem('voterFingerprint', fp);
  }
  return fp;
}

function getVoterToken(): string | null {
  return sessionStorage.getItem('voterToken');
}

function setVoterToken(token: string) {
  sessionStorage.setItem('voterToken', token);
}

export function voterHeaders(): Record<string, string> {
  const fp = getFingerprint();
  const token = getVoterToken();
  const headers: Record<string, string> = { 'x-voter-fingerprint': fp };
  if (token) headers['x-voter-token'] = token;
  return headers;
}

export function storeVoterToken(token: string) {
  setVoterToken(token);
}
