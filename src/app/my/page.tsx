'use client';

import { Heart, History, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { Favorite, PlayRecord } from '@/lib/db.client';
import {
  deleteFavorite,
  deletePlayRecord,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import PageLayout from '@/components/PageLayout';
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

type PlayRecordItem = PlayRecord & { key: string };

interface FavoriteItem {
  key: string;
  source: string;
  id: string;
  title: string;
  poster: string;
  year: string;
  episodes: number;
  sourceName: string;
  currentEpisode?: number;
  searchTitle?: string;
}

function parseStorageKey(key: string): { source: string; id: string } {
  const splitIndex = key.indexOf('+');
  if (splitIndex < 0) {
    return { source: '', id: key };
  }
  return {
    source: key.slice(0, splitIndex),
    id: key.slice(splitIndex + 1),
  };
}

function getProgressPercent(record: PlayRecord): number {
  if (!record.total_time) return 0;
  return (record.play_time / record.total_time) * 100;
}

export default function MyPage() {
  const [activeTab, setActiveTab] = useState<'play' | 'favorite'>('play');
  const [playRecords, setPlayRecords] = useState<PlayRecordItem[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [loadingPlayRecords, setLoadingPlayRecords] = useState(true);
  const [loadingFavorites, setLoadingFavorites] = useState(true);
  const [isPlayBatchMode, setIsPlayBatchMode] = useState(false);
  const [isFavoriteBatchMode, setIsFavoriteBatchMode] = useState(false);
  const [selectedPlayKeys, setSelectedPlayKeys] = useState<Set<string>>(
    new Set()
  );
  const [selectedFavoriteKeys, setSelectedFavoriteKeys] = useState<Set<string>>(
    new Set()
  );
  const [deleteTarget, setDeleteTarget] = useState<'play' | 'favorite' | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [playSearchKeyword, setPlaySearchKeyword] = useState('');
  const [favoriteSearchKeyword, setFavoriteSearchKeyword] = useState('');

  const updatePlayRecords = useCallback((records: Record<string, PlayRecord>) => {
    const sorted = Object.entries(records)
      .map(([key, record]) => ({ ...record, key }))
      .sort((a, b) => b.save_time - a.save_time);
    setPlayRecords(sorted);
  }, []);

  const updateFavorites = useCallback(
    async (favorites: Record<string, Favorite>) => {
      const allPlayRecords = await getAllPlayRecords();
      const sorted = Object.entries(favorites)
        .sort(([, a], [, b]) => b.save_time - a.save_time)
        .map(([key, fav]) => {
          const { source, id } = parseStorageKey(key);
          const playRecord = allPlayRecords[key];
          return {
            key,
            source,
            id,
            title: fav.title,
            poster: fav.cover,
            year: fav.year,
            episodes: fav.total_episodes,
            sourceName: fav.source_name,
            currentEpisode: playRecord?.index,
            searchTitle: fav.search_title,
          } satisfies FavoriteItem;
        });
      setFavoriteItems(sorted);
    },
    []
  );

  useEffect(() => {
    const load = async () => {
      try {
        setLoadingPlayRecords(true);
        setLoadingFavorites(true);
        const [records, favorites] = await Promise.all([
          getAllPlayRecords(),
          getAllFavorites(),
        ]);
        updatePlayRecords(records);
        await updateFavorites(favorites);
      } finally {
        setLoadingPlayRecords(false);
        setLoadingFavorites(false);
      }
    };

    void load();

    const unsubPlay = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
      }
    );
    const unsubFav = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, Favorite>) => {
        void updateFavorites(newFavorites);
      }
    );

    return () => {
      unsubPlay();
      unsubFav();
    };
  }, [updateFavorites, updatePlayRecords]);

  useEffect(() => {
    setSelectedPlayKeys((prev) => {
      const validKeys = new Set(playRecords.map((item) => item.key));
      return new Set(Array.from(prev).filter((key) => validKeys.has(key)));
    });
  }, [playRecords]);

  useEffect(() => {
    setSelectedFavoriteKeys((prev) => {
      const validKeys = new Set(favoriteItems.map((item) => item.key));
      return new Set(Array.from(prev).filter((key) => validKeys.has(key)));
    });
  }, [favoriteItems]);

  useEffect(() => {
    setDeleteTarget(null);
    if (activeTab === 'play') {
      setIsFavoriteBatchMode(false);
      setSelectedFavoriteKeys(new Set());
      return;
    }
    setIsPlayBatchMode(false);
    setSelectedPlayKeys(new Set());
  }, [activeTab]);

  const normalizedPlaySearchKeyword = playSearchKeyword.trim().toLowerCase();
  const filteredPlayRecords = playRecords.filter((record) => {
    if (!normalizedPlaySearchKeyword) return true;
    return [
      record.title,
      record.source_name,
      record.year,
      record.search_title,
    ].some((value) =>
      (value || '').toLowerCase().includes(normalizedPlaySearchKeyword)
    );
  });

  const normalizedFavoriteSearchKeyword = favoriteSearchKeyword
    .trim()
    .toLowerCase();
  const filteredFavoriteItems = favoriteItems.filter((item) => {
    if (!normalizedFavoriteSearchKeyword) return true;
    return [item.title, item.sourceName, item.year, item.searchTitle].some(
      (value) =>
        (value || '').toLowerCase().includes(normalizedFavoriteSearchKeyword)
    );
  });

  const togglePlaySelection = (key: string) => {
    setSelectedPlayKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleFavoriteSelection = (key: string) => {
    setSelectedFavoriteKeys((prev) => {
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
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget === 'play') {
        const targets = playRecords.filter((item) => selectedPlayKeys.has(item.key));
        await Promise.all(
          targets.map((item) => {
            const { source, id } = parseStorageKey(item.key);
            return deletePlayRecord(source, id);
          })
        );
        setPlayRecords((prev) =>
          prev.filter((item) => !selectedPlayKeys.has(item.key))
        );
        setSelectedPlayKeys(new Set());
        setIsPlayBatchMode(false);
      } else {
        const targets = favoriteItems.filter((item) =>
          selectedFavoriteKeys.has(item.key)
        );
        await Promise.all(
          targets.map((item) => deleteFavorite(item.source, item.id))
        );
        setFavoriteItems((prev) =>
          prev.filter((item) => !selectedFavoriteKeys.has(item.key))
        );
        setSelectedFavoriteKeys(new Set());
        setIsFavoriteBatchMode(false);
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <PageLayout activePath='/my'>
      <div className='px-2 pt-14 pb-5 sm:px-10 sm:pt-16 sm:pb-8 md:pt-20'>
        <div className='mx-auto w-full max-w-[95%] space-y-8'>
          <div className='flex justify-center'>
            <CapsuleSwitch
              options={[
                { label: '历史记录', value: 'play' },
                { label: '收藏夹', value: 'favorite' },
              ]}
              active={activeTab}
              onChange={(value) => setActiveTab(value as 'play' | 'favorite')}
            />
          </div>

          {activeTab === 'play' ? (
            <section className='space-y-4'>
            <div className='px-4 sm:px-6'>
              <div className='relative'>
                <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
                <input
                  type='text'
                  value={playSearchKeyword}
                  onChange={(event) => setPlaySearchKeyword(event.target.value)}
                  placeholder='搜索历史记录'
                  className='h-10 w-full rounded-xl border border-gray-200 bg-white/80 pl-9 pr-9 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-300/40 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:border-blue-500 dark:focus:ring-blue-500/30'
                />
                {playSearchKeyword ? (
                  <button
                    type='button'
                    aria-label='clear-play-search'
                    onClick={() => setPlaySearchKeyword('')}
                    className='absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                  >
                    <X className='h-4 w-4' />
                  </button>
                ) : null}
              </div>
            </div>
            <div className='flex items-center justify-between'>
              <h2 className='flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200'>
                <History className='h-5 w-5' />
                {'\u6211\u7684\u5386\u53f2\u8bb0\u5f55'}
              </h2>
              {!loadingPlayRecords && playRecords.length > 0 ? (
                isPlayBatchMode ? (
                  <div className='flex items-center gap-3'>
                    <button
                      type='button'
                      className='text-sm text-red-500 transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-400'
                      disabled={selectedPlayKeys.size === 0}
                      onClick={() => setDeleteTarget('play')}
                    >
                      {`\u5220\u9664 (${selectedPlayKeys.size})`}
                    </button>
                    <button
                      type='button'
                      className='text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      onClick={() => {
                        setIsPlayBatchMode(false);
                        setSelectedPlayKeys(new Set());
                      }}
                    >
                      {'\u53d6\u6d88'}
                    </button>
                  </div>
                ) : (
                  <button
                    type='button'
                    className='text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    onClick={() => {
                      setIsPlayBatchMode(true);
                      setIsFavoriteBatchMode(false);
                      setSelectedFavoriteKeys(new Set());
                    }}
                  >
                    {'\u6279\u91cf\u5904\u7406'}
                  </button>
                )
              ) : null}
            </div>

            {loadingPlayRecords ? (
              <div className='px-4 sm:px-6'>
                <div className='grid grid-cols-2 gap-x-2 gap-y-14 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20'>
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div
                      key={`my-play-skeleton-${index}`}
                      className='relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'
                    />
                  ))}
                </div>
              </div>
            ) : filteredPlayRecords.length > 0 ? (
              <div className='px-4 sm:px-6'>
                <div className='grid grid-cols-2 gap-x-2 gap-y-14 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20'>
                  {filteredPlayRecords.map((record) => {
                    const { source, id } = parseStorageKey(record.key);
                    const isSelected = selectedPlayKeys.has(record.key);
                    return (
                      <div key={record.key} className='relative'>
                        <VideoCard
                          id={id}
                          source={source}
                          title={record.title}
                          poster={record.cover}
                          source_name={record.source_name}
                          year={record.year}
                          episodes={record.total_episodes}
                          currentEpisode={record.index}
                          progress={getProgressPercent(record)}
                          query={record.search_title}
                          from='playrecord'
                          type={record.total_episodes > 1 ? 'tv' : ''}
                          onDelete={() =>
                            setPlayRecords((prev) =>
                              prev.filter((item) => item.key !== record.key)
                            )
                          }
                        />
                        {isPlayBatchMode ? (
                          <button
                            type='button'
                            aria-label='toggle-play-record-selection'
                            className='absolute inset-0 z-20 rounded-lg bg-black/10 transition-colors hover:bg-black/15'
                            onClick={() => togglePlaySelection(record.key)}
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
                </div>
              </div>
            ) : (
              <div className='py-8 text-center text-sm text-gray-500 dark:text-gray-400'>
                {playRecords.length === 0
                  ? '\u6682\u65e0\u5386\u53f2\u8bb0\u5f55'
                  : '\u672a\u627e\u5230\u5339\u914d\u7684\u5386\u53f2\u8bb0\u5f55'}
              </div>
            )}
            </section>
          ) : (
            <section className='space-y-4'>
            <div className='px-4 sm:px-6'>
              <div className='relative'>
                <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
                <input
                  type='text'
                  value={favoriteSearchKeyword}
                  onChange={(event) =>
                    setFavoriteSearchKeyword(event.target.value)
                  }
                  placeholder='搜索收藏夹'
                  className='h-10 w-full rounded-xl border border-gray-200 bg-white/80 pl-9 pr-9 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-300/40 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:border-blue-500 dark:focus:ring-blue-500/30'
                />
                {favoriteSearchKeyword ? (
                  <button
                    type='button'
                    aria-label='clear-favorite-search'
                    onClick={() => setFavoriteSearchKeyword('')}
                    className='absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                  >
                    <X className='h-4 w-4' />
                  </button>
                ) : null}
              </div>
            </div>
            <div className='flex items-center justify-between'>
              <h2 className='flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-200'>
                <Heart className='h-5 w-5' />
                {'\u6211\u7684\u6536\u85cf\u5939'}
              </h2>
              {!loadingFavorites && favoriteItems.length > 0 ? (
                isFavoriteBatchMode ? (
                  <div className='flex items-center gap-3'>
                    <button
                      type='button'
                      className='text-sm text-red-500 transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-400'
                      disabled={selectedFavoriteKeys.size === 0}
                      onClick={() => setDeleteTarget('favorite')}
                    >
                      {`\u5220\u9664 (${selectedFavoriteKeys.size})`}
                    </button>
                    <button
                      type='button'
                      className='text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      onClick={() => {
                        setIsFavoriteBatchMode(false);
                        setSelectedFavoriteKeys(new Set());
                      }}
                    >
                      {'\u53d6\u6d88'}
                    </button>
                  </div>
                ) : (
                  <button
                    type='button'
                    className='text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    onClick={() => {
                      setIsFavoriteBatchMode(true);
                      setIsPlayBatchMode(false);
                      setSelectedPlayKeys(new Set());
                    }}
                  >
                    {'\u6279\u91cf\u5904\u7406'}
                  </button>
                )
              ) : null}
            </div>

            {loadingFavorites ? (
              <div className='px-4 sm:px-6'>
                <div className='grid grid-cols-2 gap-x-2 gap-y-14 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20'>
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div
                      key={`my-favorite-skeleton-${index}`}
                      className='relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'
                    />
                  ))}
                </div>
              </div>
            ) : filteredFavoriteItems.length > 0 ? (
              <div className='px-4 sm:px-6'>
                <div className='grid grid-cols-2 gap-x-2 gap-y-14 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8 sm:gap-y-20'>
                  {filteredFavoriteItems.map((item) => (
                    <div key={item.key} className='relative'>
                      <VideoCard
                        id={item.id}
                        source={item.source}
                        title={item.title}
                        poster={item.poster}
                        source_name={item.sourceName}
                        year={item.year}
                        episodes={item.episodes}
                        currentEpisode={item.currentEpisode}
                        query={item.searchTitle}
                        from='favorite'
                        type={item.episodes > 1 ? 'tv' : ''}
                      />
                      {isFavoriteBatchMode ? (
                        <button
                          type='button'
                          aria-label='toggle-favorite-selection'
                          className='absolute inset-0 z-20 rounded-lg bg-black/10 transition-colors hover:bg-black/15'
                          onClick={() => toggleFavoriteSelection(item.key)}
                        >
                          <span
                            className={`absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-bold ${
                              selectedFavoriteKeys.has(item.key)
                                ? 'border-red-500 bg-red-500 text-white'
                                : 'border-white/80 bg-black/40 text-transparent'
                            }`}
                          >
                            {'\u2713'}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className='px-4 sm:px-6'>
                <div className='py-8 text-center text-sm text-gray-500 dark:text-gray-400'>
                  {favoriteItems.length === 0
                    ? '\u6682\u65e0\u6536\u85cf\u5185\u5bb9'
                    : '\u672a\u627e\u5230\u5339\u914d\u7684\u6536\u85cf\u5185\u5bb9'}
                </div>
              </div>
            )}
            </section>
          )}
        </div>
      </div>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className='max-w-sm rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100'>
          <AlertDialogHeader>
            <AlertDialogTitle>{'\u786e\u8ba4\u5220\u9664\u5417\uff1f'}</AlertDialogTitle>
            <AlertDialogDescription className='text-zinc-600 dark:text-zinc-300'>
              {deleteTarget === 'play'
                ? `\u5c06\u5220\u9664 ${selectedPlayKeys.size} \u6761\u5386\u53f2\u8bb0\u5f55\u3002`
                : `\u5c06\u5220\u9664 ${selectedFavoriteKeys.size} \u9879\u6536\u85cf\u3002`}
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
    </PageLayout>
  );
}
