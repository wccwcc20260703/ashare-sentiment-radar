import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

async function getStaticPayload<T>(filename: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${filename}.json`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Static data request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getMarketPayload<T>(): Promise<T> {
  if (import.meta.env.VITE_PAGES_MODE === 'true') {
    return getStaticPayload<T>('market');
  }
  const response = await axiosForBackend({
    url: '/api/market',
    method: 'GET',
  });
  return response.data as T;
}

export async function getSecurityRadarPayload<T>(): Promise<T> {
  if (import.meta.env.VITE_PAGES_MODE === 'true') {
    return getStaticPayload<T>('security-radar');
  }
  const response = await axiosForBackend({
    url: '/api/security-radar',
    method: 'GET',
  });
  return response.data as T;
}
