/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  fetchWithTimeout,
  getErrorMessage,
  readUpstreamErrorBody,
  resolveDanmakuApiBase,
} from '../_utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const keyword = request.nextUrl.searchParams.get('keyword');
    if (!keyword) {
      return NextResponse.json(
        {
          errorCode: -1,
          success: false,
          errorMessage: 'Missing keyword',
          animes: [],
        },
        { status: 400 }
      );
    }

    const base = await resolveDanmakuApiBase();
    const apiUrl = `${base}/api/v2/search/anime?keyword=${encodeURIComponent(keyword)}`;

    const response = await fetchWithTimeout(
      apiUrl,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      30000
    );

    if (!response.ok) {
      const upstreamMessage = await readUpstreamErrorBody(response);
      throw new Error(
        upstreamMessage
          ? `Danmaku search failed (${response.status}): ${upstreamMessage}`
          : `Danmaku search failed (${response.status})`
      );
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Danmaku request timeout'
        : getErrorMessage(error, 'Danmaku search failed');

    console.error('Danmaku search route error:', error);

    return NextResponse.json(
      {
        errorCode: -1,
        success: false,
        errorMessage: message,
        animes: [],
      },
      { status: 500 }
    );
  }
}

