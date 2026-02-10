import { NextResponse } from 'next/server';

export const runtime = 'edge';

const DEFAULT_TMDB_API_KEY = '45bf9a17a758ffdaf0193182c8f42625';
const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const DETAIL_CACHE_SECONDS = 600;
const DETAIL_REQUEST_TIMEOUT_MS = 10000;
const DETAIL_CACHE_MAX_ENTRIES = 300;

type TmdbMediaType = 'movie' | 'tv';

interface TmdbLogoItem {
  file_path?: string | null;
  iso_639_1?: string | null;
  vote_average?: number;
  width?: number;
}

interface TmdbDetailRawGenre {
  name?: string;
}

interface TmdbDetailRawCast {
  id?: number;
  name?: string;
  character?: string;
  profile_path?: string | null;
}

interface TmdbDetailRawVideo {
  site?: string;
  type?: string;
  key?: string;
  official?: boolean;
  iso_639_1?: string | null;
}

interface TmdbDetailRawResponse {
  id?: number;
  title?: string;
  name?: string;
  overview?: string;
  backdrop_path?: string | null;
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  original_language?: string;
  popularity?: number;
  genres?: TmdbDetailRawGenre[];
  credits?: {
    cast?: TmdbDetailRawCast[];
  };
  videos?: {
    results?: TmdbDetailRawVideo[];
  };
  images?: {
    logos?: TmdbLogoItem[];
  };
  release_dates?: {
    results?: Array<{
      iso_3166_1?: string;
      release_dates?: Array<{ certification?: string }>;
    }>;
  };
  content_ratings?: {
    results?: Array<{
      iso_3166_1?: string;
      rating?: string;
    }>;
  };
}

interface TmdbSearchResponse {
  results?: Array<{
    id?: number;
    media_type?: 'movie' | 'tv' | string;
  }>;
}

interface TmdbDetailResponse {
  id: number;
  mediaType: TmdbMediaType;
  title: string;
  logo?: string;
  overview: string;
  backdrop: string;
  poster: string;
  score: string;
  voteCount: number;
  year: string;
  runtime: number | null;
  seasons: number | null;
  episodes: number | null;
  contentRating: string;
  genres: string[];
  language: string;
  popularity: number | null;
  cast: Array<{
    id: number;
    name: string;
    character: string;
    profile?: string;
  }>;
  trailerUrl: string;
}

interface TmdbDetailCacheEntry {
  expiresAt: number;
  payload: TmdbDetailResponse;
}

const globalWithTmdbDetailCache = globalThis as typeof globalThis & {
  __tmdbDetailCache?: Map<string, TmdbDetailCacheEntry>;
};

const tmdbDetailCache =
  globalWithTmdbDetailCache.__tmdbDetailCache ||
  (globalWithTmdbDetailCache.__tmdbDetailCache = new Map());

function normalizeMediaType(value: string | null): TmdbMediaType {
  return value === 'tv' || value === 'show' ? 'tv' : 'movie';
}

function normalizeYear(value: string | null): string {
  const year = (value || '').trim();
  return /^\d{4}$/.test(year) ? year : '';
}

function normalizeTitleForCache(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toYear(value?: string): string {
  if (!value) return '';
  const year = value.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : '';
}

function toScore(value?: number): string {
  if (typeof value !== 'number') return '';
  if (!Number.isFinite(value) || value <= 0) return '';
  return value.toFixed(1);
}

function toImageUrl(path?: string | null, size = 'w500'): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

function pickPreferredCertification(byCountry: Map<string, string>): string {
  const preferredCountries = ['US', 'CN', 'GB', 'HK', 'JP'];
  for (const country of preferredCountries) {
    const certification = byCountry.get(country);
    if (certification) return certification;
  }
  const first = byCountry.values().next();
  return first.done ? '' : first.value;
}

function pickMovieContentRatingFromRaw(raw: TmdbDetailRawResponse): string {
  const byCountry = new Map<string, string>();
  for (const item of raw.release_dates?.results || []) {
    const country = (item.iso_3166_1 || '').toUpperCase();
    if (!country) continue;
    const certification =
      item.release_dates?.find((entry) => (entry.certification || '').trim())
        ?.certification || '';
    if (!certification) continue;
    byCountry.set(country, certification);
  }
  return pickPreferredCertification(byCountry);
}

function pickTvContentRatingFromRaw(raw: TmdbDetailRawResponse): string {
  const byCountry = new Map<string, string>();
  for (const item of raw.content_ratings?.results || []) {
    const country = (item.iso_3166_1 || '').toUpperCase();
    const rating = (item.rating || '').trim();
    if (!country || !rating) continue;
    byCountry.set(country, rating);
  }
  return pickPreferredCertification(byCountry);
}

function pickTrailerUrlFromRaw(raw: TmdbDetailRawResponse): string {
  const candidates = (raw.videos?.results || []).filter(
    (item) =>
      item.site === 'YouTube' &&
      item.type === 'Trailer' &&
      Boolean(item.key)
  );
  if (!candidates.length) return '';

  const getLangPriority = (lang?: string | null): number => {
    if (lang === 'zh') return 3;
    if (lang === 'en') return 2;
    if (lang === null || lang === undefined) return 1;
    return 0;
  };

  const sorted = [...candidates].sort((a, b) => {
    const officialDelta =
      Number(Boolean(b.official)) - Number(Boolean(a.official));
    if (officialDelta !== 0) return officialDelta;
    return getLangPriority(b.iso_639_1) - getLangPriority(a.iso_639_1);
  });

  const key = sorted[0]?.key;
  return key ? `https://www.youtube.com/watch?v=${key}` : '';
}

function selectBestLogoPath(logos: TmdbLogoItem[]): string {
  if (!logos.length) return '';

  const getLanguagePriority = (lang?: string | null): number => {
    if (lang === 'zh') return 4;
    if (lang === 'en') return 3;
    if (lang === null || lang === undefined) return 2;
    return 1;
  };

  const sorted = logos
    .filter((logo) => logo.file_path)
    .sort((a, b) => {
      const lp =
        getLanguagePriority(b.iso_639_1) - getLanguagePriority(a.iso_639_1);
      if (lp !== 0) return lp;
      const vr = (b.vote_average || 0) - (a.vote_average || 0);
      if (vr !== 0) return vr;
      return (b.width || 0) - (a.width || 0);
    });

  return sorted[0]?.file_path || '';
}

function buildCacheHeaders(): HeadersInit {
  return {
    'Cache-Control': `public, max-age=${DETAIL_CACHE_SECONDS}, s-maxage=${DETAIL_CACHE_SECONDS}, stale-while-revalidate=60`,
    'CDN-Cache-Control': `public, s-maxage=${DETAIL_CACHE_SECONDS}, stale-while-revalidate=60`,
    'Vercel-CDN-Cache-Control': `public, s-maxage=${DETAIL_CACHE_SECONDS}, stale-while-revalidate=60`,
  };
}

function readDetailCache(key: string): TmdbDetailResponse | null {
  const hit = tmdbDetailCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    tmdbDetailCache.delete(key);
    return null;
  }
  return hit.payload;
}

function writeDetailCache(key: string, payload: TmdbDetailResponse): void {
  tmdbDetailCache.set(key, {
    payload,
    expiresAt: Date.now() + DETAIL_CACHE_SECONDS * 1000,
  });

  if (tmdbDetailCache.size <= DETAIL_CACHE_MAX_ENTRIES) return;
  const oldestKey = tmdbDetailCache.keys().next().value;
  if (oldestKey) {
    tmdbDetailCache.delete(oldestKey);
  }
}

async function resolveTmdbTargetFromTitle(
  title: string,
  year: string,
  mediaType: TmdbMediaType,
  apiKey: string,
  signal: AbortSignal
): Promise<{ id: number; mediaType: TmdbMediaType } | null> {
  const otherType: TmdbMediaType = mediaType === 'movie' ? 'tv' : 'movie';
  const attempts: Array<{
    endpoint: 'movie' | 'tv' | 'multi';
    year?: string;
  }> = [
    { endpoint: mediaType, year },
    { endpoint: mediaType },
    { endpoint: otherType, year },
    { endpoint: otherType },
    { endpoint: 'multi' },
  ];

  for (const attempt of attempts) {
    const params = new URLSearchParams({
      api_key: apiKey,
      language: 'zh-CN',
      include_adult: 'false',
      query: title,
      page: '1',
    });

    if (attempt.year && attempt.endpoint !== 'multi') {
      params.set(
        attempt.endpoint === 'movie' ? 'year' : 'first_air_date_year',
        attempt.year
      );
    }

    try {
      const response = await fetch(
        `${TMDB_API_BASE_URL}/search/${attempt.endpoint}?${params.toString()}`,
        {
          signal,
          headers: {
            Accept: 'application/json',
          },
        }
      );
      if (!response.ok) continue;

      const payload = (await response.json()) as TmdbSearchResponse;
      const first = payload.results?.[0];
      const resolvedId = Number(first?.id);
      if (!Number.isInteger(resolvedId) || resolvedId <= 0) continue;

      if (attempt.endpoint === 'multi') {
        const resolvedMediaType =
          first?.media_type === 'movie' || first?.media_type === 'tv'
            ? first.media_type
            : null;
        if (!resolvedMediaType) continue;
        return { id: resolvedId, mediaType: resolvedMediaType };
      }

      return { id: resolvedId, mediaType: attempt.endpoint };
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchTmdbDetailRaw(
  mediaType: TmdbMediaType,
  id: number,
  apiKey: string,
  signal: AbortSignal
): Promise<TmdbDetailRawResponse | null> {
  const appendToResponse =
    mediaType === 'movie'
      ? 'credits,videos,release_dates,images'
      : 'credits,videos,content_ratings,images';

  const params = new URLSearchParams({
    api_key: apiKey,
    language: 'zh-CN',
    append_to_response: appendToResponse,
    include_image_language: 'zh,en,null',
  });

  try {
    const response = await fetch(
      `${TMDB_API_BASE_URL}/${mediaType}/${id}?${params.toString()}`,
      {
        signal,
        headers: {
          Accept: 'application/json',
        },
      }
    );
    if (!response.ok) return null;
    return (await response.json()) as TmdbDetailRawResponse;
  } catch {
    return null;
  }
}

function mapRawDetailToResponse(
  raw: TmdbDetailRawResponse,
  input: {
    id: number;
    mediaType: TmdbMediaType;
    fallbackTitle: string;
    fallbackYear: string;
    fallbackPoster: string;
    fallbackScore: string;
  }
): TmdbDetailResponse {
  const cast = (raw.credits?.cast || [])
    .slice(0, 8)
    .map((member) => ({
      id: member.id ?? 0,
      name: member.name || '',
      character: member.character || '',
      profile: toImageUrl(member.profile_path, 'w185'),
    }))
    .filter((member) => member.id > 0 && member.name);

  const contentRating =
    input.mediaType === 'movie'
      ? pickMovieContentRatingFromRaw(raw)
      : pickTvContentRatingFromRaw(raw);

  const runtime =
    input.mediaType === 'movie'
      ? (raw.runtime ?? null)
      : (raw.episode_run_time?.[0] ?? null);

  const logoPath = selectBestLogoPath(raw.images?.logos || []);

  return {
    id: raw.id || input.id,
    mediaType: input.mediaType,
    title: (raw.title || raw.name || input.fallbackTitle || '').trim(),
    logo: logoPath ? `${TMDB_IMAGE_BASE_URL}/w500${logoPath}` : undefined,
    overview: (raw.overview || '').trim() || 'No overview available.',
    backdrop: toImageUrl(raw.backdrop_path, 'original'),
    poster: toImageUrl(raw.poster_path, 'w500') || input.fallbackPoster || '',
    score: toScore(raw.vote_average) || input.fallbackScore || '',
    voteCount: raw.vote_count || 0,
    year: toYear(raw.release_date || raw.first_air_date) || input.fallbackYear,
    runtime,
    seasons: raw.number_of_seasons ?? null,
    episodes: raw.number_of_episodes ?? null,
    contentRating,
    genres: (raw.genres || [])
      .map((genre) => (genre.name || '').trim())
      .filter(Boolean),
    language: (raw.original_language || '').toUpperCase(),
    popularity:
      typeof raw.popularity === 'number' ? Math.round(raw.popularity) : null,
    cast,
    trailerUrl: pickTrailerUrlFromRaw(raw),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = (searchParams.get('title') || '').trim();
  const year = normalizeYear(searchParams.get('year'));
  const fallbackPoster = (searchParams.get('poster') || '').trim();
  const fallbackScore = (searchParams.get('score') || '').trim();
  const mediaType = normalizeMediaType(
    searchParams.get('mediaType') || searchParams.get('type')
  );

  const rawId = Number(searchParams.get('id'));
  const hasValidId = Number.isInteger(rawId) && rawId > 0;

  if (!hasValidId && !title) {
    return NextResponse.json(
      { error: 'missing id or title parameter' },
      { status: 400 }
    );
  }

  const apiKey =
    process.env.TMDB_API_KEY ||
    process.env.NEXT_PUBLIC_TMDB_API_KEY ||
    DEFAULT_TMDB_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'tmdb api key missing' }, { status: 500 });
  }

  const cacheKey = hasValidId
    ? `id:${mediaType}:${rawId}`
    : `title:${mediaType}:${normalizeTitleForCache(title)}:${year}`;

  const cacheHit = readDetailCache(cacheKey);
  if (cacheHit) {
    return NextResponse.json(cacheHit, { headers: buildCacheHeaders() });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DETAIL_REQUEST_TIMEOUT_MS);

  try {
    let resolvedId = rawId;
    let resolvedMediaType = mediaType;

    if (!hasValidId) {
      const resolved = await resolveTmdbTargetFromTitle(
        title,
        year,
        mediaType,
        apiKey,
        controller.signal
      );
      if (!resolved) {
        return NextResponse.json(
          { error: 'tmdb detail not found' },
          { status: 404 }
        );
      }
      resolvedId = resolved.id;
      resolvedMediaType = resolved.mediaType;
    }

    const rawDetail = await fetchTmdbDetailRaw(
      resolvedMediaType,
      resolvedId,
      apiKey,
      controller.signal
    );

    if (!rawDetail) {
      return NextResponse.json(
        { error: 'tmdb detail request failed' },
        { status: 502 }
      );
    }

    const payload = mapRawDetailToResponse(rawDetail, {
      id: resolvedId,
      mediaType: resolvedMediaType,
      fallbackTitle: title,
      fallbackYear: year,
      fallbackPoster,
      fallbackScore,
    });

    writeDetailCache(cacheKey, payload);
    writeDetailCache(`id:${resolvedMediaType}:${resolvedId}`, payload);

    return NextResponse.json(payload, { headers: buildCacheHeaders() });
  } catch {
    return NextResponse.json(
      { error: 'tmdb detail request failed' },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
