import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';

// Node 22.15+ can run these dependency-free regressions against the actual TS.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('./') && !specifier.endsWith('.ts')) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* try original */ }
    }
    return nextResolve(specifier, context);
  },
});
const { fetchMarketData } = await import('../../server/modules/market-radar/market-source.ts');
const { GET } = await import('../../server/modules/market-radar/market.service.ts');

async function settleRetries(t, operation) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = operation();
  // Drain fetch/body promises between backoffs, without advancing timeout clocks.
  for (let i = 0; i < 8; i++) {
    await setImmediate();
    t.mock.timers.tick(600);
  }
  return pending;
}

test('retries a transient HTTP failure with a fresh request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
    return ++calls === 1 ? new Response('', { status: 503 }) : new Response('{"ok":true}');
  });
  assert.deepEqual(await settleRetries(t, () => fetchMarketData('https://example.test/data', {}, JSON.parse)), { ok: true });
  assert.equal(calls, 2);
});

test('retries a network reset and malformed response', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) throw new Error('ECONNRESET');
    return new Response(calls === 2 ? 'bad json' : '{"ok":true}');
  });
  assert.deepEqual(await settleRetries(t, () => fetchMarketData('https://example.test/data', {}, JSON.parse)), { ok: true });
  assert.equal(calls, 3);
});

test('persistent failure stops after three attempts and names its source', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 503 }); });
  await settleRetries(t, () => assert.rejects(fetchMarketData('https://example.test/breadth?page=28', {}, JSON.parse), /breadth\?page=28.*3\/3.*HTTP 503/));
  assert.equal(calls, 3);
});

test('does not retry a permanent HTTP error', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 403 }); });
  await assert.rejects(fetchMarketData('https://example.test/data', {}, JSON.parse), /1\/3.*HTTP 403/);
  assert.equal(calls, 1);
});

test('timeout also bounds response-body consumption', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    calls++;
    return { ok: true, text: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) };
  });
  const pending = assert.rejects(fetchMarketData('https://example.test/slow', {}, JSON.parse), /3\/3.*aborted/);
  for (let i = 0; i < 6; i++) {
    await setImmediate();
    t.mock.timers.tick(i % 2 === 0 ? 10_000 : 600);
  }
  await pending;
  assert.equal(calls, 3);
});

function fixtureFetch(calls, failedPage = false) {
  const bars = Array.from({ length: 300 }, (_, index) => ({
    day: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: '3000', high: '3020', low: '2980', close: String(3000 + index), volume: '1000',
  }));
  const quote = ['sh000001', 'sz399001', 'sh000300'].map((symbol) => {
    const fields = Array(32).fill('0');
    fields[2] = '3298'; fields[3] = '3299'; fields[9] = '1000000000000';
    fields[30] = bars.at(-1).day; fields[31] = '15:00:00';
    return `var hq_str_${symbol}="${fields.join(',')}";`;
  }).join('\n');
  return async (input) => {
    const url = new URL(input);
    calls.set(url.href, (calls.get(url.href) ?? 0) + 1);
    await setImmediate(); // Force concurrent callers to meet before a response resolves.
    if (url.pathname.includes('StockCount')) return new Response('"5500"');
    if (url.pathname.includes('getKLineData')) return new Response(`callback(${JSON.stringify(bars)})`);
    if (url.hostname === 'hq.sinajs.cn') return new Response(quote);
    if (failedPage) return new Response('', { status: 503 });
    const page = Number(url.searchParams.get('page'));
    return new Response(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
      changepercent: 12 - ((page - 1) * 100 + i) / 200,
    }))));
  };
}

test('six breadth searches share in-flight requests with unchanged calculated counts', async (t) => {
  const calls = new Map();
  t.mock.method(globalThis, 'fetch', fixtureFetch(calls));
  const result = await GET();
  assert.equal(result.live, true, result.error);
  for (const [url, count] of calls) assert.equal(count, 1, url);
  assert.equal(result.market.up, 2400);
  assert.equal(result.market.down, 3099);
  assert.equal(result.market.flat, 1);
});

test('persistent breadth failure stays non-live', async (t) => {
  const calls = new Map();
  t.mock.method(globalThis, 'fetch', fixtureFetch(calls, true));
  const result = await settleRetries(t, () => GET());
  assert.equal(result.live, false);
  assert.match(result.error, /getHQNodeData.*3\/3.*HTTP 503/);
  assert.equal([...calls].filter(([url]) => url.includes('getHQNodeData'))[0][1], 3);
});

for (const failingSource of ['market', 'securityRadar']) {
  test(`generator refuses ${failingSource} failure without overwriting published data`, async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { spawnSync } = await import('node:child_process');
    const cwd = mkdtempSync(join(tmpdir(), 'radar-gate-'));
    const dataDir = join(cwd, 'client/public/data');
    mkdirSync(dataDir, { recursive: true });
    for (const file of ['market.json', 'security-radar.json']) writeFileSync(join(dataDir, file), 'previous snapshot');
    const source = new URL('../../scripts/generate-pages-data.ts', import.meta.url).href;
    const program = `
      import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, nextResolve) {
        const name = specifier.endsWith('/market.service') ? 'market' :
          specifier.endsWith('/security-radar.service') ? 'securityRadar' : null;
        if (name) {
          const payload = { live: name !== ${JSON.stringify(failingSource)}, error: 'provider timeout' };
          return { url: 'data:text/javascript,' + encodeURIComponent('export async function GET() { return ' + JSON.stringify(payload) + '; }'), shortCircuit: true };
        }
        return nextResolve(specifier, context);
      }});
      await import(${JSON.stringify(source)});
    `;
    try {
      const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { cwd, encoding: 'utf8' });
      assert.equal(child.status, 1, child.stderr);
      assert.match(child.stderr, /provider timeout/);
      for (const file of ['market.json', 'security-radar.json']) assert.equal(readFileSync(join(dataDir, file), 'utf8'), 'previous snapshot');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

for (const status of [408, 429]) {
  test(`retries HTTP ${status} within the same bounded budget`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 1
      ? new Response('', { status }) : new Response('42'));
    assert.equal(await settleRetries(t, () => fetchMarketData('https://example.test/data', {}, Number)), 42);
    assert.equal(calls, 2);
  });
}

test('timeout bounds waiting for response headers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  });
  const pending = assert.rejects(fetchMarketData('https://example.test/slow', {}, Number), /3\/3.*10000ms/);
  for (let i = 0; i < 6; i++) {
    await setImmediate();
    t.mock.timers.tick(i % 2 === 0 ? 10_000 : 600);
  }
  await pending;
  assert.equal(calls, 3);
});

test('transient malformed breadth is refetched, never counted as empty', async (t) => {
  const calls = new Map();
  const validFetch = fixtureFetch(calls);
  let corrupted = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('getHQNodeData') && !corrupted) {
      corrupted = true;
      return new Response('null');
    }
    return validFetch(url);
  });
  const result = await settleRetries(t, () => GET());
  assert.equal(result.live, true, result.error);
  assert.equal(result.market.up, 2400);
  assert.equal(result.market.down, 3099);
});
