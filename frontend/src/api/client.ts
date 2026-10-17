export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  environment: string;
  data_source: string;
  timestamp: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}: ${response.statusText}`);
  }
  const data: HealthResponse = await response.json();
  return data;
}
