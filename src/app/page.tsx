/* eslint-disable react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronRight, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';

import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import TmdbHeroBanner from '@/components/TmdbHeroBanner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import VideoCard from '@/components/VideoCard';

function splitAnnouncementParagraphs(text: string) {
  const normalized = text.trim();
  if (!normalized) return [];

  if (normalized.includes('\n')) {
    return normalized
      .split(/\n{2,}|\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const sentences = normalized.match(/[^。！？]+[。！？]?/g) || [normalized];
  if (sentences.length <= 2) return [normalized];

  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    paragraphs.push(sentences.slice(i, i + 2).join(''));
  }
  return paragraphs;
}

function HomeClient() {
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { announcement } = useSite();
  const [showAnnouncement, setShowAnnouncement] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  useEffect(() => {
    const fetchDoubanData = async () => {
      try {
        setLoading(true);

        const [moviesData, tvShowsData, varietyShowsData] = await Promise.all([
          getDoubanCategories({
            kind: 'movie',
            category: '热门',
            type: '全部',
          }),
          getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
          getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
        ]);

        if (moviesData.code === 200) {
          setHotMovies(moviesData.list);
        }

        if (tvShowsData.code === 200) {
          setHotTvShows(tvShowsData.list);
        }

        if (varietyShowsData.code === 200) {
          setHotVarietyShows(varietyShowsData.list);
        }
      } catch (error) {
        console.error('Failed to fetch douban categories:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchDoubanData();
  }, []);

  const handleCloseAnnouncement = (value: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', value);
  };

  return (
    <PageLayout showDesktopTopSearch>
      <div className='px-2 sm:px-10 pb-4 sm:pb-8 overflow-visible'>
        <TmdbHeroBanner />

        <div className='w-full max-w-[95%] mx-auto mt-8'>
          <ContinueWatching />

          <section className='mb-8'>
            <div className='mb-4 flex items-center justify-between'>
              <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                热门电影
              </h2>
              <Link
                href='/douban?type=movie'
                className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              >
                查看更多
                <ChevronRight className='w-4 h-4 ml-1' />
              </Link>
            </div>
            <ScrollableRow>
              {loading
                ? Array.from({ length: 8 }).map((_, index) => (
                    <div
                      key={index}
                      className='min-w-[160px] w-40 sm:min-w-[180px] sm:w-44'
                    >
                      <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                        <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                      </div>
                      <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                    </div>
                  ))
                : hotMovies.map((movie, index) => (
                    <div
                      key={index}
                      className='min-w-[160px] w-40 sm:min-w-[180px] sm:w-44'
                    >
                      <VideoCard
                        from='douban'
                        title={movie.title}
                        poster={movie.poster}
                        douban_id={movie.id}
                        rate={movie.rate}
                        year={movie.year}
                        type='movie'
                      />
                    </div>
                  ))}
            </ScrollableRow>
          </section>

          <section className='mb-8'>
            <div className='mb-4 flex items-center justify-between'>
              <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                热门剧集
              </h2>
              <Link
                href='/douban?type=tv'
                className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              >
                查看更多
                <ChevronRight className='w-4 h-4 ml-1' />
              </Link>
            </div>
            <ScrollableRow>
              {loading
                ? Array.from({ length: 8 }).map((_, index) => (
                    <div
                      key={index}
                      className='min-w-[160px] w-40 sm:min-w-[180px] sm:w-44'
                    >
                      <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                        <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                      </div>
                      <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                    </div>
                  ))
                : hotTvShows.map((show, index) => (
                    <div
                      key={index}
                      className='min-w-[160px] w-40 sm:min-w-[180px] sm:w-44'
                    >
                      <VideoCard
                        from='douban'
                        title={show.title}
                        poster={show.poster}
                        douban_id={show.id}
                        rate={show.rate}
                        year={show.year}
                      />
                    </div>
                  ))}
            </ScrollableRow>
          </section>

          <section className='mb-8'>
            <div className='mb-4 flex items-center justify-between'>
              <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                热门综艺
              </h2>
              <Link
                href='/douban?type=show'
                className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              >
                查看更多
                <ChevronRight className='w-4 h-4 ml-1' />
              </Link>
            </div>
            <ScrollableRow>
              {loading
                ? Array.from({ length: 8 }).map((_, index) => (
                    <div
                      key={index}
                      className='min-w-[160px] w-40 sm:min-w-[180px] sm:w-44'
                    >
                      <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                        <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                      </div>
                      <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                    </div>
                  ))
                : hotVarietyShows.map((show, index) => (
                    <div
                      key={index}
                      className='min-w-[160px] w-40 sm:min-w-[180px] sm:w-44'
                    >
                      <VideoCard
                        from='douban'
                        title={show.title}
                        poster={show.poster}
                        douban_id={show.id}
                        rate={show.rate}
                        year={show.year}
                      />
                    </div>
                  ))}
            </ScrollableRow>
          </section>
        </div>
      </div>

      {announcement && (
        <AlertDialog
          open={showAnnouncement}
          onOpenChange={(open) => {
            if (!open) handleCloseAnnouncement(announcement);
          }}
        >
          <AlertDialogContent className='max-h-[80vh] w-[min(92vw,28rem)] overflow-y-auto rounded-2xl border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl'>
            <AlertDialogHeader className='space-y-3'>
              <div className='flex items-center gap-3'>
                <ShieldAlert className='h-6 w-6 text-red-500' />
                <AlertDialogTitle className='text-xl text-zinc-100'>
                  免责声明
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription className='space-y-3 text-sm leading-6 text-zinc-300'>
                {splitAnnouncementParagraphs(announcement).map(
                  (paragraph, index) => (
                    <p key={`announcement-${index}`}>{paragraph}</p>
                  )
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction
                onClick={() => handleCloseAnnouncement(announcement)}
                className='w-full rounded-lg bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus-visible:ring-zinc-600'
              >
                我知道了
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
