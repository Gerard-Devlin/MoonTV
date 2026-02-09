'use client';

import { CalendarDays, Info, Play, Star } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  type TouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { processImageUrl } from '@/lib/utils';

interface TmdbHeroItem {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  overview: string;
  year: string;
  score: string;
  backdrop: string;
  poster: string;
  logo?: string;
}

interface TmdbHeroResponse {
  results?: TmdbHeroItem[];
}

interface TmdbRawItem {
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

interface TmdbRawResponse {
  results?: TmdbRawItem[];
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
const HERO_ITEM_LIMIT = 7;
const SWIPE_THRESHOLD_PX = 48;

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

function mapRawItemToHero(item: TmdbRawItem): TmdbHeroItem | null {
  const mediaType = item.media_type === 'tv' ? 'tv' : item.media_type === 'movie' ? 'movie' : null;
  const title = (item.title || item.name || '').trim();
  const backdropPath = item.backdrop_path || '';
  const posterPath = item.poster_path || '';

  if (!mediaType || !title || !backdropPath || !posterPath) return null;

  return {
    id: item.id,
    mediaType,
    title,
    overview: (item.overview || '').trim() || 'No overview available.',
    year: toYear(item.release_date || item.first_air_date),
    score: toScore(item.vote_average),
    backdrop: `${TMDB_IMAGE_BASE_URL}/original${backdropPath}`,
    poster: `${TMDB_IMAGE_BASE_URL}/w500${posterPath}`,
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

function buildResolveUrl(item: TmdbHeroItem): string {
  const params = new URLSearchParams({
    title: item.title,
    type: item.mediaType,
  });
  if (item.year) {
    params.set('year', item.year);
  }
  return `/api/douban/resolve?${params.toString()}`;
}

function buildPlayUrl(item: TmdbHeroItem): string {
  const params = new URLSearchParams({
    title: item.title,
    stype: item.mediaType,
  });
  if (item.year) {
    params.set('year', item.year);
  }
  return `/play?${params.toString()}`;
}

export default function TmdbHeroBanner() {
  const router = useRouter();
  const [items, setItems] = useState<TmdbHeroItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const fullWidthSectionClass = 'relative mb-8 -mx-2 sm:-mx-10';

  const goToNext = useCallback(() => {
    if (items.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % items.length);
  }, [items.length]);

  const goToPrev = useCallback(() => {
    if (items.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
  }, [items.length]);

  const handleHeroTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const clearTouchState = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  const handleHeroTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start || items.length <= 1) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX < SWIPE_THRESHOLD_PX || absX <= absY) return;

      if (deltaX < 0) {
        goToNext();
      } else {
        goToPrev();
      }
    },
    [goToNext, goToPrev, items.length]
  );

  const fetchLogoForItem = useCallback(
    async (
      mediaType: 'movie' | 'tv',
      id: number,
      signal?: AbortSignal
    ): Promise<string> => {
      try {
        if (!TMDB_CLIENT_API_KEY) return '';
        const params = new URLSearchParams({
          api_key: TMDB_CLIENT_API_KEY,
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
    },
    []
  );

  const fetchDirectFromTmdb = useCallback(async (signal?: AbortSignal) => {
    if (!TMDB_CLIENT_API_KEY) return [];

    const params = new URLSearchParams({
      api_key: TMDB_CLIENT_API_KEY,
      language: 'zh-CN',
      page: '1',
    });

    const response = await fetch(
      `${TMDB_API_BASE_URL}/trending/all/day?${params.toString()}`,
      {
        signal,
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as TmdbRawResponse;
    const baseItems = (data.results || [])
      .map(mapRawItemToHero)
      .filter((item): item is TmdbHeroItem => Boolean(item))
      .slice(0, HERO_ITEM_LIMIT);

    const itemsWithLogo = await Promise.all(
      baseItems.map(async (item) => {
        const logo = await fetchLogoForItem(item.mediaType, item.id, signal);
        return {
          ...item,
          logo: logo || undefined,
        };
      })
    );
    const logoOnlyItems = itemsWithLogo.filter((item) => Boolean(item.logo));
    return logoOnlyItems.length > 0 ? logoOnlyItems : itemsWithLogo;
  }, [fetchLogoForItem]);

  const safeImageUrl = useCallback((url: string): string => {
    try {
      return processImageUrl(url);
    } catch {
      return url;
    }
  }, []);

  const fetchHeroData = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/tmdb/hero?ts=${Date.now()}`, {
        signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        const directItems = await fetchDirectFromTmdb(signal);
        const limitedItems = directItems.slice(0, HERO_ITEM_LIMIT);
        setItems(limitedItems);
        setError(
          limitedItems.length > 0
            ? null
            : `TMDB request failed: ${response.status}`
        );
        return;
      }
      const data = (await response.json()) as TmdbHeroResponse;
      let nextItems = data.results || [];
      if (nextItems.length === 0) {
        nextItems = await fetchDirectFromTmdb(signal);
      }
      const logoOnlyItems = nextItems.filter((item) => Boolean(item.logo));
      const finalItems = logoOnlyItems.length > 0 ? logoOnlyItems : nextItems;
      const limitedItems = finalItems.slice(0, HERO_ITEM_LIMIT);
      setItems(limitedItems);
      if (limitedItems.length === 0) {
        setError('TMDB returned empty results');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return;
      }
      try {
        const directItems = await fetchDirectFromTmdb(signal);
        const limitedItems = directItems.slice(0, HERO_ITEM_LIMIT);
        setItems(limitedItems);
        setError(
          limitedItems.length > 0
            ? null
            : (err as Error).message || 'TMDB fetch failed'
        );
      } catch {
        setItems([]);
        setError((err as Error).message || 'TMDB fetch failed');
      }
    } finally {
      setLoading(false);
    }
  }, [fetchDirectFromTmdb]);

  useEffect(() => {
    const controller = new AbortController();
    fetchHeroData(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchHeroData]);

  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => {
      goToNext();
    }, 7000);
    return () => clearInterval(timer);
  }, [goToNext, items.length]);

  useEffect(() => {
    if (activeIndex >= items.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, items.length]);

  const activeItem = useMemo(() => items[activeIndex], [items, activeIndex]);

  if (loading) {
    return (
      <section className={fullWidthSectionClass}>
        <div className='h-[78vh] w-full bg-gray-200 animate-pulse dark:bg-gray-800 md:h-screen' />
      </section>
    );
  }

  if (!activeItem) {
    return (
      <section className={fullWidthSectionClass}>
        <div className='relative min-h-[320px] overflow-hidden bg-slate-900 px-6 py-8 text-white sm:min-h-[420px] sm:px-12 sm:py-10'>
          <div className='absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(14,165,233,0.18),transparent_45%)]' />
          <div className='relative z-10 max-w-2xl space-y-3'>
            <h2 className='text-2xl font-bold sm:text-3xl'>TMDB Hero Unavailable</h2>
            <p className='text-sm text-white/75 sm:text-base'>
              {error || 'No data available at the moment.'}
            </p>
            <button
              type='button'
              onClick={() => fetchHeroData()}
              className='inline-flex items-center rounded-full border border-white/25 bg-black/30 px-4 py-2 text-sm font-semibold transition-colors hover:bg-black/50'
            >
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={fullWidthSectionClass}>
      <div
        className='relative h-[78vh] overflow-hidden bg-slate-950 text-white md:h-screen'
        onTouchStart={handleHeroTouchStart}
        onTouchEnd={handleHeroTouchEnd}
        onTouchCancel={clearTouchState}
        style={{ touchAction: 'pan-y' }}
      >
        <Image
          src={safeImageUrl(activeItem.backdrop)}
          alt={activeItem.title}
          fill
          priority
          className='object-cover object-center brightness-[0.32]'
        />
        <div className='absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent' />
        <div className='absolute inset-0 bg-gradient-to-r from-black/70 to-transparent' />

        <div className='absolute bottom-0 left-0 hidden w-full p-4 md:block md:w-3/4 md:translate-y-4 md:px-8 md:pt-8 md:pb-0 lg:w-1/2 lg:translate-y-6 lg:px-12 lg:pt-12 lg:pb-1'>
          <div className='space-y-4 rounded-lg p-2 md:p-3'>
            {activeItem.logo ? (
              <div className='relative h-16 w-full max-w-[560px] sm:h-20 md:h-24 lg:h-28'>
                <Image
                  src={safeImageUrl(activeItem.logo)}
                  alt={`${activeItem.title} logo`}
                  fill
                  className='object-contain object-left drop-shadow-[0_10px_26px_rgba(0,0,0,0.65)]'
                />
              </div>
            ) : (
              <h2 className='text-3xl font-extrabold leading-tight text-white sm:text-5xl md:text-6xl'>
                {activeItem.title}
              </h2>
            )}

            <div className='flex flex-wrap items-center gap-4 text-sm text-white/90'>
              {activeItem.score && (
                <span className='inline-flex items-center gap-1'>
                  <Star size={16} className='text-yellow-400' fill='currentColor' />
                  <span className='font-semibold'>{activeItem.score}</span>
                </span>
              )}
              {activeItem.year && (
                <span className='inline-flex items-center gap-1 text-white/80'>
                  <CalendarDays size={14} />
                  {activeItem.year}
                </span>
              )}
              <span className='rounded border border-white/30 px-1.5 py-0.5 text-[11px] font-medium uppercase text-white/90'>
                {activeItem.mediaType === 'movie' ? '电影' : '剧集'}
              </span>
            </div>

            <p className='max-w-xl text-sm leading-6 text-white/90 line-clamp-2 md:line-clamp-3 md:text-base'>
              {activeItem.overview}
            </p>

            <div className='flex flex-wrap items-center gap-3'>
              <button
                type='button'
                onClick={() => router.push(buildPlayUrl(activeItem))}
                className='inline-flex items-center gap-2 rounded-xl border border-white/35 bg-white/20 px-5 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-white/30 hover:shadow-xl'
              >
                <Play size={16} />
                播放
              </button>
              <a
                href={buildResolveUrl(activeItem)}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center gap-2 rounded-xl border border-white/35 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-white/20 hover:shadow-xl'
              >
                <Info size={16} />
                详情
              </a>
            </div>

            <div className='relative hidden lg:block pt-2'>
              <div
                className='grid gap-2 overflow-hidden pb-1'
                style={{
                  gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))`,
                }}
              >
                {items.map((item, index) => (
                  <button
                    key={`${item.mediaType}-${item.id}`}
                    type='button'
                    onClick={() => setActiveIndex(index)}
                    className='group flex min-w-0 flex-col items-center text-center'
                    aria-label={`Switch to ${item.title}`}
                  >
                    <div
                      className={`relative aspect-[2/3] w-full overflow-hidden rounded-lg border-2 transition-all duration-300 ${
                        index === activeIndex
                          ? 'border-sky-300'
                          : 'border-transparent group-hover:border-white/70'
                      }`}
                    >
                      <Image
                        src={safeImageUrl(item.poster)}
                        alt={item.title}
                        fill
                        className='object-cover transition-transform duration-300 group-hover:scale-105'
                      />
                    </div>
                    <span
                      className={`mt-2 line-clamp-2 text-[11px] font-medium text-white transition-opacity duration-300 ${
                        index === activeIndex
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {item.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className='absolute inset-x-0 bottom-0 z-10 px-4 pb-4 pt-20 md:hidden'>
          <div className='rounded-xl bg-black/35 p-3 backdrop-blur-sm'>
            <div className='flex gap-4'>
              <div className='relative aspect-[2/3] w-24 flex-shrink-0 overflow-hidden rounded-md border border-white/20'>
                <Image
                  src={safeImageUrl(activeItem.poster)}
                  alt={activeItem.title}
                  fill
                  className='object-cover'
                />
              </div>
              <div className='min-w-0 flex-1'>
                {activeItem.logo ? (
                  <div className='relative h-10 w-full max-w-[220px]'>
                    <Image
                      src={safeImageUrl(activeItem.logo)}
                      alt={`${activeItem.title} logo`}
                      fill
                      className='object-contain object-left'
                    />
                  </div>
                ) : (
                  <h3 className='line-clamp-2 text-lg font-bold text-white'>
                    {activeItem.title}
                  </h3>
                )}

                <div className='mt-2 flex items-center gap-2 text-xs text-white/90'>
                  {activeItem.score && (
                    <span className='inline-flex items-center gap-1'>
                      <Star
                        size={12}
                        className='text-yellow-400'
                        fill='currentColor'
                      />
                      <span className='font-medium'>{activeItem.score}</span>
                    </span>
                  )}
                  {activeItem.year && <span>{activeItem.year}</span>}
                  <span className='rounded border border-white/30 px-1 py-0.5 uppercase'>
                    {activeItem.mediaType === 'movie' ? '电影' : '剧集'}
                  </span>
                </div>

                <p className='mt-2 line-clamp-3 text-xs leading-relaxed text-white/90'>
                  {activeItem.overview}
                </p>
              </div>
            </div>

            <div className='mt-3 flex gap-3'>
              <button
                type='button'
                onClick={() => router.push(buildPlayUrl(activeItem))}
                className='inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/35 bg-white/20 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm'
              >
                <Play size={14} />
                播放
              </button>
              <a
                href={buildResolveUrl(activeItem)}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center justify-center gap-2 rounded-xl border border-white/35 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm'
              >
                <Info size={14} />
                详情
              </a>
            </div>

            <div className='mt-3 flex justify-center gap-2'>
              {items.map((item, index) => (
                <button
                  key={`mobile-dot-${item.id}`}
                  type='button'
                  onClick={() => setActiveIndex(index)}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    activeIndex === index
                      ? 'w-8 bg-white'
                      : 'w-2 bg-white/40 hover:bg-white/60'
                  }`}
                  aria-label={`Go to slide ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
