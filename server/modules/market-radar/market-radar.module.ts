import { Module } from '@nestjs/common';

import { MarketRadarController } from './market-radar.controller';

@Module({
  controllers: [MarketRadarController],
})
export class MarketRadarModule {}
