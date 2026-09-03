import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

export async function getMarketPayload<T>(): Promise<T> {
  const response = await axiosForBackend({
    url: '/api/market',
    method: 'GET',
  });
  return response.data as T;
}

export async function getSecurityRadarPayload<T>(): Promise<T> {
  const response = await axiosForBackend({
    url: '/api/security-radar',
    method: 'GET',
  });
  return response.data as T;
}
