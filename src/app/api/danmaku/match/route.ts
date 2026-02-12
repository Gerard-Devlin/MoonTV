/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  fetchWithTimeout,
  getErrorMessage,
  readUpstreamErrorBody,
  resolveDanmakuApiBase,
} from '../_utils';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { fileName?: string };
    const fileName = (body.fileName || '').trim();

    if (!fileName) {
      return NextResponse.json(
        {
          errorCode: -1,
          success: false,
          errorMessage: 'Missing fileName',
          isMatched: false,
          matches: [],
        },
        { status: 400 }
      );
    }

    const base = await resolveDanmakuApiBase();
    const apiUrl = `${base}/api/v2/match`;

    const response = await fetchWithTimeout(
      apiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileName }),
      },
      30000
    );

    if (!response.ok) {
      const upstreamMessage = await readUpstreamErrorBody(response);
      throw new Error(
        upstreamMessage
          ? `Danmaku match failed (${response.status}): ${upstreamMessage}`
          : `Danmaku match failed (${response.status})`
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Danmaku request timeout'
        : getErrorMessage(error, 'Danmaku match failed');

    console.error('Danmaku match route error:', error);

    return NextResponse.json(
      {
        errorCode: -1,
        success: false,
        errorMessage: message,
        isMatched: false,
        matches: [],
      },
      { status: 500 }
    );
  }
}

