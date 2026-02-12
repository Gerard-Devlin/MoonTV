/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import artplayerPluginDanmuku from 'artplayer-plugin-danmuku';
import Hls from 'hls.js';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Clock3,
  Film,
  Heart,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Users,
  Zap,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  convertDanmakuFormat,
  getDanmakuById,
  getEpisodes as getDanmakuEpisodes,
  initDanmakuModule,
  loadDanmakuDisplayState,
  loadDanmakuSettings,
  saveDanmakuDisplayState,
  saveDanmakuSettings,
  searchAnime as searchDanmakuAnime,
} from '@/lib/danmaku/api';
import { saveDanmakuToCache } from '@/lib/danmaku/cache';
import {
  isDanmakuBlocked,
  loadDanmakuFilterConfig,
  saveDanmakuFilterConfig,
} from '@/lib/danmaku/filter-config';
import {
  getDanmakuAnimeId,
  getDanmakuSearchKeyword,
  getDanmakuSourceIndex,
  getManualDanmakuSelection,
  saveDanmakuAnimeId,
  saveDanmakuSearchKeyword,
  saveDanmakuSourceIndex,
  saveManualDanmakuSelection,
} from '@/lib/danmaku/selection-memory';
import type {
  DanmakuAnime,
  DanmakuComment,
  DanmakuEpisode,
  DanmakuFilterConfig,
  DanmakuSelection,
  DanmakuSettings,
} from '@/lib/danmaku/types';
import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

import DanmakuFilterSettings from '@/components/DanmakuFilterSettings';
import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

interface TmdbPlayDetail {
  id: number;
  mediaType: 'movie' | 'tv';
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
  cast: Array<{
    id: number;
    name: string;
    character: string;
    profile?: string;
  }>;
  trailerUrl: string;
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);
  const [tmdbDetail, setTmdbDetail] = useState<TmdbPlayDetail | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 跳过检查的时间间隔控制
  const lastSkipCheckRef = useRef(0);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默认 1.0
  const lastPlaybackRateRef = useRef<number>(1.0);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选和测速开关
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  const [danmakuSettings, setDanmakuSettings] = useState<DanmakuSettings>(
    loadDanmakuSettings()
  );
  const [danmakuFilterConfig, setDanmakuFilterConfig] =
    useState<DanmakuFilterConfig>(loadDanmakuFilterConfig());
  const [showDanmakuFilterSettings, setShowDanmakuFilterSettings] =
    useState(false);

  const [currentDanmakuSelection, setCurrentDanmakuSelection] =
    useState<DanmakuSelection | null>(null);
  const [danmakuLoading, setDanmakuLoading] = useState(false);
  const [danmakuCount, setDanmakuCount] = useState(0);
  const [danmakuOriginalCount, setDanmakuOriginalCount] = useState(0);

  const [danmakuMatches, setDanmakuMatches] = useState<DanmakuAnime[]>([]);
  const [showDanmakuSourceSelector, setShowDanmakuSourceSelector] =
    useState(false);

  const danmakuPluginRef = useRef<any>(null);
  const danmakuSettingsRef = useRef<DanmakuSettings>(danmakuSettings);
  const danmakuFilterConfigRef = useRef<DanmakuFilterConfig>(danmakuFilterConfig);
  const danmakuDisplayStateRef = useRef<boolean>(
    (() => {
      const saved = loadDanmakuDisplayState();
      return saved ?? true;
    })()
  );
  const loadingDanmakuEpisodeIdRef = useRef<number | null>(null);
  const lastDanmakuAutoLoadKeyRef = useRef<string>('');

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  const tmdbDetailCacheRef = useRef<Map<string, TmdbPlayDetail | null>>(
    new Map()
  );
  const tmdbDetailRequestIdRef = useRef(0);

  useEffect(() => {
    danmakuSettingsRef.current = danmakuSettings;
    saveDanmakuSettings(danmakuSettings);
  }, [danmakuSettings]);

  useEffect(() => {
    danmakuFilterConfigRef.current = danmakuFilterConfig;
    saveDanmakuFilterConfig(danmakuFilterConfig);
  }, [danmakuFilterConfig]);

  useEffect(() => {
    initDanmakuModule();
  }, []);

  const normalizeCompareText = (value: string): string =>
    (value || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[·•:：\-_.()[\]【】「」『』"'"'`~!@#$%^&*+={}\\/|<>?,;，。！？、]/g, '');

  const toChineseNumeral = (value: number): string => {
    if (!Number.isInteger(value) || value <= 0 || value >= 100) {
      return String(value);
    }
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (value < 10) return digits[value];
    if (value === 10) return '十';
    if (value < 20) return `十${digits[value - 10]}`;
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones > 0 ? digits[ones] : ''}`;
  };

  const normalizeYear = (value?: string): string => {
    const year = (value || '').trim();
    return /^\d{4}$/.test(year) ? year : '';
  };

  const parseChineseNumeral = (value: string): number => {
    const text = (value || '').trim().replace(/两/g, '二');
    if (!text) return 0;
    const map: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    if (text === '十') return 10;
    if (text.includes('十')) {
      const [left, right] = text.split('十');
      const tens = left ? map[left] || 0 : 1;
      const ones = right ? map[right] || 0 : 0;
      return tens * 10 + ones;
    }
    return map[text] || 0;
  };

  const stripSeasonTokens = (value: string): string => {
    const normalized = normalizeCompareText(value);
    return normalized
      .replace(/第[一二三四五六七八九十百千万两\d]+季/g, '')
      .replace(/第\d+部/g, '')
      .replace(/(?:season|series|s)\s*0*\d{1,2}/g, '')
      .replace(/s0*\d{1,2}/g, '')
      .replace(/第[一二三四五六七八九十百千万两\d]+辑/g, '');
  };

  const stripSeasonTokensForQuery = (value: string): string =>
    (value || '')
      .replace(/第\s*[一二三四五六七八九十百千万两\d]+\s*季/gi, ' ')
      .replace(/第\s*\d+\s*部/gi, ' ')
      .replace(/(?:season|series|s)\s*0*\d{1,2}/gi, ' ')
      .replace(/第\s*[一二三四五六七八九十百千万两\d]+\s*辑/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normalizeQueryText = (value: string): string =>
    (value || '').replace(/\s+/g, ' ').trim();

  const expandQueryVariants = (value: string): string[] => {
    const base = normalizeQueryText(value);
    if (!base) return [];

    const variants = new Set<string>();
    const pushVariant = (input: string) => {
      const normalized = normalizeQueryText(input);
      if (!normalized) return;
      variants.add(normalized);
    };

    pushVariant(base);
    pushVariant(base.replace(/\s+/g, ''));

    pushVariant(base.replace(/\s*[：:]\s*/g, ':'));
    pushVariant(base.replace(/\s*[：:]\s*/g, '：'));
    pushVariant(base.replace(/\s*[：:]\s*/g, ' '));
    pushVariant(base.replace(/\s*[：:]\s*/g, ''));

    pushVariant(base.replace(/\s*[-‐‑‒–—]\s*/g, ' '));
    pushVariant(base.replace(/\s*[-‐‑‒–—]\s*/g, ''));
    pushVariant(base.replace(/[·•]/g, ' '));
    pushVariant(base.replace(/[·•]/g, ''));

    pushVariant(
      base
        .replace(/\s*[：:]\s*/g, '')
        .replace(/\s*[-‐‑‒–—]\s*/g, '')
        .replace(/[·•]/g, '')
    );

    return Array.from(variants);
  };

  const extractSeasonHints = (value: string): string[] => {
    const text = value || '';
    const hints = new Set<string>();
    const addSeasonHints = (seasonNumber: number) => {
      if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) return;
      hints.add(`第${seasonNumber}季`);
      hints.add(`第${toChineseNumeral(seasonNumber)}季`);
      hints.add(`S${String(seasonNumber).padStart(2, '0')}`);
      hints.add(`Season ${seasonNumber}`);
    };

    const arabicMatches = text.match(/第\s*(\d{1,2})\s*季/gi) || [];
    arabicMatches.forEach((raw) => {
      const m = raw.match(/(\d{1,2})/);
      if (!m) return;
      const n = Number(m[1]);
      addSeasonHints(n);
    });

    const seasonMatches = text.match(/(?:season|series|s)\s*0*(\d{1,2})/gi) || [];
    seasonMatches.forEach((raw) => {
      const m = raw.match(/(\d{1,2})/);
      if (!m) return;
      const n = Number(m[1]);
      addSeasonHints(n);
    });

    const chineseMatches = text.match(/第\s*([一二三四五六七八九十两]{1,3})\s*季/g) || [];
    chineseMatches.forEach((raw) => {
      const m = raw.match(/([一二三四五六七八九十两]{1,3})/);
      if (!m) return;
      addSeasonHints(parseChineseNumeral(m[1]));
    });

    return Array.from(hints);
  };

  const buildTvQueryCandidates = (
    primaryTitle: string,
    seasonHintText?: string
  ): string[] => {
    const candidates: string[] = [];
    const dedupe = new Set<string>();

    const push = (value: string) => {
      const variants = expandQueryVariants(value);
      if (variants.length === 0) return;
      variants.forEach((normalized) => {
        const key = normalized.toLowerCase();
        if (dedupe.has(key)) return;
        dedupe.add(key);
        candidates.push(normalized);
      });
    };

    const pushRaw = (value: string) => {
      const normalized = value.trim();
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (dedupe.has(key)) return;
      dedupe.add(key);
      candidates.push(normalized);
    };

    push(primaryTitle);
    const baseTitle = primaryTitle || searchTitle || videoTitleRef.current;
    push(baseTitle);

    const seasonHints = extractSeasonHints(
      seasonHintText || primaryTitle || searchTitle || videoTitleRef.current
    );
    const baseNoSeason = stripSeasonTokensForQuery(baseTitle) || baseTitle;
    const compactBaseNoSeason = baseNoSeason.replace(/\s+/g, '').trim();
    seasonHints.forEach((hint) => {
      const compactHint = hint.replace(/\s+/g, '').trim();
      push(`${baseNoSeason} ${hint}`);
      push(`${baseNoSeason}${hint}`);
      if (compactBaseNoSeason && compactHint) {
        pushRaw(`${compactBaseNoSeason}${compactHint}`);
      }
    });

    return candidates;
  };

  const inferTmdbMediaType = (sourceDetail: SearchResult | null): 'movie' | 'tv' => {
    const normalizedType = (searchType || '').trim().toLowerCase();
    if (normalizedType === 'tv') return 'tv';
    if (normalizedType === 'movie') return 'movie';
    if ((sourceDetail?.episodes?.length || 0) > 1) return 'tv';
    return 'movie';
  };

  const buildTmdbTitleCandidates = (
    sourceDetail: SearchResult | null,
    mediaType: 'movie' | 'tv'
  ): string[] => {
    const dedupe = new Set<string>();
    const candidates: string[] = [];

    const push = (value: string) => {
      const variants = expandQueryVariants(value);
      variants.forEach((variant) => {
        const key = variant.toLowerCase();
        if (dedupe.has(key)) return;
        dedupe.add(key);
        candidates.push(variant);
      });
    };

    const baseTitles = [
      sourceDetail?.title || '',
      videoTitleRef.current || '',
      searchTitle || '',
    ];
    baseTitles.forEach((title) => push(title));

    if (mediaType === 'tv') {
      baseTitles.forEach((title) => {
        const stripped = stripSeasonTokensForQuery(title);
        if (stripped && stripped !== normalizeQueryText(title)) {
          push(stripped);
        }
      });
    }

    return candidates;
  };

  const fetchTmdbDetailByParams = async (
    params: URLSearchParams
  ): Promise<TmdbPlayDetail | null> => {
    try {
      const response = await fetch(`/api/tmdb/detail?${params.toString()}`);
      if (!response.ok) return null;
      return (await response.json()) as TmdbPlayDetail;
    } catch {
      return null;
    }
  };

  const resolveTmdbDetailForCurrent = useCallback(
    async (sourceDetail: SearchResult | null): Promise<TmdbPlayDetail | null> => {
      const mediaType = inferTmdbMediaType(sourceDetail);
      const resolvedYear = normalizeYear(sourceDetail?.year || videoYearRef.current);
      const normalizedTitle = normalizeQueryText(
        sourceDetail?.title || videoTitleRef.current || searchTitle || ''
      );

      if (!normalizedTitle && !(sourceDetail?.source === 'tmdb' && sourceDetail.id)) {
        return null;
      }

      const cacheKey = [
        sourceDetail?.source || '',
        sourceDetail?.id || '',
        mediaType,
        resolvedYear,
        normalizedTitle,
      ].join('|');

      if (tmdbDetailCacheRef.current.has(cacheKey)) {
        return tmdbDetailCacheRef.current.get(cacheKey) || null;
      }

      const fallbackPoster = sourceDetail?.poster || videoCover || '';

      if (sourceDetail?.source === 'tmdb' && /^\d+$/.test(sourceDetail.id || '')) {
        const byIdParams = new URLSearchParams({
          id: sourceDetail.id,
          mediaType,
        });
        if (resolvedYear) byIdParams.set('year', resolvedYear);
        if (fallbackPoster) byIdParams.set('poster', fallbackPoster);
        const byIdResult = await fetchTmdbDetailByParams(byIdParams);
        if (byIdResult) {
          tmdbDetailCacheRef.current.set(cacheKey, byIdResult);
          return byIdResult;
        }
      }

      const titleCandidates = buildTmdbTitleCandidates(sourceDetail, mediaType).slice(
        0,
        14
      );
      const yearCandidates = resolvedYear ? [resolvedYear, ''] : [''];

      for (const titleCandidate of titleCandidates) {
        for (const yearCandidate of yearCandidates) {
          const params = new URLSearchParams({
            title: titleCandidate,
            mediaType,
          });
          if (yearCandidate) params.set('year', yearCandidate);
          if (fallbackPoster) params.set('poster', fallbackPoster);
          const result = await fetchTmdbDetailByParams(params);
          if (result) {
            tmdbDetailCacheRef.current.set(cacheKey, result);
            return result;
          }
        }
      }

      tmdbDetailCacheRef.current.set(cacheKey, null);
      return null;
    },
    [searchTitle, searchType, videoCover]
  );

  const filterSearchResults = (
    items: SearchResult[],
    expectedTitle: string,
    expectedYear: string,
    expectedType: string,
    seasonHintText?: string
  ): SearchResult[] => {
    const normalizedExpected = normalizeCompareText(expectedTitle);
    const expectedNoSeason = stripSeasonTokens(expectedTitle);
    const seasonHints = extractSeasonHints(
      seasonHintText || expectedTitle || searchTitle || videoTitleRef.current
    );
    const normalizedSeasonHints = seasonHints
      .map((hint) => normalizeCompareText(hint))
      .filter(Boolean);

    const typeFiltered = items.filter((result) =>
      expectedType
        ? (expectedType === 'tv' && result.episodes.length > 1) ||
          (expectedType === 'movie' && result.episodes.length === 1)
        : true
    );

    const yearFiltered = expectedYear
      ? typeFiltered.filter(
          (result) => result.year.toLowerCase() === expectedYear.toLowerCase()
        )
      : typeFiltered;

    // 两级匹配：先按年份严格匹配，失败再放宽到不限制年份（对分季剧集更稳）
    const pools: SearchResult[][] = expectedYear
      ? [yearFiltered, typeFiltered]
      : [typeFiltered];

    for (const pool of pools) {
      const exactMatches = pool.filter(
        (result) => normalizeCompareText(result.title) === normalizedExpected
      );
      if (exactMatches.length > 0) return exactMatches;

      if (expectedType === 'tv') {
        const fuzzyMatches = pool.filter((result) => {
          const titleNoSeason = stripSeasonTokens(result.title);
          const baseMatch =
            Boolean(titleNoSeason) &&
            Boolean(expectedNoSeason) &&
            (titleNoSeason === expectedNoSeason ||
              titleNoSeason.includes(expectedNoSeason) ||
              expectedNoSeason.includes(titleNoSeason));
          if (!baseMatch) return false;

          if (normalizedSeasonHints.length === 0) return true;

          const normalizedTitle = normalizeCompareText(result.title);
          const resultHints = extractSeasonHints(result.title)
            .map((hint) => normalizeCompareText(hint))
            .filter(Boolean);

          return normalizedSeasonHints.some(
            (hint) =>
              normalizedTitle.includes(hint) || resultHints.includes(hint)
          );
        });
        if (fuzzyMatches.length > 0) return fuzzyMatches;
      }
    }

    return [];
  };

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    // 将播放源均分为两批，并发测速各批，避免一次性过多请求
    const batchSize = Math.ceil(sources.length / 2);
    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    for (let start = 0; start < sources.length; start += batchSize) {
      const batchSources = sources.slice(start, start + batchSize);
      const batchResults = await Promise.all(
        batchSources.map(async (source) => {
          try {
            // 检查是否有第一集的播放地址
            if (!source.episodes || source.episodes.length === 0) {
              console.warn(`播放源 ${source.source_name} 没有可用的播放地址`);
              return null;
            }

            const episodeUrl =
              source.episodes.length > 1
                ? source.episodes[1]
                : source.episodes[0];
            const testResult = await getVideoResolutionFromM3u8(episodeUrl);

            return {
              source,
              testResult,
            };
          } catch (error) {
            return null;
          }
        })
      );
      allResults.push(...batchResults);
    }

    // 等待所有测速完成，包含成功和失败的结果
    // 保存所有测速结果到 precomputedVideoInfo，供 EpisodeSelector 使用（包含错误结果）
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;

      if (result) {
        // 成功的结果
        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    // 过滤出成功的结果用于优选计算
    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) {
      console.warn('所有播放源测速都失败，使用第一个播放源');
      return sources[0];
    }

    // 找出所有有效速度的最大值，用于线性映射
    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '未知' || speedStr === '测量中...') return 0;

        const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value; // 统一转换为 KB/s
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 默认1MB/s作为基准

    // 找出所有有效延迟的最小值和最大值，用于线性映射
    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    // 计算每个结果的评分
    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }));

    // 按综合评分排序，选择最佳播放源
    resultsWithScore.sort((a, b) => b.score - a.score);

    console.log('播放源评分排序结果:');
    resultsWithScore.forEach((result, index) => {
      console.log(
        `${index + 1}. ${
          result.source.source_name
        } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${
          result.testResult.loadSpeed
        }, ${result.testResult.pingTime}ms)`
      );
    });

    return resultsWithScore[0].source;
  };

  // 计算播放源综合评分
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    // 分辨率评分 (40% 权重)
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    // 下载速度评分 (40% 权重) - 基于最大速度线性映射
    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;

      // 解析速度值
      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 基于最大速度线性映射，最高100分
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 网络延迟评分 (20% 权重) - 基于延迟范围线性映射
    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 无效延迟给默认分

      // 如果所有延迟都相同，给满分
      if (maxPing === minPing) return 100;

      // 线性映射：最低延迟=100分，最高延迟=0分
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100; // 保留两位小数
  };

  // 更新视频地址
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  // 去广告相关函数
  function filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 只过滤#EXT-X-DISCONTINUITY标识
      if (!line.includes('#EXT-X-DISCONTINUITY')) {
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        artPlayerRef.current.setting.update({
          name: '跳过片头片尾',
          html: '跳过片头片尾',
          switch: skipConfigRef.current.enable,
          onSwitch: function (item: any) {
            const newConfig = {
              ...skipConfigRef.current,
              enable: !item.switch,
            };
            handleSkipConfigChange(newConfig);
            return !item.switch;
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片头',
          html: '设置片头',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
          tooltip:
            skipConfigRef.current.intro_time === 0
              ? '设置片头时间'
              : `${formatTime(skipConfigRef.current.intro_time)}`,
          onClick: function () {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            if (currentTime > 0) {
              const newConfig = {
                ...skipConfigRef.current,
                intro_time: currentTime,
              };
              handleSkipConfigChange(newConfig);
              return `${formatTime(currentTime)}`;
            }
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片尾',
          html: '设置片尾',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
          tooltip:
            skipConfigRef.current.outro_time >= 0
              ? '设置片尾时间'
              : `-${formatTime(-skipConfigRef.current.outro_time)}`,
          onClick: function () {
            const outroTime =
              -(
                artPlayerRef.current?.duration -
                artPlayerRef.current?.currentTime
              ) || 0;
            if (outroTime < 0) {
              const newConfig = {
                ...skipConfigRef.current,
                outro_time: outroTime,
              };
              handleSkipConfigChange(newConfig);
              return `-${formatTime(-outroTime)}`;
            }
          },
        });
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
      console.log('跳过片头片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (hours === 0) {
      // 不到一小时，格式为 00:00
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      // 超过一小时，格式为 00:00:00
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 拦截manifest和level请求
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any
          ) {
            // 如果是m3u8文件，处理内容以移除广告分段
            if (response.data && typeof response.data === 'string') {
              // 过滤掉广告段 - 实现更精确的广告过滤逻辑
              response.data = filterAdsFromM3U8(response.data);
            }
            return onSuccess(response, stats, context, null);
          };
        }
        // 执行原始load方法
        load(context, config, callbacks);
      };
    }
  }

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // 进入页面时直接获取全部源信息
  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await fetch(
          `/api/detail?source=${source}&id=${id}`
        );
        if (!detailResponse.ok) {
          throw new Error('获取视频详情失败');
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };
    const fetchSourcesData = async (
      query: string,
      expectedTitle: string,
      seasonHintText: string
    ): Promise<SearchResult[]> => {
      // 根据搜索词获取全部源信息
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        // 处理搜索结果：优先精确匹配，剧集再做分季回退匹配
        const results = filterSearchResults(
          data.results,
          expectedTitle,
          videoYearRef.current,
          searchType,
          seasonHintText
        );
        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '正在获取视频详情...'
          : '正在搜索播放源...'
      );

      const initialQuery = (searchTitle || videoTitle).trim();
      const expectedTitleForMatch = (videoTitleRef.current || initialQuery).trim();
      const seasonHintText = (searchTitle || videoTitleRef.current).trim();

      setLoadingMessage('正在搜索播放源...');
      const queryCandidates = buildTvQueryCandidates(
        expectedTitleForMatch || initialQuery,
        seasonHintText
      );
      let sourcesInfo: SearchResult[] = [];
      for (const query of queryCandidates) {
        sourcesInfo = await fetchSourcesData(
          query,
          expectedTitleForMatch || videoTitleRef.current || query,
          seasonHintText
        );
        if (sourcesInfo.length > 0) break;
      }
      if (sourcesInfo.length === 0) {
        console.warn('剧集匹配失败', {
          queryCandidates,
          expectedTitleForMatch,
          seasonHintText,
          expectedYear: videoYearRef.current,
          searchType,
        });
      }
      if (
        currentSource &&
        currentId &&
        !sourcesInfo.some(
          (source) => source.source === currentSource && source.id === currentId
        )
      ) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      // 指定源和id且无需优选
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      // 未指定源和 id 或需要优选，且开启优选开关
      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('正在优选最佳播放源...');

        detailData = await preferBestSource(sourcesInfo);
      }

      console.log(detailData.source, detailData.id);

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 规范URL参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('准备就绪，即将开始播放...');

      // 短暂延迟让用户看到完成状态
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, []);

  // 播放记录处理
  useEffect(() => {
    // 仅在初次挂载时检查播放记录
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1;
          const targetTime = record.play_time;

          // 更新当前选集索引
          if (targetIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(targetIndex);
          }

          // 保存待恢复的播放进度，待播放器就绪后跳转
          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();
  }, []);

  // 跳过片头片尾配置处理
  useEffect(() => {
    // 仅在初次挂载时检查跳过片头片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        }
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };

    initSkipConfig();
  }, []);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }

      // 清除并设置下一个跳过片头片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集数且播放进度有效，则在播放器就绪后恢复到原始进度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    const requestId = ++tmdbDetailRequestIdRef.current;
    setTmdbDetail(null);

    const run = async () => {
      const resolved = await resolveTmdbDetailForCurrent(detailRef.current);
      if (tmdbDetailRequestIdRef.current !== requestId) return;
      setTmdbDetail(resolved);
    };

    void run();
  }, [
    detail?.source,
    detail?.id,
    detail?.title,
    detail?.year,
    detail?.episodes?.length,
    resolveTmdbDetailForCurrent,
  ]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 在更换集数前保存当前播放进度
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  // 保存播放进度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
    };

    // 页面可见性变化时保存播放进度
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  const matchDanmakuEpisode = useCallback(
    (episodeIndex: number, episodes: DanmakuEpisode[]): DanmakuEpisode | null => {
      if (!episodes.length) return null;
      const index = Math.min(Math.max(episodeIndex, 0), episodes.length - 1);
      return episodes[index];
    },
    []
  );

  const loadEpisodesForDanmakuAnime = useCallback(
    async (
      anime: DanmakuAnime
    ): Promise<{ episodes: DanmakuEpisode[]; animeTitle: string; errorMessage: string }> => {
      const idCandidates = Array.from(
        new Set(
          [anime.animeId, anime.bangumiId]
            .map((value) => (value === undefined || value === null ? '' : String(value).trim()))
            .filter(Boolean)
        )
      );

      let lastErrorMessage = '';
      for (const idText of idCandidates) {
        const numericId = Number(idText);
        const requestId = Number.isNaN(numericId) ? idText : numericId;
        const response = await getDanmakuEpisodes(requestId);
        if (response.success && response.bangumi.episodes.length > 0) {
          return {
            episodes: response.bangumi.episodes,
            animeTitle: response.bangumi.animeTitle || anime.animeTitle,
            errorMessage: '',
          };
        }

        if (response.errorMessage) {
          lastErrorMessage = response.errorMessage;
        }
      }

      return {
        episodes: [],
        animeTitle: anime.animeTitle,
        errorMessage: lastErrorMessage || '该弹幕源没有剧集信息',
      };
    },
    []
  );

  const normalizeDanmakuData = useCallback((input: Array<any>) => {
    const rawCount = input.length;
    const filtered = input.filter(
      (item) => !isDanmakuBlocked(item.text, danmakuFilterConfigRef.current)
    );

    let processed = filtered;
    const maxCount =
      typeof window !== 'undefined'
        ? Number.parseInt(localStorage.getItem('danmakuMaxCount') || '0', 10)
        : 0;

    if (maxCount > 0 && processed.length > maxCount) {
      const sampled: typeof processed = [];
      const step = processed.length / maxCount;
      for (let i = 0; i < maxCount; i += 1) {
        sampled.push(processed[Math.floor(i * step)]);
      }
      processed = sampled;
    }

    const originalCount = processed.length === rawCount ? 0 : rawCount;
    return {
      processed,
      originalCount,
    };
  }, []);

  const applyDanmakuToPlayer = useCallback(
    (danmakuData: Array<any>) => {
      if (!danmakuPluginRef.current) return;

      danmakuPluginRef.current.reset();
      danmakuPluginRef.current.config({
        danmuku: danmakuData,
        speed: danmakuSettingsRef.current.speed,
        opacity: danmakuSettingsRef.current.opacity,
        fontSize: danmakuSettingsRef.current.fontSize,
        margin: [
          danmakuSettingsRef.current.marginTop,
          danmakuSettingsRef.current.marginBottom,
        ],
      });
      danmakuPluginRef.current.load();

      const savedDisplayState = loadDanmakuDisplayState();
      const shouldShow = savedDisplayState === null ? true : savedDisplayState;
      danmakuDisplayStateRef.current = shouldShow;
      if (shouldShow) {
        danmakuPluginRef.current.show();
      } else {
        danmakuPluginRef.current.hide();
      }
    },
    []
  );

  const handleDanmakuSelect = useCallback(
    async (selection: DanmakuSelection, isManual = false) => {
      if (!danmakuPluginRef.current) {
        return;
      }

      const title = (videoTitleRef.current || '').trim();
      const episodeIndex = currentEpisodeIndexRef.current;

      if (isManual && title && episodeIndex >= 0) {
        saveManualDanmakuSelection(title, episodeIndex, selection.episodeId);
        saveDanmakuAnimeId(title, selection.animeId);
        if (selection.searchKeyword) {
          saveDanmakuSearchKeyword(title, selection.searchKeyword);
        }
      }

      if (loadingDanmakuEpisodeIdRef.current === selection.episodeId) {
        return;
      }

      loadingDanmakuEpisodeIdRef.current = selection.episodeId;
      setDanmakuLoading(true);

      try {
        const comments = await getDanmakuById(selection.episodeId, title, episodeIndex, {
          animeId: selection.animeId,
          animeTitle: selection.animeTitle,
          episodeTitle: selection.episodeTitle,
          searchKeyword: selection.searchKeyword,
        });

        const formatted = convertDanmakuFormat(comments);
        const { processed, originalCount } = normalizeDanmakuData(formatted);

        applyDanmakuToPlayer(processed);

        setDanmakuCount(processed.length);
        setDanmakuOriginalCount(originalCount);
        setCurrentDanmakuSelection({
          ...selection,
          danmakuCount: processed.length,
          danmakuOriginalCount: originalCount > 0 ? originalCount : undefined,
        });
      } catch (error) {
        console.error('Load danmaku failed:', error);
        setDanmakuCount(0);
        setDanmakuOriginalCount(0);
      } finally {
        setDanmakuLoading(false);
        loadingDanmakuEpisodeIdRef.current = null;
      }
    },
    [applyDanmakuToPlayer, normalizeDanmakuData]
  );

  const handleDanmakuSourceSelect = useCallback(
    async (
      anime: DanmakuAnime,
      selectedIndex?: number,
      searchKeyword?: string,
      isManualSearch = false
    ) => {
      setShowDanmakuSourceSelector(false);
      setDanmakuMatches([]);

      const title = (videoTitleRef.current || '').trim();

      if (title && typeof selectedIndex === 'number') {
        saveDanmakuSourceIndex(title, selectedIndex);
      }

      try {
        const loaded = await loadEpisodesForDanmakuAnime(anime);
        if (loaded.episodes.length === 0) {
          console.error('Select danmaku source has no episodes:', loaded.errorMessage);
          return;
        }

        const episode = matchDanmakuEpisode(
          currentEpisodeIndexRef.current,
          loaded.episodes
        );
        if (!episode) return;

        await handleDanmakuSelect(
          {
            animeId: anime.animeId,
            episodeId: episode.episodeId,
            animeTitle: loaded.animeTitle,
            episodeTitle: episode.episodeTitle,
            searchKeyword,
          },
          isManualSearch
        );
      } catch (error) {
        console.error('Select danmaku source failed:', error);
      }
    },
    [handleDanmakuSelect, loadEpisodesForDanmakuAnime, matchDanmakuEpisode]
  );

  const autoLoadDanmakuForCurrentEpisode = useCallback(async () => {
    if (!danmakuPluginRef.current) return;

    const title = (videoTitleRef.current || '').trim();
    if (!title) return;

    if (typeof window !== 'undefined') {
      const disableAutoLoad = localStorage.getItem('disableAutoLoadDanmaku') === 'true';
      if (disableAutoLoad) return;
    }

    const episodeIndex = currentEpisodeIndexRef.current;
    if (episodeIndex < 0) return;

    const loadKey = `${currentSourceRef.current}|${currentIdRef.current}|${title}|${episodeIndex}`;
    if (lastDanmakuAutoLoadKeyRef.current === loadKey) return;
    lastDanmakuAutoLoadKeyRef.current = loadKey;

    const manualEpisodeId = getManualDanmakuSelection(title, episodeIndex);
    if (manualEpisodeId) {
      await handleDanmakuSelect(
        {
          animeId: currentDanmakuSelection?.animeId || 0,
          episodeId: manualEpisodeId,
          animeTitle: currentDanmakuSelection?.animeTitle || '手动选择',
          episodeTitle: `第 ${episodeIndex + 1} 集`,
          searchKeyword: currentDanmakuSelection?.searchKeyword,
        },
        false
      );
      return;
    }

    const rememberedAnimeId = getDanmakuAnimeId(title);
    if (rememberedAnimeId) {
      try {
        const episodesResponse = await getDanmakuEpisodes(rememberedAnimeId);
        if (episodesResponse.success && episodesResponse.bangumi.episodes.length > 0) {
          const episode = matchDanmakuEpisode(
            episodeIndex,
            episodesResponse.bangumi.episodes
          );
          if (episode) {
            await handleDanmakuSelect(
              {
                animeId: rememberedAnimeId,
                episodeId: episode.episodeId,
                animeTitle: episodesResponse.bangumi.animeTitle,
                episodeTitle: episode.episodeTitle,
                searchKeyword: getDanmakuSearchKeyword(title) || undefined,
              },
              false
            );
            return;
          }
        }
      } catch (error) {
        console.error('Load remembered danmaku failed:', error);
      }
    }

    const searchKeyword = getDanmakuSearchKeyword(title) || searchTitle || title;
    const searchResponse = await searchDanmakuAnime(searchKeyword);
    if (!searchResponse.success || searchResponse.animes.length === 0) {
      return;
    }

    const rememberedSourceIndex = getDanmakuSourceIndex(title);
    if (
      rememberedSourceIndex !== null &&
      searchResponse.animes[rememberedSourceIndex]
    ) {
      await handleDanmakuSourceSelect(
        searchResponse.animes[rememberedSourceIndex],
        rememberedSourceIndex,
        searchKeyword,
        false
      );
      return;
    }

    if (searchResponse.animes.length > 1) {
      setDanmakuMatches(searchResponse.animes);
      setShowDanmakuSourceSelector(true);
      return;
    }

    await handleDanmakuSourceSelect(searchResponse.animes[0], 0, searchKeyword, false);
  }, [
    currentDanmakuSelection?.animeId,
    currentDanmakuSelection?.animeTitle,
    currentDanmakuSelection?.searchKeyword,
    handleDanmakuSelect,
    handleDanmakuSourceSelect,
    matchDanmakuEpisode,
    searchTitle,
  ]);

  const handleUploadDanmaku = useCallback(
    async (comments: DanmakuComment[]) => {
      if (!danmakuPluginRef.current) return;

      const title = (videoTitleRef.current || '').trim();
      const episodeIndex = currentEpisodeIndexRef.current;

      setDanmakuLoading(true);
      try {
        if (title && episodeIndex >= 0) {
          await saveDanmakuToCache(title, episodeIndex, comments, {
            animeId: currentDanmakuSelection?.animeId,
            episodeId: currentDanmakuSelection?.episodeId,
            animeTitle: currentDanmakuSelection?.animeTitle,
            episodeTitle: currentDanmakuSelection?.episodeTitle,
            searchKeyword: currentDanmakuSelection?.searchKeyword,
          });
        }

        const formatted = convertDanmakuFormat(comments);
        const { processed, originalCount } = normalizeDanmakuData(formatted);
        applyDanmakuToPlayer(processed);

        setDanmakuCount(processed.length);
        setDanmakuOriginalCount(originalCount);
        setCurrentDanmakuSelection((prev) =>
          prev
            ? {
                ...prev,
                danmakuCount: processed.length,
                danmakuOriginalCount: originalCount > 0 ? originalCount : undefined,
              }
            : prev
        );
      } catch (error) {
        console.error('Upload danmaku failed:', error);
      } finally {
        setDanmakuLoading(false);
      }
    },
    [
      applyDanmakuToPlayer,
      currentDanmakuSelection,
      normalizeDanmakuData,
    ]
  );

  useEffect(() => {
    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 非WebKit浏览器且播放器已存在，使用switch方法切换
    if (!isWebkit && artPlayerRef.current) {
      artPlayerRef.current.switch = videoUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = videoCover;
      if (danmakuPluginRef.current) {
        danmakuPluginRef.current.reset();
        setDanmakuCount(0);
        setDanmakuOriginalCount(0);
      }
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
      lastDanmakuAutoLoadKeyRef.current = '';
      setTimeout(() => {
        autoLoadDanmakuForCurrentEpisode();
      }, 50);
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    if (artPlayerRef.current) {
      if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
        artPlayerRef.current.video.hls.destroy();
      }
      // 销毁播放器实例
      artPlayerRef.current.destroy();
      artPlayerRef.current = null;
      danmakuPluginRef.current = null;
    }

    try {
      // 创建新的播放器实例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = true;

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: '#557efc',
        lang: 'zh-cn',
        hotkey: false,
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
        },
        // HLS 支持配置
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string) {
            if (!Hls) {
              console.error('HLS.js 未加载');
              return;
            }

            if (video.hls) {
              video.hls.destroy();
            }
            const hls = new Hls({
              debug: false, // 关闭日志
              enableWorker: true, // WebWorker 解码，降低主线程压力
              lowLatencyMode: true, // 开启低延迟 LL-HLS

              /* 缓冲/内存相关 */
              maxBufferLength: 30, // 前向缓冲最大 30s，过大容易导致高延迟
              backBufferLength: 30, // 仅保留 30s 已播放内容，避免内存占用
              maxBufferSize: 60 * 1000 * 1000, // 约 60MB，超出后触发清理

              /* 自定义loader */
              loader: blockAdEnabledRef.current
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader,
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            ensureVideoSource(video, url);

            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              console.error('HLS Error:', event, data);
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('网络错误，尝试恢复...');
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('媒体错误，尝试恢复...');
                    hls.recoverMediaError();
                    break;
                  default:
                    console.log('无法恢复的错误');
                    hls.destroy();
                    break;
                }
              }
            });
          },
        },
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        plugins: [
          artplayerPluginDanmuku({
            danmuku: [],
            speed: danmakuSettingsRef.current.speed,
            opacity: danmakuSettingsRef.current.opacity,
            fontSize: danmakuSettingsRef.current.fontSize,
            color: '#FFFFFF',
            mode: 0,
            margin: [
              danmakuSettingsRef.current.marginTop,
              danmakuSettingsRef.current.marginBottom,
            ],
            antiOverlap: true,
            synchronousPlayback: danmakuSettingsRef.current.synchronousPlayback,
            emitter: false,
            visible: danmakuDisplayStateRef.current,
            filter: (danmu: any) =>
              !isDanmakuBlocked(danmu.text || '', danmakuFilterConfigRef.current),
          }),
        ],
        settings: [
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已开启' : '已关闭',
            onClick() {
              const newVal = !blockAdEnabled;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (
                    artPlayerRef.current.video &&
                    artPlayerRef.current.video.hls
                  ) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal);
              } catch (_) {
                // ignore
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
          {
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '删除跳过配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          {
            name: '设置片头',
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                };
                handleSkipConfigChange(newConfig);
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            name: '设置片尾',
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '设置片尾时间'
                : `-${formatTime(-skipConfigRef.current.outro_time)}`,
            onClick: function () {
              const outroTime =
                -(
                  artPlayerRef.current?.duration -
                  artPlayerRef.current?.currentTime
                ) || 0;
              if (outroTime < 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  outro_time: outroTime,
                };
                handleSkipConfigChange(newConfig);
                return `-${formatTime(-outroTime)}`;
              }
            },
          },
          {
            name: '弹幕屏蔽',
            html: '弹幕屏蔽',
            tooltip: `规则数: ${danmakuFilterConfigRef.current.rules.length}`,
            onClick: function () {
              setShowDanmakuFilterSettings(true);
              return '';
            },
          },
        ],
        // 控制栏配置
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
        ],
      });

      if (artPlayerRef.current?.plugins?.artplayerPluginDanmuku) {
        danmakuPluginRef.current = artPlayerRef.current.plugins.artplayerPluginDanmuku;

        artPlayerRef.current.on('artplayerPluginDanmuku:config', () => {
          if (!danmakuPluginRef.current?.option) return;

          const option = danmakuPluginRef.current.option;
          const nextSettings: DanmakuSettings = {
            ...danmakuSettingsRef.current,
            opacity: option.opacity ?? danmakuSettingsRef.current.opacity,
            fontSize: option.fontSize ?? danmakuSettingsRef.current.fontSize,
            speed: option.speed ?? danmakuSettingsRef.current.speed,
            marginTop: option.margin?.[0] ?? danmakuSettingsRef.current.marginTop,
            marginBottom:
              option.margin?.[1] ?? danmakuSettingsRef.current.marginBottom,
          };

          setDanmakuSettings(nextSettings);
        });

        artPlayerRef.current.on('artplayerPluginDanmuku:show', () => {
          danmakuDisplayStateRef.current = true;
          saveDanmakuDisplayState(true);
        });

        artPlayerRef.current.on('artplayerPluginDanmuku:hide', () => {
          danmakuDisplayStateRef.current = false;
          saveDanmakuDisplayState(false);
        });
      }

      // 监听播放器事件
      artPlayerRef.current.on('ready', () => {
        setError(null);
        setTimeout(() => {
          autoLoadDanmakuForCurrentEpisode();
        }, 100);
      });

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
      });

      // 监听视频可播放事件，这时恢复播放进度更可靠
      artPlayerRef.current.on('video:canplay', () => {
        // 若存在需要恢复的播放进度，则跳转
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('成功恢复播放进度到:', resumeTimeRef.current);
          } catch (err) {
            console.warn('恢复播放进度失败:', err);
          }
        }
        resumeTimeRef.current = null;

        setTimeout(() => {
          if (
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          if (
            Math.abs(
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
            ) > 0.01 &&
            isWebkit
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
          artPlayerRef.current.notice.show = '';
        }, 0);

        // 隐藏换源加载状态
        setIsVideoLoading(false);
      });

      // 监听视频时间更新事件，实现跳过片头片尾
      artPlayerRef.current.on('video:timeupdate', () => {
        if (!skipConfigRef.current.enable) return;

        const currentTime = artPlayerRef.current.currentTime || 0;
        const duration = artPlayerRef.current.duration || 0;
        const now = Date.now();

        // 限制跳过检查频率为1.5秒一次
        if (now - lastSkipCheckRef.current < 1500) return;
        lastSkipCheckRef.current = now;

        // 跳过片头
        if (
          skipConfigRef.current.intro_time > 0 &&
          currentTime < skipConfigRef.current.intro_time
        ) {
          artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
          artPlayerRef.current.notice.show = `已跳过片头 (${formatTime(
            skipConfigRef.current.intro_time
          )})`;
        }

        // 跳过片尾
        if (
          skipConfigRef.current.outro_time < 0 &&
          duration > 0 &&
          currentTime >
            artPlayerRef.current.duration + skipConfigRef.current.outro_time
        ) {
          if (
            currentEpisodeIndexRef.current <
            (detailRef.current?.episodes?.length || 1) - 1
          ) {
            handleNextEpisode();
          } else {
            artPlayerRef.current.pause();
          }
          artPlayerRef.current.notice.show = `已跳过片尾 (${formatTime(
            skipConfigRef.current.outro_time
          )})`;
        }
      });

      artPlayerRef.current.on('error', (err: any) => {
        console.error('播放器错误:', err);
        if (artPlayerRef.current.currentTime > 0) {
          return;
        }
      });

      // 监听视频播放结束事件，自动播放下一集
      artPlayerRef.current.on('video:ended', () => {
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          setTimeout(() => {
            setCurrentEpisodeIndex(idx + 1);
          }, 1000);
        }
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        const now = Date.now();
        let interval = 5000;
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'd1') {
          interval = 10000;
        }
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
          interval = 20000;
        }
        if (now - lastSaveTimeRef.current > interval) {
          saveCurrentPlayProgress();
          lastSaveTimeRef.current = now;
        }
      });

      artPlayerRef.current.on('pause', () => {
        saveCurrentPlayProgress();
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
    } catch (err) {
      console.error('创建播放器失败:', err);
      setError('播放器初始化失败');
    }
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled]);

  useEffect(() => {
    if (!danmakuPluginRef.current) return;
    autoLoadDanmakuForCurrentEpisode();
  }, [
    currentEpisodeIndex,
    currentSource,
    currentId,
    videoTitle,
    videoUrl,
    autoLoadDanmakuForCurrentEpisode,
  ]);

  // 当组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  const LoadingIcon =
    loadingStage === 'preferring'
      ? Zap
      : loadingStage === 'fetching'
      ? Film
      : loadingStage === 'ready'
      ? Sparkles
      : Search;
  const VideoLoadingIcon = RefreshCw;

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='relative flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6 w-full'>
            <div className='flex justify-center mb-8'>
              {/* From Uiverse.io by jaykdoe */}
              <div className='stack' aria-hidden='true'>
                <div className='stack__card'></div>
                <div className='stack__card'></div>
                <div className='stack__card'></div>
                <div className='stack__card'></div>
                <div className='stack__card'></div>
              </div>
            </div>

            {/* 加载消息 */}
            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                <span className='inline-flex items-center gap-2'>
                  <LoadingIcon className='h-5 w-5' />
                  {loadingMessage}
                </span>
              </p>
            </div>
          </div>

        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex min-h-screen items-center justify-center bg-transparent px-6 py-12'>
          <div className='w-full max-w-xs rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-xl backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-950/70 sm:p-8'>
            <div className='flex flex-col gap-6 text-center'>
              <div className='flex flex-col items-center gap-3'>
                <div className='flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/15'>
                  <AlertTriangle className='h-10 w-10 text-rose-500' />
                </div>
                <div>
                  <h2 className='text-2xl font-semibold text-slate-900 dark:text-slate-100'>
                    哎呀，出现了一些问题
                  </h2>
                  <p className='mt-1 text-sm text-slate-500 dark:text-slate-400'>
                    播放源暂时不可用或没有匹配结果。
                  </p>
                </div>
              </div>

              <div className='grid gap-3'>
                <button
                  onClick={() =>
                    videoTitle
                      ? router.push(
                          `/search?q=${encodeURIComponent(videoTitle)}`
                        )
                      : router.back()
                  }
                  className='group inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700/90 bg-slate-800 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800'
                >
                  {videoTitle ? (
                    <Search className='h-4 w-4 text-white transition-transform duration-200 group-hover:scale-110' />
                  ) : (
                    <ArrowLeft className='h-4 w-4 text-white transition-transform duration-200 group-hover:-translate-x-0.5' />
                  )}
                  {videoTitle ? '返回搜索' : '返回上页'}
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className='group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300'
                >
                  <RefreshCw className='h-4 w-4 transition-transform duration-200 group-hover:rotate-180' />
                  重新尝试
                </button>
              </div>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  const displayTitle = tmdbDetail?.title || videoTitle || detail?.title || '影片标题';
  const displayYear = tmdbDetail?.year || detail?.year || videoYear;
  const displayOverview = tmdbDetail?.overview || detail?.desc || '';
  const displayPoster = tmdbDetail?.poster || tmdbDetail?.backdrop || videoCover;
  const displayType =
    tmdbDetail?.mediaType === 'tv'
      ? '剧集'
      : tmdbDetail?.mediaType === 'movie'
      ? '电影'
      : detail?.type_name || '';
  const displayGenres = tmdbDetail?.genres || [];
  const displayCast = tmdbDetail?.cast || [];
  const playBackground = tmdbDetail?.backdrop || tmdbDetail?.poster || '';

  return (
    <PageLayout activePath='/play' disableMobileTopPadding>
      <div className='relative'>
        {playBackground ? (
          <div className='pointer-events-none absolute inset-0 -z-10 overflow-hidden'>
            <img
              src={processImageUrl(playBackground)}
              alt=''
              aria-hidden='true'
              className='h-full w-full object-cover object-center brightness-[0.38]'
            />
            <div className='absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent' />
            <div className='absolute inset-0 bg-gradient-to-r from-black/50 to-transparent' />
          </div>
        ) : null}

        <div className='relative z-[1] flex flex-col gap-3 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-4 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：影片标题 */}
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {displayTitle}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>
                {` > 第 ${currentEpisodeIndex + 1} 集`}
              </span>
            )}
          </h1>
        </div>
        {/* 第二行：播放器和选集 */}
        <div className='space-y-2'>
          {/* 折叠控制 - 仅在 lg 及以上屏幕显示 */}
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                  isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>

              {/* 精致的状态指示点 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
                  isEpisodeSelectorCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-blue-400'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            {/* 播放器 */}
            <div
              className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>

                {/* 换源加载蒙层 */}
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <svg
                        className='play-heart'
                        viewBox='-5 -5 278 56'
                        version='1.1'
                        xmlns='http://www.w3.org/2000/svg'
                        aria-hidden='true'
                      >
                        <filter id='blur'>
                          <feGaussianBlur stdDeviation='1.6'></feGaussianBlur>
                        </filter>
                        <g transform='translate(29.1 -127.42)'>
                          <path
                            pathLength='1'
                            d='M-28.73 167.2c26.43 9.21 68.46-9.46 85.45-12.03 18.45-2.78 32.82 4.86 28.75 9.83-3.82 4.66-25.77-21.18-14.81-31.5 9.54-8.98 17.64 10.64 16.42 17.06-1.51-6.2 2.95-26.6 14.74-22.11 11.7 4.46-4.33 49.03-15.44 44.08-6.97-3.1 15.44-16.26 26.1-16 23.03.56 55.6 27.51 126.63 3.36'
                            id='line'
                          ></path>
                        </g>
                        <g transform='translate(29.1 -127.42)'>
                          <path
                            pathLength='1'
                            d='M-28.73 167.2c26.43 9.21 68.46-9.46 85.45-12.03 18.45-2.78 32.82 4.86 28.75 9.83-3.82 4.66-25.77-21.18-14.81-31.5 9.54-8.98 17.64 10.64 16.42 17.06-1.51-6.2 2.95-26.6 14.74-22.11 11.7 4.46-4.33 49.03-15.44 44.08-6.97-3.1 15.44-16.26 26.1-16 23.03.56 55.6 27.51 126.63 3.36'
                            id='point'
                            filter='url(#blur)'
                          ></path>
                        </g>
                      </svg>

                      {/* 换源消息 */}
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          <span className='inline-flex items-center gap-2'>
                            <VideoLoadingIcon className='h-5 w-5 animate-spin' />
                            {videoLoadingStage === 'sourceChanging'
                              ? '切换播放源...'
                              : '视频加载中...'}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {danmakuLoading && !isVideoLoading && (
                  <div className='pointer-events-none absolute inset-0 z-[450] flex items-center justify-center rounded-xl bg-black/45 backdrop-blur-sm'>
                    <div className='rounded-lg border border-white/20 bg-black/60 px-4 py-2 text-center text-sm text-white'>
                      {danmakuCount > 0
                        ? danmakuOriginalCount > 0
                          ? `已加载 ${danmakuCount} 条弹幕（原始 ${danmakuOriginalCount} 条）`
                          : `已加载 ${danmakuCount} 条弹幕`
                        : '加载弹幕中...'}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 选集和换源 - 在移动端始终显示，在 lg 及以上可折叠 */}
            <div
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
                onDanmakuSelect={(selection) => handleDanmakuSelect(selection, true)}
                currentDanmakuSelection={currentDanmakuSelection}
                onUploadDanmaku={handleUploadDanmaku}
              />
            </div>
          </div>
        </div>

        {/* 详情展示 */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          {/* 文字区 */}
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              {/* 标题 */}
              <div
                className={`flex w-full items-center ${
                  tmdbDetail?.logo ? 'mb-1' : 'mb-3'
                }`}
              >
                <div className='min-w-0 flex-1'>
                  {tmdbDetail?.logo ? (
                    <>
                      <img
                        src={processImageUrl(tmdbDetail.logo)}
                        alt={`${displayTitle} logo`}
                        className='mx-0 h-16 w-auto max-w-full object-contain object-left drop-shadow-[0_8px_20px_rgba(0,0,0,0.45)] md:h-20'
                      />
                      <h1 className='sr-only'>{displayTitle}</h1>
                    </>
                  ) : (
                    <h1 className='text-3xl font-bold tracking-wide text-center md:text-left'>
                      {displayTitle}
                    </h1>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
                >
                  <FavoriteIcon filled={favorited} />
                </button>
              </div>

              {/* 关键信息行 */}
              <div className='mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-800/90 dark:text-white/90 flex-shrink-0'>
                {tmdbDetail?.score && (
                  <span className='inline-flex items-center gap-1 text-yellow-500 dark:text-yellow-400 font-semibold'>
                    <Star size={14} fill='currentColor' />
                    {tmdbDetail.score}
                    {tmdbDetail.voteCount > 0 ? ` (${tmdbDetail.voteCount})` : ''}
                  </span>
                )}
                {displayYear && (
                  <span className='inline-flex items-center gap-1 text-gray-700/80 dark:text-white/80'>
                    <CalendarDays size={14} />
                    {displayYear}
                  </span>
                )}
                {tmdbDetail?.runtime ? (
                  <span className='inline-flex items-center gap-1 text-gray-700/80 dark:text-white/80'>
                    <Clock3 size={14} />
                    {tmdbDetail.runtime}min
                  </span>
                ) : null}
                {tmdbDetail?.mediaType === 'tv' &&
                tmdbDetail.seasons &&
                tmdbDetail.episodes ? (
                  <span className='inline-flex items-center gap-1 text-gray-700/80 dark:text-white/80'>
                    <Users size={14} />
                    {tmdbDetail.seasons} Seasons / {tmdbDetail.episodes} Episodes
                  </span>
                ) : null}
                {displayType && (
                  <span className='rounded border border-gray-500/40 bg-white/55 px-1.5 py-0.5 text-[11px] font-medium text-gray-800/95 backdrop-blur-md dark:border-white/35 dark:bg-slate-900/45 dark:text-white/95'>
                    {displayType}
                  </span>
                )}
                {tmdbDetail?.contentRating && (
                  <span className='rounded border border-gray-500/40 bg-white/55 px-1.5 py-0.5 text-[11px] font-medium text-gray-800/95 backdrop-blur-md dark:border-white/35 dark:bg-slate-900/45 dark:text-white/95'>
                    {tmdbDetail.contentRating}
                  </span>
                )}
              </div>
              {displayGenres.length > 0 ? (
                <div className='mt-1 flex flex-wrap gap-2'>
                  {displayGenres.map((genre) => (
                    <span
                      key={`tmdb-genre-${genre}`}
                      className='rounded-full border border-gray-500/40 bg-white/55 px-2.5 py-1 text-xs text-gray-800/90 backdrop-blur-md dark:border-white/25 dark:bg-slate-900/45 dark:text-white/90'
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              ) : null}
              {/* 剧情简介 */}
              {displayOverview && (
                  <p
                    className='mt-3 text-sm leading-6 text-gray-700/90 dark:text-white/85 sm:text-base'
                    style={{ whiteSpace: 'pre-line' }}
                  >
                  {displayOverview}
                </p>
              )}
              {displayCast.length > 0 ? (
                <div className='mt-4 space-y-2'>
                  <p className='text-sm font-semibold text-gray-900/90 dark:text-white/90'>
                    主演
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    {displayCast.slice(0, 12).map((item) => (
                      <button
                        type='button'
                        key={`play-cast-${item.id}-${item.name}`}
                        onClick={() => router.push(`/person/${item.id}`)}
                        className='rounded-full border border-gray-500/40 bg-white/55 px-2.5 py-1 text-xs text-gray-800/90 backdrop-blur-md transition-colors hover:bg-white/75 dark:border-white/25 dark:bg-slate-900/45 dark:text-white/90 dark:hover:bg-slate-900/65'
                      >
                        {item.name}
                        {item.character ? ` · ${item.character}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* 封面展示 */}
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                {displayPoster ? (
                  <img
                    src={processImageUrl(displayPoster)}
                    alt={displayTitle}
                    className='w-full h-full object-cover'
                  />
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      {showDanmakuSourceSelector && danmakuMatches.length > 0 && (
        <div className='fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm'>
          <div className='w-full max-w-2xl overflow-hidden rounded-xl border border-white/20 bg-white shadow-2xl dark:bg-gray-900'>
            <div className='border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100'>
              选择弹幕源
            </div>
            <div className='max-h-[60vh] space-y-2 overflow-y-auto p-3'>
              {danmakuMatches.map((anime, index) => (
                <button
                  key={`${anime.animeId}_${index}`}
                  onClick={() =>
                    handleDanmakuSourceSelect(
                      anime,
                      index,
                      getDanmakuSearchKeyword(videoTitleRef.current || '') ||
                        searchTitle ||
                        videoTitleRef.current ||
                        ''
                    )
                  }
                  className='flex w-full items-start gap-3 rounded-lg bg-gray-100 p-3 text-left transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700'
                >
                  {anime.imageUrl ? (
                    <img
                      src={anime.imageUrl}
                      alt={anime.animeTitle}
                      className='h-14 w-10 flex-shrink-0 rounded object-cover'
                    />
                  ) : null}
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      {anime.animeTitle}
                    </div>
                    <div className='mt-1 text-xs text-gray-600 dark:text-gray-400'>
                      {anime.typeDescription || anime.type}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className='border-t border-gray-200 p-3 dark:border-gray-700'>
              <button
                onClick={() => {
                  setShowDanmakuSourceSelector(false);
                  setDanmakuMatches([]);
                }}
                className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <DanmakuFilterSettings
        isOpen={showDanmakuFilterSettings}
        config={danmakuFilterConfig}
        onChange={(config) => {
          setDanmakuFilterConfig(config);
          danmakuFilterConfigRef.current = config;
          if (danmakuPluginRef.current) {
            try {
              danmakuPluginRef.current.load();
            } catch (error) {
              console.error('Reload danmaku after filter update failed:', error);
            }
          }
        }}
        onClose={() => setShowDanmakuFilterSettings(false)}
      />
    </PageLayout>
  );
}

// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444' /* Tailwind red-500 */
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
