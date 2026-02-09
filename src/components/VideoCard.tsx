/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  CalendarDays,
  CheckCircle,
  Clock3,
  Globe2,
  Heart,
  Info,
  Link,
  Loader2,
  Play,
  Star,
  Users,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';

interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: string;
  onDelete?: () => void;
  rate?: string;
  items?: SearchResult[];
  type?: string;
}

type TmdbMediaType = 'movie' | 'tv';

interface TmdbDetailCastItem {
  id: number;
  name: string;
  character: string;
}

interface TmdbCardDetail {
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
  cast: TmdbDetailCastItem[];
  trailerUrl: string;
}

interface TmdbDetailRawGenre {
  name?: string;
}

interface TmdbDetailRawCast {
  id?: number;
  name?: string;
  character?: string;
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

interface TmdbSearchResultItem {
  id?: number;
  media_type?: string;
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

const TMDB_CLIENT_API_KEY =
  process.env.NEXT_PUBLIC_TMDB_API_KEY || '45bf9a17a758ffdaf0193182c8f42625';
const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

function normalizeYear(value?: string): string {
  const year = (value || '').trim();
  return /^\d{4}$/.test(year) ? year : '';
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

function normalizeMediaType(value?: string, episodes?: number): TmdbMediaType {
  if (value === 'tv' || value === 'show') return 'tv';
  if (value === 'movie') return 'movie';
  if (typeof episodes === 'number' && episodes > 1) return 'tv';
  return 'movie';
}

function formatRuntime(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
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
    const officialDelta = Number(Boolean(b.official)) - Number(Boolean(a.official));
    if (officialDelta !== 0) return officialDelta;
    return getLangPriority(b.iso_639_1) - getLangPriority(a.iso_639_1);
  });

  const key = sorted[0]?.key;
  return key ? `https://www.youtube.com/watch?v=${key}` : '';
}

async function resolveTmdbTargetFromTitle(
  title: string,
  year: string,
  mediaType: TmdbMediaType
): Promise<{ id: number; mediaType: TmdbMediaType } | null> {
  if (!TMDB_CLIENT_API_KEY) return null;

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
      api_key: TMDB_CLIENT_API_KEY,
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
        { cache: 'no-store' }
      );
      if (!response.ok) continue;

      const payload = (await response.json()) as {
        results?: TmdbSearchResultItem[];
      };
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

async function fetchTmdbLogo(
  mediaType: TmdbMediaType,
  id: number
): Promise<string> {
  if (!TMDB_CLIENT_API_KEY) return '';

  try {
    const params = new URLSearchParams({
      api_key: TMDB_CLIENT_API_KEY,
      include_image_language: 'zh,en,null',
    });
    const response = await fetch(
      `${TMDB_API_BASE_URL}/${mediaType}/${id}/images?${params.toString()}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return '';

    const data = (await response.json()) as TmdbImagesResponse;
    const logoPath = selectBestLogoPath(data.logos || []);
    return logoPath ? `${TMDB_IMAGE_BASE_URL}/w500${logoPath}` : '';
  } catch {
    return '';
  }
}

async function fetchTmdbDetailByTitle(input: {
  title: string;
  year: string;
  mediaType: TmdbMediaType;
  poster?: string;
  score?: string;
}): Promise<TmdbCardDetail> {
  const resolved = await resolveTmdbTargetFromTitle(
    input.title,
    input.year,
    input.mediaType
  );
  if (!resolved) {
    throw new Error('TMDB detail request failed: 404');
  }

  const appendToResponse =
    resolved.mediaType === 'movie'
      ? 'credits,videos,release_dates'
      : 'credits,videos,content_ratings';

  const params = new URLSearchParams({
    api_key: TMDB_CLIENT_API_KEY,
    language: 'zh-CN',
    append_to_response: appendToResponse,
  });

  const [response, logo] = await Promise.all([
    fetch(
      `${TMDB_API_BASE_URL}/${resolved.mediaType}/${resolved.id}?${params.toString()}`,
      { cache: 'no-store' }
    ),
    fetchTmdbLogo(resolved.mediaType, resolved.id),
  ]);

  if (!response.ok) {
    throw new Error(`TMDB detail request failed: ${response.status}`);
  }

  const raw = (await response.json()) as TmdbDetailRawResponse;

  const cast = (raw.credits?.cast || [])
    .slice(0, 8)
    .map((member) => ({
      id: member.id ?? 0,
      name: member.name || '',
      character: member.character || '',
    }))
    .filter((member) => member.id > 0 && member.name);

  const contentRating =
    resolved.mediaType === 'movie'
      ? pickMovieContentRatingFromRaw(raw)
      : pickTvContentRatingFromRaw(raw);

  const runtime =
    resolved.mediaType === 'movie'
      ? (raw.runtime ?? null)
      : (raw.episode_run_time?.[0] ?? null);

  return {
    id: raw.id || resolved.id,
    mediaType: resolved.mediaType,
    title: (raw.title || raw.name || input.title || '').trim(),
    logo: logo || undefined,
    overview: (raw.overview || '').trim() || 'No overview available.',
    backdrop: toImageUrl(raw.backdrop_path, 'original'),
    poster: toImageUrl(raw.poster_path, 'w500') || input.poster || '',
    score: toScore(raw.vote_average) || input.score || '',
    voteCount: raw.vote_count || 0,
    year: toYear(raw.release_date || raw.first_air_date) || input.year,
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

export default function VideoCard({
  id,
  title = '',
  query = '',
  poster = '',
  episodes,
  source,
  source_name,
  progress = 0,
  year,
  from,
  currentEpisode,
  douban_id,
  onDelete,
  rate,
  items,
  type = '',
}: VideoCardProps) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<TmdbCardDetail | null>(null);
  const detailCacheRef = useRef<Record<string, TmdbCardDetail>>({});
  const detailRequestIdRef = useRef(0);
  const suppressCardClickUntilRef = useRef(0);

  const isAggregate = from === 'search' && !!items?.length;

  const aggregateData = useMemo(() => {
    if (!isAggregate || !items) return null;
    const countMap = new Map<string | number, number>();
    const episodeCountMap = new Map<number, number>();
    items.forEach((item) => {
      if (item.douban_id && item.douban_id !== 0) {
        countMap.set(item.douban_id, (countMap.get(item.douban_id) || 0) + 1);
      }
      const len = item.episodes?.length || 0;
      if (len > 0) {
        episodeCountMap.set(len, (episodeCountMap.get(len) || 0) + 1);
      }
    });

    const getMostFrequent = <T extends string | number>(
      map: Map<T, number>
    ) => {
      let maxCount = 0;
      let result: T | undefined;
      map.forEach((cnt, key) => {
        if (cnt > maxCount) {
          maxCount = cnt;
          result = key;
        }
      });
      return result;
    };

    return {
      first: items[0],
      mostFrequentDoubanId: getMostFrequent(countMap),
      mostFrequentEpisodes: getMostFrequent(episodeCountMap) || 0,
    };
  }, [isAggregate, items]);

  const actualTitle = aggregateData?.first.title ?? title;
  const actualPoster = aggregateData?.first.poster ?? poster;
  const actualSource = aggregateData?.first.source ?? source;
  const actualId = aggregateData?.first.id ?? id;
  const actualDoubanId = String(
    aggregateData?.mostFrequentDoubanId ?? douban_id
  );
  const hasDoubanId =
    Boolean(actualDoubanId) &&
    !['undefined', 'null', '0'].includes(actualDoubanId);
  const actualEpisodes = aggregateData?.mostFrequentEpisodes ?? episodes;
  const actualYear = aggregateData?.first.year ?? year;
  const actualQuery = query || '';
  const actualSearchType = isAggregate
    ? aggregateData?.first.episodes?.length === 1
      ? 'movie'
      : 'tv'
    : type;
  const tmdbTrigger = useMemo(
    () => ({
      title: (actualTitle || '').trim(),
      year: normalizeYear(actualYear),
      mediaType: normalizeMediaType(actualSearchType, actualEpisodes),
      poster: actualPoster,
      score: rate || '',
    }),
    [actualTitle, actualYear, actualSearchType, actualEpisodes, actualPoster, rate]
  );

  const safeImageUrl = useCallback((url: string): string => {
    try {
      return processImageUrl(url);
    } catch {
      return url;
    }
  }, []);

  // 鑾峰彇鏀惰棌鐘舵€?
  useEffect(() => {
    if (from === 'douban' || !actualSource || !actualId) return;

    const fetchFavoriteStatus = async () => {
      try {
        const fav = await isFavorited(actualSource, actualId);
        setFavorited(fav);
      } catch (err) {
        throw new Error('检查收藏状态失败');
      }
    };

    fetchFavoriteStatus();

    // 鐩戝惉鏀惰棌鐘舵€佹洿鏂颁簨浠?
    const storageKey = generateStorageKey(actualSource, actualId);
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        // 妫€鏌ュ綋鍓嶉」鐩槸鍚﹀湪鏂扮殑鏀惰棌鍒楄〃涓?
        const isNowFavorited = !!newFavorites[storageKey];
        setFavorited(isNowFavorited);
      }
    );

    return unsubscribe;
  }, [from, actualSource, actualId]);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from === 'douban' || !actualSource || !actualId) return;
      try {
        if (favorited) {
          // 濡傛灉宸叉敹钘忥紝鍒犻櫎鏀惰棌
          await deleteFavorite(actualSource, actualId);
          setFavorited(false);
        } else {
          // 濡傛灉鏈敹钘忥紝娣诲姞鏀惰棌
          await saveFavorite(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
            year: actualYear || '',
            cover: actualPoster,
            total_episodes: actualEpisodes ?? 1,
            save_time: Date.now(),
          });
          setFavorited(true);
        }
      } catch (err) {
        throw new Error('切换收藏状态失败');
      }
    },
    [
      from,
      actualSource,
      actualId,
      actualTitle,
      source_name,
      actualYear,
      actualPoster,
      actualEpisodes,
      favorited,
    ]
  );

  const handleDeleteRecord = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from !== 'playrecord' || !actualSource || !actualId) return;
      try {
        await deletePlayRecord(actualSource, actualId);
        onDelete?.();
      } catch (err) {
        throw new Error('鍒犻櫎鎾斁璁板綍澶辫触');
      }
    },
    [from, actualSource, actualId, onDelete]
  );

  const goToPlay = useCallback(() => {
    if (from === 'douban') {
      router.push(
        `/play?title=${encodeURIComponent(actualTitle.trim())}${
          actualYear ? `&year=${actualYear}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`
      );
    } else if (actualSource && actualId) {
      router.push(
        `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
          actualTitle
        )}${actualYear ? `&year=${actualYear}` : ''}${
          isAggregate ? '&prefer=true' : ''
        }${
          actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
        }${actualSearchType ? `&stype=${actualSearchType}` : ''}`
      );
    }
  }, [
    from,
    actualSource,
    actualId,
    router,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
  ]);

  const config = useMemo(() => {
    const configs = {
      playrecord: {
        showSourceName: true,
        showProgress: true,
        showHeart: true,
        showCheckCircle: true,
        showDoubanLink: false,
        showRating: false,
      },
      favorite: {
        showSourceName: true,
        showProgress: false,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: false,
        showRating: false,
      },
      search: {
        showSourceName: true,
        showProgress: false,
        showHeart: !isAggregate,
        showCheckCircle: false,
        showDoubanLink: hasDoubanId,
        showRating: false,
      },
      douban: {
        showSourceName: false,
        showProgress: false,
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: hasDoubanId,
        showRating: !!rate,
      },
    };
    return configs[from] || configs.search;
  }, [from, hasDoubanId, isAggregate, rate]);

  const handleCloseDetail = useCallback(() => {
    suppressCardClickUntilRef.current = Date.now() + 220;
    setDetailOpen(false);
    setDetailLoading(false);
    setDetailError(null);
    detailRequestIdRef.current += 1;
  }, []);

  const handleCardClick = useCallback(async () => {
    if (Date.now() < suppressCardClickUntilRef.current) return;
    if (detailOpen || detailLoading) return;
    if (!tmdbTrigger.title) {
      goToPlay();
      return;
    }

    const cacheKey = `${tmdbTrigger.mediaType}-${tmdbTrigger.title}-${tmdbTrigger.year}`;
    const cached = detailCacheRef.current[cacheKey];
    if (cached) {
      setDetailData(cached);
      setDetailError(null);
      setDetailOpen(true);
      return;
    }

    setDetailError(null);
    setDetailLoading(true);
    const requestId = ++detailRequestIdRef.current;

    try {
      const detail = await fetchTmdbDetailByTitle(tmdbTrigger);
      if (detailRequestIdRef.current !== requestId) return;
      detailCacheRef.current[cacheKey] = detail;
      setDetailData(detail);
      setDetailOpen(true);
    } catch {
      if (detailRequestIdRef.current !== requestId) return;
      goToPlay();
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setDetailLoading(false);
      }
    }
  }, [detailLoading, detailOpen, goToPlay, tmdbTrigger]);

  const handleRetryDetail = useCallback(async () => {
      if (!tmdbTrigger.title) return;

      const cacheKey = `${tmdbTrigger.mediaType}-${tmdbTrigger.title}-${tmdbTrigger.year}`;
      setDetailError(null);

      const cached = detailCacheRef.current[cacheKey];
      if (cached) {
        setDetailData(cached);
        setDetailLoading(false);
        return;
      }

      setDetailData(null);
      setDetailLoading(true);
      const requestId = ++detailRequestIdRef.current;

      try {
        const detail = await fetchTmdbDetailByTitle(tmdbTrigger);
        if (detailRequestIdRef.current !== requestId) return;
        detailCacheRef.current[cacheKey] = detail;
        setDetailData(detail);
      } catch (err) {
        if (detailRequestIdRef.current !== requestId) return;
        setDetailError((err as Error).message || 'TMDB detail load failed');
      } finally {
        if (detailRequestIdRef.current === requestId) {
          setDetailLoading(false);
        }
      }
    }, [tmdbTrigger]);

  useEffect(() => {
    if (!detailOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseDetail();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [detailOpen, handleCloseDetail]);

  return (
    <div
      className='group relative w-full rounded-lg bg-transparent cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.05] hover:z-[500]'
      onClick={() => {
        void handleCardClick();
      }}
    >
      {/* 娴锋姤瀹瑰櫒 */}
      <div className='relative aspect-[2/3] overflow-hidden rounded-lg'>
        {/* 楠ㄦ灦灞?*/}
        {!isLoading && <ImagePlaceholder aspectRatio='aspect-[2/3]' />}
        {/* 鍥剧墖 */}
        <Image
          src={processImageUrl(actualPoster)}
          alt={actualTitle}
          fill
          className='object-cover'
          referrerPolicy='no-referrer'
          onLoadingComplete={() => setIsLoading(true)}
        />

        {/* 鎮诞閬僵 */}
        <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-100' />

        {(config.showHeart || config.showCheckCircle) && (
          <div className='absolute bottom-3 right-3 flex gap-3 opacity-0 translate-y-2 transition-all duration-300 ease-in-out group-hover:opacity-100 group-hover:translate-y-0'>
            {config.showCheckCircle && (
              <CheckCircle
                onClick={handleDeleteRecord}
                size={20}
                className='text-white transition-all duration-300 ease-out hover:stroke-green-500 hover:scale-[1.1]'
              />
            )}
            {config.showHeart && (
              <Heart
                onClick={handleToggleFavorite}
                size={20}
                className={`transition-all duration-300 ease-out ${
                  favorited
                    ? 'fill-red-600 stroke-red-600'
                    : 'fill-transparent stroke-white hover:stroke-red-400'
                } hover:scale-[1.1]`}
              />
            )}
          </div>
        )}

        {/* 徽章 */}
        {config.showRating &&
          rate &&
          (hasDoubanId ? (
            <a
              href={`https://movie.douban.com/subject/${actualDoubanId}`}
              target='_blank'
              rel='noopener noreferrer'
              onClick={(e) => e.stopPropagation()}
              className='absolute top-2 left-2 bg-black/70 text-yellow-300 text-xs font-bold h-7 px-2.5 rounded-full flex items-center gap-1 shadow-md transition-transform duration-200 ease-out hover:scale-105'
            >
              <Star size={14} stroke='currentColor' fill='currentColor' />
              <span>{rate}</span>
            </a>
          ) : (
            <div className='absolute top-2 left-2 bg-black/70 text-yellow-300 text-xs font-bold h-7 px-2.5 rounded-full flex items-center gap-1 shadow-md'>
              <Star size={14} stroke='currentColor' fill='currentColor' />
              <span>{rate}</span>
            </div>
          ))}

        {actualEpisodes && actualEpisodes > 1 && (
          <div className='absolute top-2 right-2 bg-blue-500 text-white text-xs font-semibold px-2 py-1 rounded-md shadow-md opacity-0 -translate-y-1 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-110'>
            {currentEpisode
              ? `${currentEpisode}/${actualEpisodes}`
              : actualEpisodes}
          </div>
        )}

        {/* 豆瓣链接 */}
        {!config.showRating && config.showDoubanLink && hasDoubanId && (
          <a
            href={`https://movie.douban.com/subject/${actualDoubanId}`}
            target='_blank'
            rel='noopener noreferrer'
            onClick={(e) => e.stopPropagation()}
            className='absolute top-2 left-2 opacity-0 -translate-x-2 transition-all duration-300 ease-in-out delay-100 group-hover:opacity-100 group-hover:translate-x-0'
          >
            <div className='bg-yellow-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-yellow-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
              <Link size={16} />
            </div>
          </a>
        )}
      </div>

      {config.showProgress && progress !== undefined && (
        <div className='mt-1 h-1 w-full bg-gray-200 rounded-full overflow-hidden'>
          <div
            className='h-full bg-blue-500 transition-all duration-500 ease-out'
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* 鏍囬涓庢潵婧?*/}
      <div className='mt-2 text-center'>
        <div className='relative'>
          <span className='block text-sm font-semibold truncate text-gray-900 dark:text-gray-100 transition-colors duration-300 ease-in-out group-hover:text-blue-600 dark:group-hover:text-blue-400 peer'>
            {actualTitle}
          </span>
          {/* 鑷畾涔?tooltip */}
          <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap pointer-events-none'>
            {actualTitle}
            <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
          </div>
        </div>
        {config.showSourceName && source_name && (
          <span className='block text-xs text-gray-500 dark:text-gray-400 mt-1'>
            <span className='inline-block border rounded px-2 py-0.5 border-gray-500/60 dark:border-gray-400/60 transition-all duration-300 ease-in-out group-hover:border-blue-500/60 group-hover:text-blue-600 dark:group-hover:text-blue-400 blur-[3px] opacity-70 group-hover:blur-0 group-hover:opacity-100'>
              {source_name}
            </span>
          </span>
        )}
      </div>

      {detailOpen && typeof document !== 'undefined' ? createPortal(
        <div
          className='fixed inset-0 z-[850] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm'
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            handleCloseDetail();
          }}
        >
          <div
            className='relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/20 bg-slate-950 text-white shadow-2xl'
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type='button'
              onClick={(event) => {
                event.stopPropagation();
                handleCloseDetail();
              }}
              className='absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white/80 transition-colors hover:text-white'
              aria-label='Close detail dialog'
            >
              <X size={18} />
            </button>

            <div className='absolute inset-0'>
              {detailData?.backdrop ? (
                <Image
                  src={safeImageUrl(detailData.backdrop)}
                  alt={detailData.title}
                  fill
                  className='object-cover opacity-30'
                />
              ) : null}
              <div className='absolute inset-0 bg-gradient-to-b from-black/20 via-slate-950/85 to-slate-950' />
            </div>

            <div className='relative max-h-[85vh] overflow-y-auto p-4 sm:p-6'>
              {detailLoading ? (
                <div className='flex min-h-[320px] flex-col items-center justify-center gap-3 text-white/80'>
                  <Loader2 className='h-7 w-7 animate-spin' />
                  <p className='text-sm'>正在加载详情...</p>
                </div>
              ) : null}

              {!detailLoading && detailError ? (
                <div className='flex min-h-[320px] flex-col items-center justify-center gap-3 text-center'>
                  <p className='text-base font-medium text-white'>详情加载失败</p>
                  <p className='text-sm text-white/70'>{detailError}</p>
                  <button
                    type='button'
                    onClick={() => {
                      void handleRetryDetail();
                    }}
                    className='mt-2 rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20'
                  >
                    重试
                  </button>
                </div>
              ) : null}

              {!detailLoading && !detailError && detailData ? (
                <div className='grid gap-6 md:grid-cols-[220px,1fr]'>
                  <div className='mx-auto w-40 md:mx-0 md:w-full'>
                    <div className='relative aspect-[2/3] overflow-hidden rounded-lg border border-white/20 shadow-xl'>
                      {detailData.poster || detailData.backdrop ? (
                        <Image
                          src={safeImageUrl(detailData.poster || detailData.backdrop)}
                          alt={detailData.title}
                          fill
                          className='object-cover'
                        />
                      ) : (
                        <div className='flex h-full w-full items-center justify-center bg-white/10 text-xs text-white/60'>
                          No Poster
                        </div>
                      )}
                    </div>
                    <p className='mt-2 truncate text-center text-xs text-white/60'>
                      {detailData.title}
                    </p>
                  </div>

                  <div className='space-y-4'>
                    {detailData.logo ? (
                      <div className='relative h-14 w-full max-w-[500px] sm:h-16'>
                        <Image
                          src={safeImageUrl(detailData.logo)}
                          alt={`${detailData.title} logo`}
                          fill
                          className='object-contain object-left drop-shadow-[0_8px_20px_rgba(0,0,0,0.55)]'
                        />
                      </div>
                    ) : (
                      <h3 className='text-2xl font-bold sm:text-3xl'>
                        {detailData.title}
                      </h3>
                    )}

                    <div className='flex flex-wrap items-center gap-3 text-sm text-white/90'>
                      {detailData.score ? (
                        <span className='inline-flex items-center gap-1'>
                          <Star
                            size={15}
                            className='text-yellow-400'
                            fill='currentColor'
                          />
                          <span className='font-semibold'>{detailData.score}</span>
                          {detailData.voteCount > 0 ? (
                            <span className='text-white/65'>
                              ({detailData.voteCount})
                            </span>
                          ) : null}
                        </span>
                      ) : null}

                      {detailData.year ? (
                        <span className='inline-flex items-center gap-1 text-white/80'>
                          <CalendarDays size={14} />
                          {detailData.year}
                        </span>
                      ) : null}

                      {detailData.runtime ? (
                        <span className='inline-flex items-center gap-1 text-white/80'>
                          <Clock3 size={14} />
                          {formatRuntime(detailData.runtime)}
                        </span>
                      ) : null}

                      {detailData.mediaType === 'tv' &&
                      detailData.seasons &&
                      detailData.episodes ? (
                        <span className='inline-flex items-center gap-1 text-white/80'>
                          <Users size={14} />
                          {detailData.seasons} Seasons / {detailData.episodes} Episodes
                        </span>
                      ) : null}

                      {detailData.contentRating ? (
                        <span className='rounded border border-white/35 px-1.5 py-0.5 text-[11px] font-medium text-white/95'>
                          {detailData.contentRating}
                        </span>
                      ) : null}
                    </div>

                    {detailData.genres.length > 0 ? (
                      <div className='flex flex-wrap gap-2'>
                        {detailData.genres.map((genre) => (
                          <span
                            key={genre}
                            className='rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-xs text-white/90'
                          >
                            {genre}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <p className='text-sm leading-6 text-white/85 sm:text-base'>
                      {detailData.overview}
                    </p>

                    <div className='flex flex-wrap items-center gap-4 text-xs text-white/70 sm:text-sm'>
                      {detailData.language ? (
                        <span className='inline-flex items-center gap-1'>
                          <Globe2 size={14} />
                          {detailData.language}
                        </span>
                      ) : null}
                      {typeof detailData.popularity === 'number' ? (
                        <span>Popularity: {detailData.popularity}</span>
                      ) : null}
                    </div>

                    {detailData.cast.length > 0 ? (
                      <div className='space-y-2'>
                        <p className='text-sm font-semibold text-white/90'>主演</p>
                        <div className='flex flex-wrap gap-2'>
                          {detailData.cast.map((person) => (
                            <span
                              key={`${person.id}-${person.name}`}
                              className='rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-xs text-white/90'
                            >
                              {person.name}
                              {person.character ? ` · ${person.character}` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className='flex flex-wrap gap-3 pt-1'>
                      <button
                        type='button'
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCloseDetail();
                          goToPlay();
                        }}
                        className='inline-flex items-center gap-2 rounded-lg border border-white/70 bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white/90'
                      >
                        <Play size={14} />
                        立即播放
                      </button>

                      {detailData.trailerUrl ? (
                        <a
                          href={detailData.trailerUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          onClick={(event) => event.stopPropagation()}
                          className='inline-flex items-center gap-2 rounded-lg border border-white/35 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20'
                        >
                          <Info size={14} />
                          预告片
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

