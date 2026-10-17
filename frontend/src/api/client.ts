import { getHealth } from './endpoints';
import type { HealthResponse } from './types';

export type { HealthResponse };

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getHealth(signal);
}
