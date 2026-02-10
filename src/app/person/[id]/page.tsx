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
import { useEffect, useMemo, useState } from 'react';

import { SearchResult } from '@/lib/types';

import Loader from '@/components/Loader';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface PersonCredit {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  poster: string;
  year: string;
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

export default function PersonDetailPage() {
  const params = useParams<{ id: string }>();
  const personId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);

  useEffect(() => {
    const idNum = Number(personId);
    setBioExpanded(false);
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

  const creditSearchResults = useMemo<SearchResult[]>(() => {
    if (!detail?.credits?.length) return [];
    return detail.credits.map((item) => ({
      id: String(item.id),
      title: item.title,
      poster: item.poster,
      episodes: item.mediaType === 'movie' ? ['movie'] : ['tv-1', 'tv-2'],
      source: 'tmdb',
      source_name: '',
      year: item.year || 'unknown',
      desc: item.overview || '',
      type_name: item.mediaType,
      douban_id: 0,
    }));
  }, [detail]);

  const biography = (detail?.biography || '').trim();
  const canExpandBio = biography.length > 120;

  return (
    <div className='min-h-screen w-full'>
      <div className='relative w-full'>
        <PageLayout activePath='/search' forceShowBackButton>
          <div className='px-4 sm:px-10 pt-14 pb-5 sm:pt-16 sm:pb-8 md:pt-20'>
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
                <section className='overflow-hidden rounded-3xl border border-white/20 bg-zinc-900 text-white shadow-2xl'>
                  <div className='grid grid-cols-1 gap-6 p-6 md:grid-cols-[180px_1fr] md:gap-8 md:p-8'>
                    <div className='mx-auto w-full max-w-[180px] self-start overflow-hidden rounded-xl border border-white/20 bg-white/10 shadow-lg md:mx-0'>
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
                      <div className='space-y-2'>
                        <h1 className='text-4xl font-bold tracking-tight text-white sm:text-5xl'>
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
                  <div className='mb-4 flex items-center justify-between'>
                    <h2 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
                      作品
                    </h2>
                    <span className='text-sm text-gray-500 dark:text-gray-400'>
                      共 {creditSearchResults.length} 条
                    </span>
                  </div>

                  {creditSearchResults.length > 0 ? (
                    <div className='grid grid-cols-2 gap-x-2 gap-y-14 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20'>
                      {creditSearchResults.map((item) => (
                        <div key={`person-credit-${item.type_name}-${item.id}`}>
                          <VideoCard
                            id={item.id}
                            title={item.title}
                            poster={item.poster}
                            episodes={item.episodes.length}
                            source={item.source}
                            year={item.year}
                            from='search'
                            type={item.type_name}
                          />
                        </div>
                      ))}
                    </div>
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
    </div>
  );
}
