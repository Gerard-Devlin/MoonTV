/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { Search, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import {
  addSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';

import Loader from '@/components/Loader';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface SearchPersonResult {
  id: number;
  name: string;
  profile: string;
  popularity: number;
  department: string;
  known_for: string[];
}

const DEPARTMENT_LABELS: Record<string, string> = {
  Acting: '演员',
  Directing: '导演',
  Production: '制片',
  Writing: '编剧',
  Creator: '创作',
  Camera: '摄影',
  Editing: '剪辑',
  Sound: '声音',
  Art: '美术',
  'Costume & Make-Up': '服装化妆',
  'Visual Effects': '视觉特效',
};

function formatDepartment(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  return DEPARTMENT_LABELS[normalized] || normalized;
}

function getEpisodeCount(item: SearchResult): number {
  if (typeof item.total_episodes === 'number' && item.total_episodes > 0) {
    return item.total_episodes;
  }
  if (item.source === 'tmdb' && (item.type_name || '').trim().toLowerCase() === 'tv') {
    return 0;
  }
  return Array.isArray(item.episodes) ? item.episodes.length : 0;
}

function isTvResult(item: SearchResult): boolean {
  const normalizedType = (item.type_name || '').trim().toLowerCase();
  if (normalizedType === 'tv') return true;
  if (normalizedType === 'movie') return false;
  return getEpisodeCount(item) > 1;
}

function aggregateSearchResults(
  items: SearchResult[],
  query: string
): Array<[string, SearchResult[]]> {
  const map = new Map<string, SearchResult[]>();
  items.forEach((item) => {
    const key = `${item.title.replaceAll(' ', '')}-${item.year || 'unknown'}-${
      isTvResult(item) ? 'tv' : 'movie'
    }`;
    const arr = map.get(key) || [];
    arr.push(item);
    map.set(key, arr);
  });

  return Array.from(map.entries()).sort((a, b) => {
    const normalizedQuery = query.trim().replaceAll(' ', '');
    const aExactMatch = a[1][0].title
      .replaceAll(' ', '')
      .includes(normalizedQuery);
    const bExactMatch = b[1][0].title
      .replaceAll(' ', '')
      .includes(normalizedQuery);

    if (aExactMatch && !bExactMatch) return -1;
    if (!aExactMatch && bExactMatch) return 1;

    if (a[1][0].year === b[1][0].year) {
      return a[0].localeCompare(b[0]);
    }

    const aYear = a[1][0].year;
    const bYear = b[1][0].year;
    if (aYear === 'unknown' && bYear === 'unknown') return 0;
    if (aYear === 'unknown') return 1;
    if (bYear === 'unknown') return -1;
    return aYear > bYear ? -1 : 1;
  });
}

function SearchPageClient() {
  // 鎼滅储鍘嗗彶
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [personResults, setPersonResults] = useState<SearchPersonResult[]>([]);
  const [legacySearchResults, setLegacySearchResults] = useState<
    SearchResult[]
  >([]);

  // 鑾峰彇榛樿鑱氬悎璁剧疆锛氬彧璇诲彇鐢ㄦ埛鏈湴璁剧疆锛岄粯璁や负 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true; // 榛樿鍚敤鑱氬悎
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  const aggregatedResults = useMemo(
    () => aggregateSearchResults(searchResults, searchQuery),
    [searchResults, searchQuery]
  );

  const aggregatedLegacyResults = useMemo(
    () => aggregateSearchResults(legacySearchResults, searchQuery),
    [legacySearchResults, searchQuery]
  );

  useEffect(() => {
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();

    getSearchHistory().then(setSearchHistory);

    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const query = searchParams.get('q');
    if (query) {
      setSearchQuery(query);
      fetchSearchResults(query);
      addSearchHistory(query);
    } else {
      setShowResults(false);
      setPersonResults([]);
      setLegacySearchResults([]);
    }
  }, [searchParams]);

  const fetchSearchResults = async (query: string) => {
    try {
      setIsLoading(true);
      const trimmedQuery = query.trim();

      const [tmdbPayload, legacyPayload] = await Promise.all([
        fetch(`/api/tmdb/search?q=${encodeURIComponent(trimmedQuery)}`)
          .then(async (response) => {
            if (!response.ok) return { results: [], people: [] };
            return (await response.json()) as {
              results?: SearchResult[];
              people?: SearchPersonResult[];
            };
          })
          .catch(() => ({ results: [], people: [] })),
        fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`)
          .then(async (response) => {
            if (!response.ok) return { results: [] };
            return (await response.json()) as { results?: SearchResult[] };
          })
          .catch(() => ({ results: [] })),
      ]);

      let results = Array.isArray(tmdbPayload.results)
        ? tmdbPayload.results
        : [];
      const people = Array.isArray(tmdbPayload.people)
        ? tmdbPayload.people
        : [];
      const legacyResults = Array.isArray(legacyPayload.results)
        ? legacyPayload.results
        : [];
      if (
        typeof window !== 'undefined' &&
        !(window as any).RUNTIME_CONFIG?.DISABLE_YELLOW_FILTER
      ) {
        results = results.filter((result: SearchResult) => {
          const typeName = result.type_name || '';
          return !yellowWords.some((word: string) => typeName.includes(word));
        });
      }
      setSearchResults(
        results.sort((a: SearchResult, b: SearchResult) => {
          const aExactMatch = a.title === trimmedQuery;
          const bExactMatch = b.title === trimmedQuery;

          if (aExactMatch && !bExactMatch) return -1;
          if (!aExactMatch && bExactMatch) return 1;

          if (a.year === b.year) {
            return a.title.localeCompare(b.title);
          }

          if (a.year === 'unknown' && b.year === 'unknown') return 0;
          if (a.year === 'unknown') return 1;
          if (b.year === 'unknown') return -1;
          return parseInt(a.year) > parseInt(b.year) ? -1 : 1;
        })
      );
      setPersonResults(people);
      setLegacySearchResults(legacyResults);
      setShowResults(true);
    } catch (error) {
      setSearchResults([]);
      setPersonResults([]);
      setLegacySearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);

    router.push(`/search?q=${encodeURIComponent(trimmed)}`);

    fetchSearchResults(trimmed);

    addSearchHistory(trimmed);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setPersonResults([]);
    setLegacySearchResults([]);
    setShowResults(false);
    router.replace('/search');
    const input = document.getElementById(
      'searchInput'
    ) as HTMLInputElement | null;
    input?.focus();
  };

  return (
    <div className='min-h-screen w-full'>
      <div className='relative w-full'>
        <PageLayout activePath='/search'>
          <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
            <div className='mb-8'>
              <form onSubmit={handleSearch} className='mx-auto w-full max-w-[720px]'>
                <div className='relative'>
                  <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
                  <input
                    id='searchInput'
                    type='text'
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder='搜索电影、剧集、人物...'
                    className='h-12 w-full rounded-3xl border border-gray-200/50 bg-gray-50/80 py-3 pl-10 pr-12 text-sm text-gray-700 placeholder-gray-400 shadow-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700'
                  />
                  {searchQuery && (
                    <button
                      type='button'
                      onClick={clearSearch}
                      aria-label='清空搜索'
                      className='absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-gray-500 dark:hover:text-gray-300'
                    >
                      <X className='h-4 w-4' />
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
              {isLoading ? (
                <div className='flex justify-center items-center h-40'>
                  <Loader />
                </div>
              ) : showResults ? (
                <section className='mb-12'>
                  {personResults.length > 0 && (
                    <div className='mb-10'>
                      <h3 className='mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200'>
                        人物
                      </h3>
                      <div className='grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-4'>
                        {personResults.map((person) => (
                          <Link
                            key={`person-${person.id}`}
                            href={`/person/${person.id}`}
                            className='group overflow-hidden rounded-xl border border-gray-200/70 bg-white/70 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-gray-700/60 dark:bg-gray-800/70'
                          >
                            <div className='relative aspect-[2/3] w-full overflow-hidden bg-gray-200 dark:bg-gray-700'>
                              {person.profile ? (
                                <Image
                                  src={person.profile}
                                  alt={person.name}
                                  fill
                                  unoptimized
                                  className='object-cover transition-transform duration-300 group-hover:scale-105'
                                />
                              ) : (
                                <div className='flex h-full w-full items-center justify-center text-sm text-gray-500 dark:text-gray-400'>
                                  No profile
                                </div>
                              )}
                            </div>
                            <div className='space-y-1 p-3'>
                              <p className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
                                {person.name}
                              </p>
                              {person.department && (
                                <p className='truncate text-xs text-gray-500 dark:text-gray-400'>
                                  {formatDepartment(person.department)}
                                </p>
                              )}
                              {person.known_for.length > 0 && (
                                <p className='line-clamp-2 text-xs text-gray-600 dark:text-gray-300'>
                                  {person.known_for.join(' / ')}
                                </p>
                              )}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className='mb-8 flex items-center justify-between'>
                    <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                      搜索结果
                    </h2>
                    <label className='flex items-center gap-2 cursor-pointer select-none'>
                      <span className='text-sm text-gray-700 dark:text-gray-300'>
                        聚合
                      </span>
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={viewMode === 'agg'}
                          onChange={() =>
                            setViewMode(viewMode === 'agg' ? 'all' : 'agg')
                          }
                        />
                        <div className='w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-blue-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4'></div>
                      </div>
                    </label>
                  </div>
                  <div
                    key={`search-results-${viewMode}`}
                    className='justify-start grid grid-cols-2 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
                  >
                    {viewMode === 'agg'
                      ? aggregatedResults.map(([mapKey, group]) => {
                          return (
                            <div key={`agg-${mapKey}`} className='w-full'>
                              <VideoCard
                                from='search'
                                items={group}
                                query={
                                  searchQuery.trim() !== group[0].title
                                    ? searchQuery.trim()
                                    : ''
                                }
                              />
                            </div>
                          );
                        })
                      : searchResults.map((item) => (
                          <div
                            key={`all-${item.source}-${item.id}`}
                            className='w-full'
                          >
                            <VideoCard
                              id={item.id}
                              title={item.title + ' ' + item.type_name}
                              poster={item.poster}
                              episodes={getEpisodeCount(item)}
                              source={item.source}
                              source_name={item.source_name}
                              douban_id={item.douban_id?.toString()}
                              query={
                                searchQuery.trim() !== item.title
                                  ? searchQuery.trim()
                                  : ''
                              }
                              year={item.year}
                              from='search'
                              type={isTvResult(item) ? 'tv' : 'movie'}
                            />
                          </div>
                        ))}
                    {searchResults.length === 0 &&
                      legacySearchResults.length === 0 && (
                        <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                          {personResults.length > 0
                            ? 'No movie/tv results'
                            : 'No matching results'}
                        </div>
                      )}
                  </div>

                  {legacySearchResults.length > 0 && (
                    <div className='mt-12'>
                      <div className='mb-4 flex items-center justify-between'>
                        <h3 className='text-lg font-semibold text-gray-800 dark:text-gray-200'>
                          原搜索结果
                        </h3>
                        <span className='text-sm text-gray-500 dark:text-gray-400'>
                          {viewMode === 'agg'
                            ? aggregatedLegacyResults.length
                            : legacySearchResults.length}{' '}
                          条
                        </span>
                      </div>
                      <div className='justify-start grid grid-cols-2 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                        {viewMode === 'agg'
                          ? aggregatedLegacyResults.map(([mapKey, group]) => (
                              <div
                                key={`legacy-agg-${mapKey}`}
                                className='w-full'
                              >
                                <VideoCard
                                  from='search'
                                  items={group}
                                  query={
                                    searchQuery.trim() !== group[0].title
                                      ? searchQuery.trim()
                                      : ''
                                  }
                                />
                              </div>
                            ))
                          : legacySearchResults.map((item, index) => (
                              <div
                                key={`legacy-all-${item.source}-${item.id}-${index}`}
                                className='w-full'
                              >
                                <VideoCard
                                  id={item.id}
                                  title={
                                    item.type_name
                                      ? `${item.title} ${item.type_name}`
                                      : item.title
                                  }
                                  poster={item.poster}
                                  episodes={getEpisodeCount(item)}
                                  source={item.source}
                                  source_name={item.source_name}
                                  douban_id={item.douban_id?.toString()}
                                  query={
                                    searchQuery.trim() !== item.title
                                      ? searchQuery.trim()
                                      : ''
                                  }
                                  year={item.year}
                                  from='search'
                                  type={isTvResult(item) ? 'tv' : 'movie'}
                                />
                              </div>
                            ))}
                      </div>
                    </div>
                  )}
                </section>
              ) : searchHistory.length > 0 ? (
                <section className='mb-12'>
                  <h2 className='mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200'>
                    搜索历史
                    {/* {searchHistory.length > 0 && (
                  <button
                    onClick={() => {
                    className='ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500'
                  >
                  </button>
                )} */}
                  </h2>
                  <div className='flex flex-wrap gap-2'>
                    {searchHistory.map((item) => (
                      <div key={item} className='relative group'>
                        <button
                          onClick={() => {
                            setSearchQuery(item);
                            router.push(
                              `/search?q=${encodeURIComponent(item.trim())}`
                            );
                          }}
                          className='px-4 py-2 bg-gray-500/10 hover:bg-gray-300 rounded-full text-sm text-gray-700 transition-colors duration-200 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
                        >
                          {item}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </PageLayout>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
