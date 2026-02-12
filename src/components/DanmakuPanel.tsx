/* eslint-disable no-console, @next/next/no-img-element */

'use client';

import { MagnifyingGlassIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getEpisodes, matchAnime, searchAnime } from '@/lib/danmaku/api';
import type {
  DanmakuAnime,
  DanmakuComment,
  DanmakuEpisode,
  DanmakuSelection,
} from '@/lib/danmaku/types';
import { parseXmlDanmaku } from '@/lib/danmaku/xml-parser';

interface DanmakuPanelProps {
  videoTitle: string;
  currentEpisodeIndex: number;
  onDanmakuSelect: (selection: DanmakuSelection) => void;
  currentSelection: DanmakuSelection | null;
  onUploadDanmaku?: (comments: DanmakuComment[]) => void;
}

export default function DanmakuPanel({
  videoTitle,
  currentEpisodeIndex,
  onDanmakuSelect,
  currentSelection,
  onUploadDanmaku,
}: DanmakuPanelProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<DanmakuAnime[]>([]);
  const [selectedAnime, setSelectedAnime] = useState<DanmakuAnime | null>(null);
  const [episodes, setEpisodes] = useState<DanmakuEpisode[]>([]);

  const [isSearching, setIsSearching] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initializedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatSmartMatchError = useCallback((raw: string): string => {
    const message = (raw || '').trim();
    if (!message) return '智能匹配失败，请稍后重试';

    const lower = message.toLowerCase();
    if (
      lower.includes('econnrefused') ||
      lower.includes('fetch failed') ||
      lower.includes('localhost:9321')
    ) {
      return `${message}。请先确认弹幕服务可用，并检查 DANMAKU_API_BASE 配置。`;
    }

    return message;
  }, []);

  const buildMatchFileNameCandidates = useCallback(
    (title: string, episodeIndex: number): string[] => {
      const episodeNumber = Math.max(1, episodeIndex + 1);
      const padded = String(episodeNumber).padStart(2, '0');

      const candidates = new Set<string>();
      const push = (value: string) => {
        const normalized = value.trim();
        if (!normalized) return;
        candidates.add(normalized);
      };

      push(title);
      push(`${title} 第${episodeNumber}集`);
      push(`${title} 第${episodeNumber}话`);
      push(`${title} - 第${episodeNumber}集`);
      push(`${title}.E${episodeNumber}`);
      push(`${title}.S01E${padded}`);
      push(`${title}.${padded}.mp4`);

      return Array.from(candidates);
    },
    []
  );

  const fallbackMatchBySearch = useCallback(
    async (title: string, upstreamMessage?: string): Promise<boolean> => {
      const searchResponse = await searchAnime(title);
      if (!searchResponse.success || searchResponse.animes.length === 0) {
        const errorMessage =
          searchResponse.errorMessage || upstreamMessage || '未匹配到可用弹幕';
        setError(formatSmartMatchError(errorMessage));
        return false;
      }

      const bestAnime = searchResponse.animes[0];
      const episodesResponse = await getEpisodes(bestAnime.animeId);
      if (!episodesResponse.success || episodesResponse.bangumi.episodes.length === 0) {
        setError(
          formatSmartMatchError(
            episodesResponse.errorMessage || '匹配到弹幕源，但没有找到剧集信息'
          )
        );
        return false;
      }

      const index = Math.min(
        Math.max(currentEpisodeIndex, 0),
        episodesResponse.bangumi.episodes.length - 1
      );
      const episode = episodesResponse.bangumi.episodes[index];

      onDanmakuSelect({
        animeId: bestAnime.animeId,
        episodeId: episode.episodeId,
        animeTitle: bestAnime.animeTitle,
        episodeTitle: episode.episodeTitle,
        searchKeyword: title,
      });
      setError(null);
      return true;
    },
    [currentEpisodeIndex, formatSmartMatchError, onDanmakuSelect]
  );

  const handleSearch = useCallback(async (keyword: string) => {
    const q = keyword.trim();
    if (!q) {
      setError('请输入搜索关键词');
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await searchAnime(q);
      if (!response.success || response.animes.length === 0) {
        setSearchResults([]);
        setError(response.errorMessage || '未找到匹配的弹幕来源');
        return;
      }

      setSearchResults(response.animes);
      setSelectedAnime(null);
      setEpisodes([]);
    } catch (e) {
      console.error('Search danmaku failed:', e);
      setSearchResults([]);
      setError('弹幕搜索失败，请稍后重试');
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSmartMatch = useCallback(async () => {
    const title = (videoTitle || '').trim();
    if (!title) {
      setError('当前视频标题为空，无法智能匹配');
      return;
    }

    setIsMatching(true);
    setError(null);

    try {
      const matchCandidates = buildMatchFileNameCandidates(title, currentEpisodeIndex);
      let lastMatchError = '';

      for (const candidate of matchCandidates) {
        const response = await matchAnime(candidate);
        if (response.success && response.isMatched && response.matches.length > 0) {
          const best = response.matches[0];
          onDanmakuSelect({
            animeId: best.animeId,
            episodeId: best.episodeId,
            animeTitle: best.animeTitle,
            episodeTitle: best.episodeTitle,
            searchKeyword: title,
          });
          setError(null);
          return;
        }

        if (response.errorMessage) {
          lastMatchError = response.errorMessage;
        }
      }

      await fallbackMatchBySearch(title, lastMatchError);
    } catch (e) {
      console.error('Match danmaku failed:', e);
      const fallbackError = e instanceof Error ? e.message : '智能匹配失败';
      const success = await fallbackMatchBySearch(title, fallbackError);
      if (!success) {
        setError(formatSmartMatchError(fallbackError));
      }
    } finally {
      setIsMatching(false);
    }
  }, [
    buildMatchFileNameCandidates,
    currentEpisodeIndex,
    fallbackMatchBySearch,
    formatSmartMatchError,
    onDanmakuSelect,
    videoTitle,
  ]);

  const handleAnimeSelect = useCallback(async (anime: DanmakuAnime) => {
    setSelectedAnime(anime);
    setIsLoadingEpisodes(true);
    setError(null);

    try {
      const response = await getEpisodes(anime.animeId);
      if (!response.success || response.bangumi.episodes.length === 0) {
        setEpisodes([]);
        setError(response.errorMessage || '该弹幕源没有剧集信息');
        return;
      }

      setEpisodes(response.bangumi.episodes);
    } catch (e) {
      console.error('Load danmaku episodes failed:', e);
      setEpisodes([]);
      setError('剧集加载失败，请稍后重试');
    } finally {
      setIsLoadingEpisodes(false);
    }
  }, []);

  const handleEpisodeSelect = useCallback(
    (episode: DanmakuEpisode) => {
      if (!selectedAnime) return;

      onDanmakuSelect({
        animeId: selectedAnime.animeId,
        episodeId: episode.episodeId,
        animeTitle: selectedAnime.animeTitle,
        episodeTitle: episode.episodeTitle,
        searchKeyword: searchKeyword.trim() || undefined,
      });
    },
    [onDanmakuSelect, searchKeyword, selectedAnime]
  );

  const handleBack = useCallback(() => {
    setSelectedAnime(null);
    setEpisodes([]);
  }, []);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith('.xml')) {
        setError('请上传 XML 格式弹幕文件');
        return;
      }

      try {
        const text = await file.text();
        const comments = parseXmlDanmaku(text);

        if (comments.length === 0) {
          setError('弹幕文件解析失败或为空');
          return;
        }

        onUploadDanmaku?.(comments);
        setError(null);
      } catch (e) {
        console.error('Upload danmaku failed:', e);
        setError('弹幕文件解析失败');
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [onUploadDanmaku]
  );

  useEffect(() => {
    if (!initializedRef.current && videoTitle) {
      setSearchKeyword(videoTitle);
      initializedRef.current = true;
    }
  }, [videoTitle]);

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <div className='mb-3 flex flex-shrink-0 gap-2'>
        <input
          type='text'
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSearch(searchKeyword);
            }
          }}
          placeholder='输入剧名搜索弹幕...'
          className='flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
          autoComplete='off'
        />
        <button
          onClick={() => handleSearch(searchKeyword)}
          disabled={isSearching}
          className='rounded-lg bg-blue-600 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50'
          title='搜索弹幕'
        >
          {isSearching ? '...' : <MagnifyingGlassIcon className='h-4 w-4' />}
        </button>
      </div>

      <div className='mb-3 flex flex-shrink-0 gap-2'>
        <button
          onClick={handleSmartMatch}
          disabled={isMatching || !videoTitle.trim()}
          className='flex w-full items-center justify-center gap-2 rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 transition-colors hover:bg-blue-500/20 disabled:opacity-50 dark:text-blue-300'
        >
          <SparklesIcon className='h-4 w-4' />
          {isMatching
            ? '智能匹配中...'
            : `智能匹配当前第 ${currentEpisodeIndex + 1} 集`}
        </button>
      </div>

      {error && (
        <div className='mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-500'>
          {error}
        </div>
      )}

      {currentSelection && (
        <div className='mb-3 rounded-lg border border-green-400/40 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300'>
          <div className='font-semibold'>当前弹幕</div>
          <div className='truncate'>{currentSelection.animeTitle}</div>
          <div className='truncate text-[11px] opacity-80'>{currentSelection.episodeTitle}</div>
          {typeof currentSelection.danmakuCount === 'number' && (
            <div className='opacity-80'>
              {currentSelection.danmakuOriginalCount
                ? `已加载 ${currentSelection.danmakuCount}（原始 ${currentSelection.danmakuOriginalCount}）`
                : `已加载 ${currentSelection.danmakuCount} 条`}
            </div>
          )}
        </div>
      )}

      <div className='min-h-0 flex-1 overflow-y-auto pr-1'>
        {selectedAnime ? (
          <div>
            <button
              onClick={handleBack}
              className='mb-2 text-xs text-blue-600 hover:underline dark:text-blue-400'
            >
              返回搜索结果
            </button>

            <div className='mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100'>
              {selectedAnime.animeTitle}
            </div>

            {isLoadingEpisodes ? (
              <div className='py-8 text-center text-sm text-gray-500'>加载剧集中...</div>
            ) : (
              <div className='space-y-2 pb-2'>
                {episodes.map((episode, index) => {
                  const isActive = currentSelection?.episodeId === episode.episodeId;
                  return (
                    <button
                      key={episode.episodeId}
                      onClick={() => handleEpisodeSelect(episode)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        isActive
                          ? 'border-blue-500 bg-blue-500/15 text-blue-700 dark:text-blue-300'
                          : 'border-gray-200 bg-gray-100 text-gray-800 hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className='font-medium'>#{index + 1}</div>
                      <div className='truncate text-xs opacity-80'>{episode.episodeTitle}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : searchResults.length > 0 ? (
          <div className='space-y-2 pb-2'>
            {searchResults.map((anime) => (
              <button
                key={anime.animeId}
                onClick={() => handleAnimeSelect(anime)}
                className='flex w-full items-start gap-3 rounded-lg bg-gray-100 p-3 text-left transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700'
              >
                {anime.imageUrl ? (
                  <img
                    src={anime.imageUrl}
                    alt={anime.animeTitle}
                    className='h-14 w-10 flex-shrink-0 rounded object-cover'
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}

                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
                    {anime.animeTitle}
                  </div>
                  <div className='mt-1 flex flex-wrap gap-2 text-[11px] text-gray-600 dark:text-gray-400'>
                    <span className='rounded bg-gray-200 px-1.5 py-0.5 dark:bg-gray-700'>
                      {anime.typeDescription || anime.type}
                    </span>
                    {anime.episodeCount ? <span>{anime.episodeCount} 集</span> : null}
                    {anime.startDate ? <span>{anime.startDate}</span> : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className='py-10 text-center text-sm text-gray-500 dark:text-gray-400'>
            输入剧名后搜索弹幕，或使用智能匹配
          </div>
        )}
      </div>

      {onUploadDanmaku && (
        <div className='mt-3 flex-shrink-0 border-t border-gray-200 pt-3 dark:border-gray-700'>
          <input
            ref={fileInputRef}
            type='file'
            accept='.xml'
            onChange={handleFileUpload}
            className='hidden'
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className='w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:text-blue-300'
          >
            搜不到想要的弹幕？上传 XML 弹幕文件
          </button>
        </div>
      )}
    </div>
  );
}


