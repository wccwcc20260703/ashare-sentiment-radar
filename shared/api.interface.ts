export interface LiveMarketPayload {
  live: boolean;
  marketOpen?: boolean;
  updatedAt: string;
  error?: string;
}

export interface LiveSecurityRadarPayload {
  live: boolean;
  marketOpen?: boolean;
  updatedAt?: string;
  error?: string;
}
