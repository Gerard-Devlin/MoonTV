/* eslint-disable no-console */
'use client';

import { useEffect, useState } from 'react';

import type { PlayRecord } from '@/lib/db.client';
import {
  deletePlayRecord,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ContinueWatchingProps {
  className?: string;
}

export default function ContinueWatching({ className }: ContinueWatchingProps) {
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const updatePlayRecords = (allRecords: Record<string, PlayRecord>) => {
    const recordsArray = Object.entries(allRecords).map(([key, record]) => ({
      ...record,
      key,
    }));

    const sortedRecords = recordsArray.sort((a, b) => b.save_time - a.save_time);
    setPlayRecords(sortedRecords);
  };

  useEffect(() => {
    const fetchPlayRecords = async () => {
      try {
        setLoading(true);
        const allRecords = await getAllPlayRecords();
        updatePlayRecords(allRecords);
      } catch (error) {
        console.error('Failed to fetch play records:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    };

    void fetchPlayRecords();

    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    setSelectedKeys((prev) => {
      const validKeys = new Set(playRecords.map((item) => item.key));
      return new Set(Array.from(prev).filter((key) => validKeys.has(key)));
    });
  }, [playRecords]);

  if (!loading && playRecords.length === 0) {
    return null;
  }

  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  const parseKey = (key: string) => {
    const splitIndex = key.indexOf('+');
    if (splitIndex < 0) {
      return { source: '', id: key };
    }
    return {
      source: key.slice(0, splitIndex),
      id: key.slice(splitIndex + 1),
    };
  };

  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      const targets = playRecords.filter((item) => selectedKeys.has(item.key));
      await Promise.all(
        targets.map((item) => {
          const { source, id } = parseKey(item.key);
          return deletePlayRecord(source, id);
        })
      );
      setPlayRecords((prev) =>
        prev.filter((item) => !selectedKeys.has(item.key))
      );
      setSelectedKeys(new Set());
      setIsBatchMode(false);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  return (
    <section className={`mb-8 ${className || ''}`}>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
          {'继续观看'}
        </h2>
        {!loading && playRecords.length > 0 ? (
          isBatchMode ? (
            <div className='flex items-center gap-3'>
              <button
                type='button'
                className='text-sm text-red-500 transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-400'
                disabled={selectedKeys.size === 0}
                onClick={() => setDeleteDialogOpen(true)}
              >
                {`\u5220\u9664 (${selectedKeys.size})`}
              </button>
              <button
                type='button'
                className='text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                onClick={() => {
                  setIsBatchMode(false);
                  setSelectedKeys(new Set());
                }}
              >
                {'\u53d6\u6d88'}
              </button>
            </div>
          ) : (
            <button
              type='button'
              className='text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              onClick={() => setIsBatchMode(true)}
            >
              {'\u6279\u91cf\u5904\u7406'}
            </button>
          )
        ) : null}
      </div>
      <ScrollableRow>
        {loading
          ? Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className='min-w-[160px] w-40 sm:min-w-[180px] sm:w-44'
              >
                <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                  <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                </div>
                <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                <div className='mt-1 h-3 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
              </div>
            ))
          : playRecords.map((record) => {
              const { source, id } = parseKey(record.key);
              const isSelected = selectedKeys.has(record.key);
              return (
                <div
                  key={record.key}
                  className='relative min-w-[160px] w-40 sm:min-w-[180px] sm:w-44'
                >
                  <VideoCard
                    id={id}
                    title={record.title}
                    poster={record.cover}
                    year={record.year}
                    source={source}
                    source_name={record.source_name}
                    progress={getProgress(record)}
                    episodes={record.total_episodes}
                    currentEpisode={record.index}
                    query={record.search_title}
                    from='playrecord'
                    onDelete={() =>
                      setPlayRecords((prev) =>
                        prev.filter((r) => r.key !== record.key)
                      )
                    }
                    type={record.total_episodes > 1 ? 'tv' : ''}
                  />
                  {isBatchMode ? (
                    <button
                      type='button'
                      aria-label='toggle-home-play-record-selection'
                      className='absolute inset-0 z-20 rounded-lg bg-black/10 transition-colors hover:bg-black/15'
                      onClick={() => toggleSelection(record.key)}
                    >
                      <span
                        className={`absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-bold ${
                          isSelected
                            ? 'border-red-500 bg-red-500 text-white'
                            : 'border-white/80 bg-black/40 text-transparent'
                        }`}
                      >
                        {'\u2713'}
                      </span>
                    </button>
                  ) : null}
                </div>
              );
            })}
      </ScrollableRow>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className='max-w-sm rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'>
          <AlertDialogHeader>
            <AlertDialogTitle>{'\u786e\u8ba4\u5220\u9664\u5417\uff1f'}</AlertDialogTitle>
            <AlertDialogDescription className='text-zinc-600 dark:text-zinc-300'>
              {`\u5c06\u5220\u9664 ${selectedKeys.size} \u6761\u5386\u53f2\u8bb0\u5f55\u3002`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className='border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
            >
              {'\u53d6\u6d88'}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
              className='bg-red-600 text-white hover:bg-red-700'
            >
              {deleting ? '\u5220\u9664\u4e2d...' : '\u786e\u5b9a\u5220\u9664'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

