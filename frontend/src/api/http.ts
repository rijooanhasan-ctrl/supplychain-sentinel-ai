export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

function normalizeErrorMessage(status: number, statusText: string, data: unknown): string {
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => {
          if (item && typeof item === 'object') {
            const loc = Array.isArray((item as { loc?: unknown[] }).loc)
              ? (item as { loc: unknown[] }).loc.slice(1).join('.')
              : '';
            const msg = (item as { msg?: string }).msg || JSON.stringify(item);
            return loc ? `${loc}: ${msg}` : msg;
          }
          return String(item);
        })
        .filter(Boolean);
      if (messages.length > 0) {
        return messages.join('; ');
      }
    }
  }
  return `HTTP ${status}: ${statusText || 'Request failed'}`;
}

export async function getJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { params, signal } = options;

  let url = path;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    const query = searchParams.toString();
    if (query) {
      url += (path.includes('?') ? '&' : '?') + query;
    }
  }

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (err: unknown) {
    if (
      (err instanceof Error && err.name === 'AbortError') ||
      (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError')
    ) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new NetworkError(`Server unreachable: ${message}`, { cause: err });
  }

  if (!response.ok) {
    let errorData: unknown = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        errorData = await response.json();
      } catch {
        errorData = null;
      }
    } else {
      try {
        errorData = await response.text();
      } catch {
        errorData = null;
      }
    }

    const message = normalizeErrorMessage(response.status, response.statusText, errorData);
    throw new ApiError(response.status, message, errorData);
  }

  const data: T = await response.json();
  return data;
}
