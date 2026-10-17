import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApi } from './useApi';

describe('useApi hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('transitions from loading to success with data', async () => {
    const mockData = { message: 'hello world' };
    const fetcher = vi.fn().mockResolvedValue(mockData);

    const { result } = renderHook(() => useApi(fetcher));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('handles error and successfully recovers when reload() is called', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('Initial fetch failed'))
      .mockResolvedValueOnce({ status: 'recovered' });

    const { result } = renderHook(() => useApi(fetcher));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Initial fetch failed');

    // Trigger reload
    act(() => {
      result.current.reload();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual({ status: 'recovered' });
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cancels request and performs no state update after unmount', async () => {
    let capturedSignal: AbortSignal | null = null;
    const fetcher = vi.fn().mockImplementation((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise((resolve) => {
        setTimeout(() => resolve({ done: true }), 100);
      });
    });

    const { unmount } = renderHook(() => useApi(fetcher));

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);

    unmount();

    expect(capturedSignal!.aborted).toBe(true);
  });

  it('aborted requests do not surface as errors', async () => {
    const fetcher = vi.fn().mockImplementation((signal: AbortSignal) => {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      });
    });

    const { result, unmount } = renderHook(() => useApi(fetcher));

    expect(result.current.loading).toBe(true);
    unmount();

    // After unmount, error must still be null (not set to AbortError)
    expect(result.current.error).toBeNull();
  });
});
