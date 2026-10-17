import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getJson, ApiError, NetworkError } from './http';

describe('http.ts getJson', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully fetches and parses JSON response', async () => {
    const mockData = { id: 1, name: 'Core Processor' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    } as Response);

    const result = await getJson<typeof mockData>('/api/test');
    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith('/api/test', { signal: undefined });
  });

  it('serializes query params and omits undefined/null values', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    } as Response);

    await getJson('/api/components', {
      params: {
        category: 'Compute',
        q: 'CPU',
        limit: 10,
        offset: 0,
        unused: undefined,
        empty: null,
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/components?category=Compute&q=CPU&limit=10&offset=0',
      { signal: undefined }
    );
  });

  it('appends query params to paths that already contain a query string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    await getJson('/api/search?type=active', {
      params: { q: 'RAM' },
    });

    expect(fetch).toHaveBeenCalledWith('/api/search?type=active&q=RAM', { signal: undefined });
  });

  it('normalizes 404 string detail into ApiError with status and message', async () => {
    const errorBody = { detail: 'Component not found' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => errorBody,
    } as Response);

    await expect(getJson('/api/components/999')).rejects.toThrow(ApiError);
  });

  it('throws ApiError with correct message and status for 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: 'Component not found' }),
    } as Response);

    try {
      await getJson('/api/components/999');
      expect.fail('Should have thrown ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.message).toBe('Component not found');
      expect(apiErr.detail).toEqual({ detail: 'Component not found' });
    }
  });

  it('normalizes 422 array detail into readable message', async () => {
    const errorBody = {
      detail: [
        { loc: ['query', 'limit'], msg: 'Input should be greater than 0' },
        { loc: ['query', 'days'], msg: 'Field required' },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => errorBody,
    } as Response);

    try {
      await getJson('/api/components/1/demand-history?limit=0');
      expect.fail('Should have thrown ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(422);
      expect(apiErr.message).toBe('limit: Input should be greater than 0; days: Field required');
    }
  });

  it('handles non-JSON error body and falls back to statusText', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'Database connection timeout',
    } as Response);

    try {
      await getJson('/api/broken');
      expect.fail('Should have thrown ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.message).toBe('HTTP 500: Internal Server Error');
      expect(apiErr.detail).toBe('Database connection timeout');
    }
  });

  it('wraps network failures into NetworkError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    try {
      await getJson('/api/health');
      expect.fail('Should have thrown NetworkError');
    } catch (err) {
      expect(err).toBeInstanceOf(NetworkError);
      const netErr = err as NetworkError;
      expect(netErr.name).toBe('NetworkError');
      expect(netErr.message).toBe('Server unreachable: Failed to fetch');
    }
  });

  it('handles aborted requests by rethrowing AbortError without wrapping in NetworkError', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError);

    const controller = new AbortController();
    controller.abort();

    try {
      await getJson('/api/components', { signal: controller.signal });
      expect.fail('Should have thrown AbortError');
    } catch (err) {
      expect(err).not.toBeInstanceOf(NetworkError);
      expect(err).not.toBeInstanceOf(ApiError);
      expect((err as Error).name).toBe('AbortError');
    }
  });
});
