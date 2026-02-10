import { NextResponse } from 'next/server';

export const runtime = 'edge';

const DEFAULT_TMDB_API_KEY = '45bf9a17a758ffdaf0193182c8f42625';
const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const HERO_CACHE_SECONDS = 300;
const HERO_CACHE_MAX_ENTRIES = 8;

type TmdbMediaType = 'movie' | 'tv';
type HeroMediaFilter = 'all' | TmdbMediaType;

interface TmdbTrendingItem {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  overview?: string;
  backdrop_path?: string | null;
  poster_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}

interface TmdbTrendingResponse {
  results?: TmdbTrendingItem[];
}

interface TmdbHeroItem {
  id: number;
  mediaType: TmdbMediaType;
  title: string;
  overview: string;
  year: string;
  score: string;
  backdrop: string;
  poster: string;
  runtime: number | null;
  seasons: number | null;
  episodes: number | null;
  logo?: string;
}

interface TmdbLogoItem {
  file_path?: string | null;
  iso_639_1?: string | null;
  vote_average?: number;
  width?: number;
}

interface TmdbImagesResponse {
  logos?: TmdbLogoItem[];
}

interface TmdbRuntimeResponse {
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
}

interface TmdbHeroMeta {
  runtime: number | null;
  seasons: number | null;
  episodes: number | null;
}

interface TmdbHeroCacheEntry {
  expiresAt: number;
  results: TmdbHeroItem[];
}

const globalWithTmdbHeroCache = globalThis as typeof globalThis & {
  __tmdbHeroCache?: Map<string, TmdbHeroCacheEntry>;
};

const tmdbHeroCache =
  globalWithTmdbHeroCache.__tmdbHeroCache ||
  (globalWithTmdbHeroCache.__tmdbHeroCache = new Map());

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

function mapHeroItem(item: TmdbTrendingItem): TmdbHeroItem | null {
  const mediaType: TmdbMediaType =
    item.media_type === 'tv' ? 'tv' : item.media_type === 'movie' ? 'movie' : 'movie';
  const title = (item.title || item.name || '').trim();
  const backdropPath = item.backdrop_path || '';
  const posterPath = item.poster_path || '';

  if (!title || !backdropPath || !posterPath) return null;

  return {
    id: item.id,
    mediaType,
    title,
    overview: (item.overview || '').trim() || 'No overview available.',
    year: toYear(item.release_date || item.first_air_date),
    score: toScore(item.vote_average),
    backdrop: `${TMDB_IMAGE_BASE_URL}/original${backdropPath}`,
    poster: `${TMDB_IMAGE_BASE_URL}/w500${posterPath}`,
    runtime: null,
    seasons: null,
    episodes: null,
  };
}

function selectBestLogoPath(logos: TmdbLogoItem[]): string {
  if (!logos.length) return '';

  const getLanguagePriority = (lang?: string | null): number => {
    if (lang === 'zh') return 4;
    if (lang === 'en') return 3;
    if (lang === null) return 2;
    if (lang === undefined) return 2;
    return 1;
  };

  const sorted = logos
    .filter((logo) => logo.file_path)
    .sort((a, b) => {
      const lp = getLanguagePriority(b.iso_639_1) - getLanguagePriority(a.iso_639_1);
      if (lp !== 0) return lp;
      const vr = (b.vote_average || 0) - (a.vote_average || 0);
      if (vr !== 0) return vr;
      return (b.width || 0) - (a.width || 0);
    });

  return sorted[0]?.file_path || '';
}

async function fetchLogoForItem(
  mediaType: TmdbMediaType,
  id: number,
  apiKey: string,
  signal: AbortSignal
): Promise<string> {
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      include_image_language: 'zh,en,null',
    });

    const response = await fetch(
      `${TMDB_API_BASE_URL}/${mediaType}/${id}/images?${params.toString()}`,
      { signal }
    );

    if (!response.ok) return '';

    const data = (await response.json()) as TmdbImagesResponse;
    const logoPath = selectBestLogoPath(data.logos || []);
    return logoPath ? `${TMDB_IMAGE_BASE_URL}/w500${logoPath}` : '';
  } catch {
    return '';
  }
}

async function fetchHeroMetaForItem(
  mediaType: TmdbMediaType,
  id: number,
  apiKey: string,
  signal: AbortSignal
): Promise<TmdbHeroMeta> {
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      language: 'zh-CN',
    });

    const response = await fetch(
      `${TMDB_API_BASE_URL}/${mediaType}/${id}?${params.toString()}`,
      { signal }
    );
    if (!response.ok) {
      return {
        runtime: null,
        seasons: null,
        episodes: null,
      };
    }

    const data = (await response.json()) as TmdbRuntimeResponse;
    const runtime =
      mediaType === 'movie' ? data.runtime : data.episode_run_time?.[0];
    const seasons = data.number_of_seasons;
    const episodes = data.number_of_episodes;
    return {
      runtime: typeof runtime === 'number' && runtime > 0 ? runtime : null,
      seasons:
        mediaType === 'tv' && typeof seasons === 'number' && seasons > 0
          ? seasons
          : null,
      episodes:
        mediaType === 'tv' && typeof episodes === 'number' && episodes > 0
          ? episodes
          : null,
    };
  } catch {
    return {
      runtime: null,
      seasons: null,
      episodes: null,
    };
  }
}

function normalizeMediaFilter(value: string | null): HeroMediaFilter {
  if (value === 'movie' || value === 'tv') return value;
  return 'all';
}

function buildCacheHeaders(): HeadersInit {
  return {
    'Cache-Control': `public, max-age=${HERO_CACHE_SECONDS}, s-maxage=${HERO_CACHE_SECONDS}, stale-while-revalidate=60`,
    'CDN-Cache-Control': `public, s-maxage=${HERO_CACHE_SECONDS}, stale-while-revalidate=60`,
    'Vercel-CDN-Cache-Control': `public, s-maxage=${HERO_CACHE_SECONDS}, stale-while-revalidate=60`,
  };
}

function readHeroCache(key: string): TmdbHeroItem[] | null {
  const hit = tmdbHeroCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    tmdbHeroCache.delete(key);
    return null;
  }
  return hit.results;
}

function writeHeroCache(key: string, results: TmdbHeroItem[]): void {
  tmdbHeroCache.set(key, {
    results,
    expiresAt: Date.now() + HERO_CACHE_SECONDS * 1000,
  });

  if (tmdbHeroCache.size <= HERO_CACHE_MAX_ENTRIES) return;
  const oldestKey = tmdbHeroCache.keys().next().value;
  if (oldestKey) {
    tmdbHeroCache.delete(oldestKey);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mediaFilter = normalizeMediaFilter(searchParams.get('mediaType'));
  const cacheKey = `hero:${mediaFilter}`;

  const apiKey =
    process.env.TMDB_API_KEY ||
    process.env.NEXT_PUBLIC_TMDB_API_KEY ||
    DEFAULT_TMDB_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ results: [] }, { status: 200 });
  }

  const cacheHit = readHeroCache(cacheKey);
  if (cacheHit) {
    return NextResponse.json(
      { results: cacheHit },
      {
        headers: buildCacheHeaders(),
      }
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      language: 'zh-CN',
      page: '1',
    });

    const response = await fetch(
      `${TMDB_API_BASE_URL}/trending/all/day?${params.toString()}`,
      {
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      return NextResponse.json({ results: [] }, { status: 200 });
    }

    const data = (await response.json()) as TmdbTrendingResponse;
    const baseResults = (data.results || [])
      .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
      .filter(
        (item) =>
          mediaFilter === 'all' ||
          item.media_type === mediaFilter
      )
      .map(mapHeroItem)
      .filter((item): item is TmdbHeroItem => Boolean(item))
      .slice(0, 8);

    const results = await Promise.all(
      baseResults.map(async (item) => {
        const [logo, meta] = await Promise.all([
          fetchLogoForItem(item.mediaType, item.id, apiKey, controller.signal),
          fetchHeroMetaForItem(item.mediaType, item.id, apiKey, controller.signal),
        ]);
        return {
          ...item,
          runtime: meta.runtime,
          seasons: meta.seasons,
          episodes: meta.episodes,
          logo: logo || undefined,
        };
      })
    );

    writeHeroCache(cacheKey, results);

    return NextResponse.json(
      { results },
      {
        headers: buildCacheHeaders(),
      }
    );
  } catch {
    return NextResponse.json({ results: [] }, { status: 200 });
  } finally {
    clearTimeout(timeoutId);
  }
}
