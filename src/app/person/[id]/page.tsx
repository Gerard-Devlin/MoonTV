'use client';

import {
  Briefcase,
  Calendar,
  ChevronDown,
  MapPin,
  TrendingUp,
  User,
} from 'lucide-react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { SearchResult } from '@/lib/types';

import Loader from '@/components/Loader';
import PageLayout from '@/components/PageLayout';
import { AuroraBackground } from '@/components/ui/shadcn-io/aurora-background';
import VideoCard from '@/components/VideoCard';

export const runtime = 'edge';

interface PersonCredit {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  poster: string;
  year: string;
  releaseDate?: string;
  role: string;
  score: string;
  overview: string;
  popularity: number;
}

interface PersonDetail {
  id: number;
  name: string;
  profile: string;
  birthday: string;
  deathday: string;
  placeOfBirth: string;
  knownForDepartment: string;
  biography: string;
  popularity: number;
  homepage: string;
  imdbId: string;
  credits: PersonCredit[];
}

type CreditSortMode = 'popularity' | 'date';

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

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
}

function formatDepartment(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  return DEPARTMENT_LABELS[normalized] || normalized;
}

function toCreditTimestamp(releaseDate?: string, year?: string): number {
  const normalizedDate = (releaseDate || '').trim();
  if (normalizedDate) {
    const timestamp = Date.parse(normalizedDate);
    if (!Number.isNaN(timestamp)) return timestamp;
  }

  const normalizedYear = (year || '').trim();
  if (/^\d{4}$/.test(normalizedYear)) {
    return Date.UTC(Number(normalizedYear), 0, 1);
  }

  return 0;
}

function formatTimelineLabel(releaseDate?: string, year?: string): string {
  const normalizedDate = (releaseDate || '').trim();
  const yearFromDate = normalizedDate.slice(0, 4);
  if (/^\d{4}$/.test(yearFromDate)) return yearFromDate;

  const normalizedYear = (year || '').trim();
  if (/^\d{4}$/.test(normalizedYear)) return normalizedYear;

  return 'Unknown';
}

export default function PersonDetailPage() {
  const params = useParams<{ id: string }>();
  const personId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [creditSortMode, setCreditSortMode] =
    useState<CreditSortMode>('popularity');
  const [bioExpanded, setBioExpanded] = useState(false);
  const [personCardWidth, setPersonCardWidth] = useState(176);
  const creditsGridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const idNum = Number(personId);
    setBioExpanded(false);
    setCreditSortMode('popularity');
    if (!Number.isInteger(idNum) || idNum <= 0) {
      setError('Invalid person id');
      setLoading(false);
      return;
    }

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/tmdb/person/${idNum}`);
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error || 'Failed to load person detail');
        }
        const payload = (await response.json()) as PersonDetail;
        setDetail(payload);
      } catch (err) {
        setError((err as Error).message || 'Failed to load person detail');
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [personId]);

  const sortedCredits = useMemo<PersonCredit[]>(() => {
    if (!detail?.credits?.length) return [];
    const credits = [...detail.credits];

    credits.sort((a, b) => {
      const dateDiff =
        toCreditTimestamp(b.releaseDate, b.year) -
        toCreditTimestamp(a.releaseDate, a.year);
      const popularityDiff = b.popularity - a.popularity;

      if (creditSortMode === 'date') {
        if (dateDiff !== 0) return dateDiff;
        if (popularityDiff !== 0) return popularityDiff;
        return b.id - a.id;
      }

      if (popularityDiff !== 0) return popularityDiff;
      if (dateDiff !== 0) return dateDiff;
      return b.id - a.id;
    });

    return credits;
  }, [creditSortMode, detail]);

  const timelineGroups = useMemo<
    Array<{ year: string; items: PersonCredit[] }>
  >(() => {
    if (creditSortMode !== 'date' || !sortedCredits.length) return [];

    const grouped = new Map<string, PersonCredit[]>();
    sortedCredits.forEach((item) => {
      const yearLabel = formatTimelineLabel(item.releaseDate, item.year);
      const existing = grouped.get(yearLabel);
      if (existing) {
        existing.push(item);
        return;
      }
      grouped.set(yearLabel, [item]);
    });

    return Array.from(grouped.entries()).map(([year, items]) => ({
      year,
      items,
    }));
  }, [creditSortMode, sortedCredits]);

  const creditSearchResults = useMemo<SearchResult[]>(() => {
    if (!sortedCredits.length) return [];
    return sortedCredits.map((item) => ({
      id: String(item.id),
      title: item.title,
      poster: item.poster,
      episodes: item.mediaType === 'movie' ? ['movie'] : ['tv'],
      source: 'tmdb',
      source_name: '',
      year: item.year || 'unknown',
      score: item.score || '',
      desc: item.overview || '',
      type_name: item.mediaType,
      douban_id: 0,
    }));
  }, [sortedCredits]);

  const biography = (detail?.biography || '').trim();
  const canExpandBio = biography.length > 120;

  useEffect(() => {
    const measureCardWidth = () => {
      const grid = creditsGridRef.current;
      if (!grid) return;
      const firstCardWrapper = grid.firstElementChild as HTMLElement | null;
      if (!firstCardWrapper) return;
      const width = Math.round(firstCardWrapper.getBoundingClientRect().width);
      if (width > 0) {
        setPersonCardWidth(width);
      }
    };

    measureCardWidth();
    window.addEventListener('resize', measureCardWidth);

    const observer = new ResizeObserver(() => {
      measureCardWidth();
    });
    if (creditsGridRef.current) {
      observer.observe(creditsGridRef.current);
    }

    return () => {
      window.removeEventListener('resize', measureCardWidth);
      observer.disconnect();
    };
  }, [creditSearchResults.length]);

  return (
    <AuroraBackground className='h-auto min-h-screen w-full items-stretch justify-start overflow-visible bg-transparent [&>div:first-child>div]:opacity-25 [&>div:first-child>div]:saturate-50'>
      <div className='pointer-events-none absolute inset-0 bg-black/40' />
      <div className='relative z-10 w-full'>
        <PageLayout activePath='/search' forceShowBackButton>
          <div className='px-4 pt-10 pb-5 sm:px-10 sm:pt-16 sm:pb-8 md:pt-20'>
            {loading ? (
              <div className='flex min-h-[50vh] items-center justify-center'>
                <Loader />
              </div>
            ) : error ? (
              <div className='rounded-xl border border-red-300 bg-red-50 p-4 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'>
                {error}
              </div>
            ) : detail ? (
              <div className='space-y-10'>
                <section className='text-white'>
                  <div
                    className='grid grid-cols-1 gap-6 px-6 pb-6 pt-0 sm:p-6 md:gap-8 md:px-0 md:py-8 md:[grid-template-columns:var(--person-card-width)_minmax(0,1fr)]'
                    style={
                      {
                        '--person-card-width': `${personCardWidth}px`,
                      } as CSSProperties
                    }
                  >
                    <div className='w-full max-w-[180px] self-start overflow-hidden rounded-xl bg-white/10 shadow-lg md:mx-0 md:w-[var(--person-card-width)] md:max-w-none md:justify-self-start'>
                      {detail.profile ? (
                        <div className='relative aspect-[2/3] w-full'>
                          <Image
                            src={detail.profile}
                            alt={detail.name}
                            fill
                            unoptimized
                            className='object-cover'
                          />
                        </div>
                      ) : (
                        <div className='flex aspect-[2/3] items-center justify-center text-white/50'>
                          <User className='h-14 w-14' />
                        </div>
                      )}
                    </div>

                    <div className='space-y-4'>
                      <div className='space-y-4'>
                        <h1 className='text-4xl font-bold tracking-tight text-white/85 sm:text-5xl'>
                          {detail.name}
                        </h1>
                        <div className='flex flex-wrap items-center gap-2 text-sm text-white/95'>
                          {detail.knownForDepartment && (
                            <span className='inline-flex items-center rounded-full border border-emerald-300/70 bg-emerald-500/25 px-3 py-1 text-xs font-semibold text-emerald-100'>
                              <Briefcase className='mr-1 h-3.5 w-3.5' />
                              {formatDepartment(detail.knownForDepartment)}
                            </span>
                          )}
                          {detail.popularity > 0 && (
                            <span className='inline-flex items-center rounded-full border border-amber-300/70 bg-amber-500/25 px-3 py-1 text-xs font-semibold text-amber-100'>
                              <TrendingUp className='mr-1 h-3.5 w-3.5' />
                              人气值 {Math.round(detail.popularity)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className='flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/80'>
                        {detail.birthday && (
                          <span className='inline-flex items-center gap-2'>
                            <Calendar className='h-4 w-4 text-white/60' />
                            生日 {formatDate(detail.birthday)}
                          </span>
                        )}
                        {detail.deathday && (
                          <span className='inline-flex items-center gap-2'>
                            <Calendar className='h-4 w-4 text-white/60' />
                            逝世 {formatDate(detail.deathday)}
                          </span>
                        )}
                        {detail.placeOfBirth && (
                          <span className='inline-flex items-center gap-2'>
                            <MapPin className='h-4 w-4 text-white/60' />
                            出生地 {detail.placeOfBirth}
                          </span>
                        )}
                      </div>

                      <div className='space-y-2'>
                        <p
                          className={`whitespace-pre-line text-sm leading-7 text-white/85 ${
                            bioExpanded ? '' : 'line-clamp-2'
                          }`}
                        >
                          {biography || '暂无人物简介。'}
                        </p>
                        {canExpandBio && (
                          <button
                            type='button'
                            onClick={() => setBioExpanded((prev) => !prev)}
                            className='inline-flex items-center gap-1 text-xs font-medium text-white/80 transition-colors hover:text-white'
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${
                                bioExpanded ? 'rotate-180' : ''
                              }`}
                            />
                            {bioExpanded ? '收起' : '展开全部'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
                    <h2 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
                      作品
                    </h2>
                    <div className='flex items-center gap-2'>
                      <div className='inline-flex overflow-hidden rounded-md border border-gray-300/80 bg-white/80 text-xs dark:border-gray-700 dark:bg-gray-900/70'>
                        <button
                          type='button'
                          onClick={() => setCreditSortMode('popularity')}
                          className={
                            creditSortMode === 'popularity'
                              ? 'px-3 py-1.5 transition-colors bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100'
                              : 'px-3 py-1.5 transition-colors text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                          }
                        >
                          按热度
                        </button>
                        <button
                          type='button'
                          onClick={() => setCreditSortMode('date')}
                          className={
                            creditSortMode === 'date'
                              ? 'px-3 py-1.5 transition-colors bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100'
                              : 'px-3 py-1.5 transition-colors text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                          }
                        >
                          按时间
                        </button>
                      </div>
                      <span className='text-sm text-gray-500 dark:text-gray-400'>
                        共 {creditSearchResults.length} 条
                      </span>
                    </div>
                  </div>

                  {creditSearchResults.length > 0 ? (
                    creditSortMode === 'date' ? (
                      <div className='space-y-8'>
                        {timelineGroups.map((group) => (
                          <div
                            key={`person-credit-year-${group.year}`}
                            className='space-y-3'
                          >
                            <div className='flex items-center gap-2 pl-0.5'>
                              <span className='h-3 w-3 rounded-full border-2 border-blue-500 bg-transparent' />
                              <div className='text-sm font-semibold text-gray-700 dark:text-gray-200'>
                                {group.year}
                              </div>
                            </div>
                            <div className='pl-5'>
                              <div className='grid grid-cols-2 gap-x-2 gap-y-14 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20'>
                                {group.items.map((item) => (
                                  <div
                                    key={`person-credit-${item.mediaType}-${item.id}`}
                                  >
                                    <VideoCard
                                      id={String(item.id)}
                                      title={item.title}
                                      poster={item.poster}
                                      episodes={1}
                                      source='tmdb'
                                      year={item.year}
                                      rate={item.score}
                                      from='douban'
                                      type={item.mediaType}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        ref={creditsGridRef}
                        className='grid grid-cols-2 gap-x-2 gap-y-14 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20'
                      >
                        {creditSearchResults.map((item) => (
                          <div key={`person-credit-${item.type_name}-${item.id}`}>
                            <VideoCard
                              id={item.id}
                              title={item.title}
                            poster={item.poster}
                            episodes={item.episodes.length}
                            source={item.source}
                            year={item.year}
                            rate={item.score}
                            from='douban'
                            type={item.type_name}
                          />
                        </div>
                      ))}
                      </div>
                    )
                  ) : (
                    <div className='rounded-xl border border-gray-200 bg-white/80 p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-400'>
                      暂无作品信息。
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </PageLayout>
      </div>
    </AuroraBackground>
  );
}
