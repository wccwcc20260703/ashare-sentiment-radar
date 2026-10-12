const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 10_000;

class SourceHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

// Retry only a fresh request; never substitute a previous snapshot.
export async function fetchMarketData<T>(
  url: string | URL,
  headers: Record<string, string>,
  parse: (text: string) => T,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let failure: unknown;
    try {
      const response = await fetch(url, {
        headers,
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new SourceHttpError(response.status);
      }
      return parse(await response.text());
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timeout);
    }
    const retryable = !(failure instanceof SourceHttpError) ||
      failure.status === 408 || failure.status === 429 || failure.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      const message = failure instanceof Error ? failure.message : String(failure);
      const cause = failure instanceof Error && failure.cause instanceof Error
        ? ` (${failure.cause.message})` : '';
      const detail = controller.signal.aborted ? `请求超过 ${TIMEOUT_MS}ms: ${message}` : message + cause;
      throw new Error(`行情请求失败 (${url}, 尝试 ${attempt}/${MAX_ATTEMPTS}): ${detail}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
  }
  throw new Error('行情请求未完成');
}
