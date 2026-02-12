/* eslint-disable no-console */

import { getConfig } from '@/lib/config';

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

export async function resolveDanmakuApiBase(): Promise<string> {
  let base =
    process.env.DANMAKU_API_BASE ||
    process.env.NEXT_PUBLIC_DANMAKU_API_BASE ||
    'http://localhost:9321';
  let token =
    process.env.DANMAKU_API_TOKEN ||
    process.env.NEXT_PUBLIC_DANMAKU_API_TOKEN ||
    '87654321';

  try {
    const config = await getConfig();
    const siteConfig = (config.SiteConfig || {}) as Record<string, unknown>;

    if (typeof siteConfig.DanmakuApiBase === 'string' && siteConfig.DanmakuApiBase.trim()) {
      base = siteConfig.DanmakuApiBase;
    }
    if (typeof siteConfig.DanmakuApiToken === 'string' && siteConfig.DanmakuApiToken.trim()) {
      token = siteConfig.DanmakuApiToken;
    }
  } catch (error) {
    console.error('Failed to read danmaku config from admin config:', error);
  }

  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedToken = trimSlashes(token.trim());

  if (!normalizedToken || normalizedToken === '87654321') {
    return normalizedBase;
  }

  return `${normalizedBase}/${normalizedToken}`;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      keepalive: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function readUpstreamErrorBody(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = (await response.json()) as {
        errorMessage?: string;
        message?: string;
        error?: string;
      };
      return data.errorMessage || data.message || data.error || '';
    }

    const text = (await response.text()).trim();
    if (!text) return '';
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const errorWithCause = error as Error & { cause?: unknown };
  const cause = errorWithCause.cause;
  const causeMessage =
    typeof cause === 'string'
      ? cause
      : cause instanceof Error
        ? cause.message
        : '';

  if (causeMessage && !error.message.includes(causeMessage)) {
    return `${error.message}: ${causeMessage}`;
  }

  return error.message || fallback;
}

