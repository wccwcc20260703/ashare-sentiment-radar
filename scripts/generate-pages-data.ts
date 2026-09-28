import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { GET as getMarketPayload } from '../server/modules/market-radar/market.service';
import { GET as getSecurityRadarPayload } from '../server/modules/market-radar/security-radar.service';

async function main() {
  const [market, securityRadar] = await Promise.all([
    getMarketPayload(),
    getSecurityRadarPayload(),
  ]);

  if (!market.live || !securityRadar.live) {
    throw new Error(
      `行情生成失败：market=${String(market.live)}, securityRadar=${String(securityRadar.live)}`,
    );
  }

  const outputDir = path.resolve('client/public/data');
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, 'market.json'), JSON.stringify(market)),
    writeFile(
      path.join(outputDir, 'security-radar.json'),
      JSON.stringify(securityRadar),
    ),
  ]);

  const latestMarketDate = market.fearGreedTrend?.at(-1)?.date ?? 'unknown';
  console.log(`GitHub Pages data generated: ${latestMarketDate}`);
}

void main();
