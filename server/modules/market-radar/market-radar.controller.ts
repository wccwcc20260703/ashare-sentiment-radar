import { Controller, Get, Header } from '@nestjs/common';

import type {
  LiveMarketPayload,
  LiveSecurityRadarPayload,
} from '@shared/api.interface';

import { GET as getMarketPayload } from './market.service';
import { GET as getSecurityRadarPayload } from './security-radar.service';

@Controller('api')
export class MarketRadarController {
  @Get('market')
  @Header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60')
  async getMarket(): Promise<LiveMarketPayload> {
    return getMarketPayload();
  }

  @Get('security-radar')
  @Header('Cache-Control', 'public, max-age=15, stale-while-revalidate=60')
  async getSecurityRadar(): Promise<LiveSecurityRadarPayload> {
    return getSecurityRadarPayload();
  }
}
