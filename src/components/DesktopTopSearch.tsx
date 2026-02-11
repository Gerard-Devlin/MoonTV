'use client';

import { Search, Star, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import TmdbDetailModal, {
  type TmdbDetailModalData,
  type TmdbDetailMediaType,
} from '@/components/TmdbDetailModal';

const SEARCH_DEBOUNCE_MS = 220;

interface SearchPayload {
  results?: SearchResult[];
}

interface TmdbTopSearchDetail extends TmdbDetailModalData {
  logo?: string;
}

function getMediaLabel(item: SearchResult): string {
  if (item.type_name === 'tv') return '剧集';
  return '电影';
}

function getMediaType(item: SearchResult): TmdbDetailMediaType {
  if (item.type_name === 'tv') return 'tv';
  return 'movie';
}

function normalizeYear(value?: string): string {
  const year = (value || '').trim();
  return /^\d{4}$/.test(year) ? year : '';
}

function renderHighlightedText(text: string, keyword: string): JSX.Element {
  const target = text || '';
  const query = keyword.trim();
  if (!query) return <>{target}</>;

  const lowerTarget = target.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const firstMatch = lowerTarget.indexOf(lowerQuery);
  if (firstMatch < 0) return <>{target}</>;

  const before = target.slice(0, firstMatch);
  const hit = target.slice(firstMatch, firstMatch + query.length);
  const after = target.slice(firstMatch + query.length);

  return (
    <>
      {before}
      <mark className='rounded bg-white/25 px-0.5 text-white'>{hit}</mark>
      {after}
    </>
  );
}

export default function DesktopTopSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const detailRequestIdRef = useRef(0);
  const detailCacheRef = useRef<Record<string, TmdbTopSearchDetail>>({});
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeResult, setActiveResult] = useState<SearchResult | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<TmdbTopSearchDetail | null>(null);

  const trimmedQuery = query.trim();
  const shouldShowDropdown =
    open && trimmedQuery.length > 0 && (isLoading || hasSearched);

  useEffect(() => {
    if (!trimmedQuery) {
      setResults([]);
      setHasSearched(false);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setHasSearched(true);
      try {
        const response = await fetch(
          `/api/tmdb/search?q=${encodeURIComponent(trimmedQuery)}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          setResults([]);
          return;
        }
        const payload = (await response.json()) as SearchPayload;
        setResults(Array.isArray(payload.results) ? payload.results : []);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmedQuery]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (!detailOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailOpen(false);
        setDetailLoading(false);
        setDetailError(null);
        detailRequestIdRef.current += 1;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [detailOpen]);

  const goSearchPage = (keyword: string) => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    setOpen(false);
  };

  const loadDetailForResult = useCallback(async (result: SearchResult) => {
    const mediaType = getMediaType(result);
    const year = normalizeYear(result.year);
    const cacheKey = `${mediaType}-${result.title.trim()}-${year}`;
    const cached = detailCacheRef.current[cacheKey];
    if (cached) {
      setDetailData(cached);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    const params = new URLSearchParams({
      title: result.title,
      type: mediaType,
    });
    if (year) params.set('year', year);
    if (result.poster) params.set('poster', result.poster);

    const requestId = ++detailRequestIdRef.current;
    setDetailLoading(true);
    setDetailError(null);
    setDetailData(null);

    try {
      const response = await fetch(`/api/tmdb/detail?${params.toString()}`);
      if (!response.ok) {
        throw new Error('TMDB detail request failed');
      }
      const payload = (await response.json()) as TmdbTopSearchDetail;
      if (detailRequestIdRef.current !== requestId) return;
      detailCacheRef.current[cacheKey] = payload;
      setDetailData(payload);
    } catch {
      if (detailRequestIdRef.current !== requestId) return;
      setDetailError('详情加载失败，请重试');
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setDetailLoading(false);
      }
    }
  }, []);

  const handleOpenDetail = useCallback(
    (result: SearchResult) => {
      setActiveResult(result);
      setOpen(false);
      setDetailOpen(true);
      void loadDetailForResult(result);
    },
    [loadDetailForResult]
  );

  const handleRetryDetail = useCallback(() => {
    if (!activeResult) return;
    void loadDetailForResult(activeResult);
  }, [activeResult, loadDetailForResult]);

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailLoading(false);
    setDetailError(null);
    detailRequestIdRef.current += 1;
  }, []);

  const handlePlayFromDetail = useCallback(() => {
    const title = (detailData?.title || activeResult?.title || '').trim();
    if (!title) return;
    const mediaType = detailData?.mediaType || (activeResult ? getMediaType(activeResult) : 'movie');
    const year = normalizeYear(detailData?.year || activeResult?.year);
    router.push(
      `/play?title=${encodeURIComponent(title)}${year ? `&year=${year}` : ''}&stype=${mediaType}`
    );
    handleCloseDetail();
  }, [activeResult, detailData, handleCloseDetail, router]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    goSearchPage(trimmedQuery);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const handleClearQuery = () => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className='relative'>
      <form
        onSubmit={handleSubmit}
        className='flex h-10 w-[min(52vw,560px)] max-w-[calc(100vw-10rem)] items-center rounded-full border border-zinc-700/80 bg-black/55 px-3 text-sm text-gray-200 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl focus-within:border-zinc-700/80'
      >
        <Search className='h-4 w-4 shrink-0 text-gray-400' />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleInputKeyDown}
          placeholder='搜索电影、剧集、人物...'
          className='h-full w-full appearance-none border-0 bg-transparent px-2 text-sm text-gray-100 placeholder:text-gray-400 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0'
        />
        {trimmedQuery ? (
          <button
            type='button'
            onClick={handleClearQuery}
            aria-label='clear search'
            className='inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-200'
          >
            <X className='h-4 w-4' />
          </button>
        ) : null}
      </form>

      {shouldShowDropdown && (
        <div className='absolute right-0 z-40 mt-2 w-full overflow-hidden rounded-3xl border border-zinc-700/80 bg-black/55 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl'>
          <div className='max-h-[420px] overflow-y-auto'>
            {isLoading ? (
              <div className='space-y-2 px-3 py-2'>
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`desktop-top-search-skeleton-${index}`}
                    className='flex items-center gap-3 px-1 py-1'
                  >
                    <div className='h-14 w-10 shrink-0 animate-pulse rounded bg-zinc-800' />
                    <div className='min-w-0 flex-1 space-y-2'>
                      <div className='h-4 w-2/3 animate-pulse rounded bg-zinc-800' />
                      <div className='h-3 w-1/2 animate-pulse rounded bg-zinc-800' />
                    </div>
                  </div>
                ))}
              </div>
            ) : results.length > 0 ? (
              <>
                {results.map((item, index) => {
                  const year = item.year && item.year !== 'unknown' ? item.year : '';
                  const score = item.score && item.score.trim() ? item.score.trim() : '--';
                  return (
                    <button
                      key={`${item.source}-${item.id}-${index}`}
                      type='button'
                      onClick={() => handleOpenDetail(item)}
                      className='flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-white/20 first:pt-2.5 first:rounded-t-3xl last:pb-2.5 last:rounded-b-3xl'
                    >
                      <img
                        src={processImageUrl(item.poster)}
                        alt={item.title}
                        className='h-14 w-10 shrink-0 rounded object-cover ring-1 ring-white/10'
                        loading='lazy'
                        decoding='async'
                        referrerPolicy='no-referrer'
                      />
                      <div className='min-w-0'>
                        <p className='truncate text-base font-medium text-gray-100'>
                          {renderHighlightedText(item.title, trimmedQuery)}
                        </p>
                        <div className='flex items-center gap-1 text-sm text-gray-400'>
                          <span className='truncate'>{getMediaLabel(item)}</span>
                          <span className='text-gray-500'>·</span>
                          <Star
                            className='h-3.5 w-3.5 shrink-0 text-yellow-400'
                            fill='currentColor'
                          />
                          <span className='truncate'>{score}</span>
                          <span className='text-gray-500'>·</span>
                          <span className='truncate'>{year || '未知'}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </>
            ) : (
              <div className='px-4 py-3 text-sm text-gray-500'>无匹配结果</div>
            )}
          </div>
        </div>
      )}

      <TmdbDetailModal
        open={detailOpen}
        loading={detailLoading}
        error={detailError}
        detail={detailData}
        titleLogo={detailData?.logo}
        onClose={handleCloseDetail}
        onRetry={handleRetryDetail}
        onPlay={handlePlayFromDetail}
      />
    </div>
  );
}
