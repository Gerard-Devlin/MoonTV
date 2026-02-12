/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { DanmakuComment, DanmakuSelection } from '@/lib/danmaku/types';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

import DanmakuPanel from '@/components/DanmakuPanel';

// 瀹氫箟瑙嗛淇℃伅绫诲瀷
interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean; // 娣诲姞閿欒鐘舵€佹爣璇?
}

interface EpisodeSelectorProps {
  /** 鎬婚泦鏁?*/
  totalEpisodes: number;
  /** 姣忛〉鏄剧ず澶氬皯闆嗭紝榛樿 50 */
  episodesPerPage?: number;
  /** 褰撳墠閫変腑鐨勯泦鏁帮紙1 寮€濮嬶級 */
  value?: number;
  /** 鐢ㄦ埛鐐瑰嚮閫夐泦鍚庣殑鍥炶皟 */
  onChange?: (episodeNumber: number) => void;
  /** 鎹㈡簮鐩稿叧 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 棰勮绠楃殑娴嬮€熺粨鏋滐紝閬垮厤閲嶅娴嬮€?*/
  precomputedVideoInfo?: Map<string, VideoInfo>;
  onDanmakuSelect?: (selection: DanmakuSelection) => void;
  currentDanmakuSelection?: DanmakuSelection | null;
  onUploadDanmaku?: (comments: DanmakuComment[]) => void;
}

/**
 * 閫夐泦缁勪欢锛屾敮鎸佸垎椤点€佽嚜鍔ㄦ粴鍔ㄨ仛鐒﹀綋鍓嶅垎椤垫爣绛撅紝浠ュ強鎹㈡簮鍔熻兘銆?
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
  onDanmakuSelect,
  currentDanmakuSelection,
  onUploadDanmaku,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // 瀛樺偍姣忎釜婧愮殑瑙嗛淇℃伅
  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map()
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );

  // 浣跨敤 ref 鏉ラ伩鍏嶉棴鍖呴棶棰?
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  // 鍚屾鐘舵€佸埌 ref
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  // 涓昏鐨?tab 鐘舵€侊細'episodes' 鎴?'sources'
  // 褰撳彧鏈変竴闆嗘椂榛樿灞曠ず "鎹㈡簮"锛屽苟闅愯棌 "閫夐泦" 鏍囩
  const [activeTab, setActiveTab] = useState<'danmaku' | 'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources'
  );

  // 褰撳墠鍒嗛〉绱㈠紩锛? 寮€濮嬶級
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // 鏄惁鍊掑簭鏄剧ず
  const [descending, setDescending] = useState<boolean>(false);

  // 鏍规嵁 descending 鐘舵€佽绠楀疄闄呮樉绀虹殑鍒嗛〉绱㈠紩
  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  // 鑾峰彇瑙嗛淇℃伅鐨勫嚱鏁?- 绉婚櫎 attemptedSources 渚濊禆閬垮厤涓嶅繀瑕佺殑閲嶆柊鍒涘缓
  const getVideoInfo = useCallback(async (source: SearchResult) => {
    const sourceKey = `${source.source}-${source.id}`;

    // 浣跨敤 ref 鑾峰彇鏈€鏂扮殑鐘舵€侊紝閬垮厤闂寘闂
    if (attemptedSourcesRef.current.has(sourceKey)) {
      return;
    }

    // 鑾峰彇绗竴闆嗙殑URL
    if (!source.episodes || source.episodes.length === 0) {
      return;
    }
    const episodeUrl =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

    // 鏍囪涓哄凡灏濊瘯
    setAttemptedSources((prev) => new Set(prev).add(sourceKey));

    try {
      const info = await getVideoResolutionFromM3u8(episodeUrl);
      setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
    } catch (error) {
      // 澶辫触鏃朵繚瀛橀敊璇姸鎬?
      setVideoInfoMap((prev) =>
        new Map(prev).set(sourceKey, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        })
      );
    }
  }, []);

  // 褰撴湁棰勮绠楃粨鏋滄椂锛屽厛鍚堝苟鍒皏ideoInfoMap涓?
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      // 鍘熷瓙鎬у湴鏇存柊涓や釜鐘舵€侊紝閬垮厤鏃跺簭闂
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => {
          newMap.set(key, value);
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((info, key) => {
          if (!info.hasError) {
            newSet.add(key);
          }
        });
        return newSet;
      });

      // 鍚屾鏇存柊 ref锛岀‘淇?getVideoInfo 鑳界珛鍗崇湅鍒版洿鏂?
      precomputedVideoInfo.forEach((info, key) => {
        if (!info.hasError) {
          attemptedSourcesRef.current.add(key);
        }
      });
    }
  }, [precomputedVideoInfo]);

  // 璇诲彇鏈湴鈥滀紭閫夊拰娴嬮€熲€濆紑鍏筹紝榛樿寮€鍚?
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

  // 褰撳垏鎹㈠埌鎹㈡簮tab骞朵笖鏈夋簮鏁版嵁鏃讹紝寮傛鑾峰彇瑙嗛淇℃伅 - 绉婚櫎 attemptedSources 渚濊禆閬垮厤寰幆瑙﹀彂
  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (
        !optimizationEnabled || // 鑻ュ叧闂祴閫熷垯鐩存帴閫€鍑?
        activeTab !== 'sources' ||
        availableSources.length === 0
      )
        return;

      // 绛涢€夊嚭灏氭湭娴嬮€熺殑鎾斁婧?
      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        return !attemptedSourcesRef.current.has(sourceKey);
      });

      if (pendingSources.length === 0) return;

      const batchSize = Math.ceil(pendingSources.length / 2);

      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }
    };

    fetchVideoInfosInBatches();
    // 渚濊禆椤逛繚鎸佷笌涔嬪墠涓€鑷?
  }, [activeTab, availableSources, getVideoInfo, optimizationEnabled]);

  // 鍗囧簭鍒嗛〉鏍囩
  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  // 鏍规嵁 descending 鐘舵€佸喅瀹氬垎椤垫爣绛剧殑鎺掑簭鍜屽唴瀹?
  const categories = useMemo(() => {
    if (descending) {
      // 鍊掑簭鏃讹紝label 涔熷€掑簭鏄剧ず
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 褰撳垎椤靛垏鎹㈡椂锛屽皢婵€娲荤殑鍒嗛〉鏍囩婊氬姩鍒拌鍙ｄ腑闂?
  useEffect(() => {
    const btn = buttonRefs.current[displayPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      // 鎵嬪姩璁＄畻婊氬姩浣嶇疆锛屽彧婊氬姩鍒嗛〉鏍囩瀹瑰櫒
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;

      // 璁＄畻鎸夐挳鐩稿浜庡鍣ㄧ殑浣嶇疆
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;

      // 璁＄畻鐩爣婊氬姩浣嶇疆锛屼娇鎸夐挳灞呬腑
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;

      // 骞虫粦婊氬姩鍒扮洰鏍囦綅缃?
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [displayPage, pageCount]);

  // 澶勭悊鎹㈡簮tab鐐瑰嚮锛屽彧鍦ㄧ偣鍑绘椂鎵嶆悳绱?
  const handleSourceTabClick = () => {
    setActiveTab('sources');
  };

  const handleCategoryClick = useCallback(
    (index: number) => {
      if (descending) {
        // 鍦ㄥ€掑簭鏃讹紝闇€瑕佸皢鏄剧ず绱㈠紩杞崲涓哄疄闄呯储寮?
        setCurrentPage(pageCount - 1 - index);
      } else {
        setCurrentPage(index);
      }
    },
    [descending, pageCount]
  );

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      onChange?.(episodeNumber);
    },
    [onChange]
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange]
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes
  );

  return (
    <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-white/58 dark:bg-slate-900/45 backdrop-blur-xl flex flex-col border border-white/45 dark:border-white/20 shadow-lg overflow-hidden'>
      {/* 涓昏鐨?Tab 鍒囨崲 - 鏃犵紳铻嶅叆璁捐 */}
      <div className='flex mb-1 -mx-6 flex-shrink-0'>
        {totalEpisodes > 1 && (
          <div
            onClick={() => setActiveTab('episodes')}
            className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
              ${
                activeTab === 'episodes'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-700 hover:text-blue-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-blue-400 hover:bg-black/3 dark:hover:bg-white/3'
              }
            `.trim()}
          >
            选集
          </div>
        )}
        <div
          onClick={handleSourceTabClick}
          className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
            ${
              activeTab === 'sources'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-700 hover:text-blue-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-blue-400 hover:bg-black/3 dark:hover:bg-white/3'
            }
          `.trim()}
        >
          换源
        </div>
        {onDanmakuSelect && (
          <div
            onClick={() => setActiveTab('danmaku')}
            className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
              ${
                activeTab === 'danmaku'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-700 hover:text-blue-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-blue-400 hover:bg-black/3 dark:hover:bg-white/3'
              }
            `.trim()}
          >
            弹幕
          </div>
        )}
      </div>

      {activeTab === 'danmaku' && onDanmakuSelect && (
        <div className='mt-2 flex-1 min-h-0 overflow-hidden'>
          <DanmakuPanel
            videoTitle={videoTitle || ''}
            currentEpisodeIndex={value - 1}
            onDanmakuSelect={onDanmakuSelect}
            currentSelection={currentDanmakuSelection || null}
            onUploadDanmaku={onUploadDanmaku}
          />
        </div>
      )}

      {/* 閫夐泦 Tab 鍐呭 */}
      {activeTab === 'episodes' && (
        <>
          {/* 鍒嗙被鏍囩 */}
          <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 flex-shrink-0'>
            <div className='flex-1 overflow-x-auto' ref={categoryContainerRef}>
              <div className='flex gap-2 min-w-max'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`w-20 relative py-2 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 text-center 
                        ${
                          isActive
                            ? 'text-blue-500 dark:text-blue-400'
                            : 'text-gray-700 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400'
                        }
                      `.trim()}
                    >
                      {label}
                      {isActive && (
                        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 dark:bg-blue-400' />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 鍚戜笂/鍚戜笅鎸夐挳 */}
            <button
              className='flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-blue-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-blue-400 dark:hover:bg-white/20 transition-colors transform translate-y-[-4px]'
              onClick={() => {
                // 鍒囨崲闆嗘暟鎺掑簭锛堟搴?鍊掑簭锛?
                setDescending((prev) => !prev);
              }}
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
          </div>

          {/* 闆嗘暟缃戞牸 */}
          <div className='grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] auto-rows-[40px] gap-x-3 gap-y-3 overflow-y-auto h-full pb-4'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              const episodes = Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i
              );
              return episodes;
            })().map((episodeNumber) => {
              const isActive = episodeNumber === value;
              return (
                <button
                  key={episodeNumber}
                  onClick={() => handleEpisodeClick(episodeNumber - 1)}
                  className={`h-10 flex items-center justify-center text-sm font-medium rounded-md transition-all duration-200 
                    ${
                      isActive
                        ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25 dark:bg-blue-600'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:scale-105 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
                    }`.trim()}
                >
                  {episodeNumber}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 鎹㈡簮 Tab 鍐呭 */}
      {activeTab === 'sources' && (
        <div className='flex flex-col h-full mt-4'>
          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500'></div>
              <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                搜索中...
              </span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-red-500 text-2xl mb-2'>⚠️</div>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  {sourceSearchError}
                </p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center py-8'>
                <div className='text-center'>
                  <div className='text-gray-400 text-2xl mb-2'>📭</div>
                  <p className='text-sm text-gray-600 dark:text-gray-300'>
                    暂无可用的换源
                  </p>
                </div>
              </div>
            )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                {availableSources
                  .sort((a, b) => {
                    const aIsCurrent =
                      a.source?.toString() === currentSource?.toString() &&
                      a.id?.toString() === currentId?.toString();
                    const bIsCurrent =
                      b.source?.toString() === currentSource?.toString() &&
                      b.id?.toString() === currentId?.toString();
                    if (aIsCurrent && !bIsCurrent) return -1;
                    if (!aIsCurrent && bIsCurrent) return 1;
                    return 0;
                  })
                  .map((source, index) => {
                    const isCurrentSource =
                      source.source?.toString() === currentSource?.toString() &&
                      source.id?.toString() === currentId?.toString();
                    return (
                      <div
                        key={`${source.source}-${source.id}`}
                        onClick={() =>
                          !isCurrentSource && handleSourceClick(source)
                        }
                        className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                      ${
                        isCurrentSource
                          ? 'bg-blue-500/10 dark:bg-blue-500/20 border-blue-500/30 border'
                          : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                      }`.trim()}
                      >
                        {/* 灏侀潰 */}
                        <div className='flex-shrink-0 w-12 h-20 bg-gray-300 dark:bg-gray-600 rounded overflow-hidden'>
                          {source.episodes && source.episodes.length > 0 && (
                            <img
                              src={processImageUrl(source.poster)}
                              alt={source.title}
                              className='w-full h-full object-cover'
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                              }}
                            />
                          )}
                        </div>

                        {/* 淇℃伅鍖哄煙 */}
                        <div className='flex-1 min-w-0 flex flex-col justify-between h-20'>
                          {/* 鏍囬鍜屽垎杈ㄧ巼 - 椤堕儴 */}
                          <div className='flex items-start justify-between gap-3 h-6'>
                            <div className='flex-1 min-w-0 relative group/title'>
                              <h3 className='font-medium text-base truncate text-gray-900 dark:text-gray-100 leading-none'>
                                {source.title}
                              </h3>
                              {/* 鏍囬绾у埆鐨?tooltip - 绗竴涓厓绱犱笉鏄剧ず */}
                              {index !== 0 && (
                                <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible group-hover/title:opacity-100 group-hover/title:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap z-[500] pointer-events-none'>
                                  {source.title}
                                  <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                                </div>
                              )}
                            </div>
                            {(() => {
                              const sourceKey = `${source.source}-${source.id}`;
                              const videoInfo = videoInfoMap.get(sourceKey);

                              if (videoInfo && videoInfo.quality !== '未知') {
                                if (videoInfo.hasError) {
                                  return (
                                    <div className='bg-gray-500/10 dark:bg-gray-400/20 text-red-600 dark:text-red-400 px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center'>
                                      检测失败
                                    </div>
                                  );
                                } else {
                                  // 鏍规嵁鍒嗚鲸鐜囪缃笉鍚岄鑹诧細2K銆?K涓虹传鑹诧紝1080p銆?20p涓虹豢鑹诧紝鍏朵粬涓洪粍鑹?
                                  const isUltraHigh = ['4K', '2K'].includes(
                                    videoInfo.quality
                                  );
                                  const isHigh = ['1080p', '720p'].includes(
                                    videoInfo.quality
                                  );
                                  const textColorClasses = isUltraHigh
                                    ? 'text-purple-600 dark:text-purple-400'
                                    : isHigh
                                    ? 'text-blue-600 dark:text-blue-400'
                                    : 'text-yellow-600 dark:text-yellow-400';

                                  return (
                                    <div
                                      className={`bg-gray-500/10 dark:bg-gray-400/20 ${textColorClasses} px-1.5 py-0 rounded text-xs flex-shrink-0 min-w-[50px] text-center`}
                                    >
                                      {videoInfo.quality}
                                    </div>
                                  );
                                }
                              }

                              return null;
                            })()}
                          </div>

                          {/* 婧愬悕绉板拰闆嗘暟淇℃伅 - 鍨傜洿灞呬腑 */}
                          <div className='flex items-center justify-between'>
                            <span className='text-xs px-2 py-1 border border-gray-500/60 rounded text-gray-700 dark:text-gray-300'>
                              {source.source_name}
                            </span>
                            {source.episodes.length > 1 && (
                              <span className='text-xs text-gray-500 dark:text-gray-400 font-medium'>
                                {source.episodes.length} 集
                              </span>
                            )}
                          </div>

                          {/* 缃戠粶淇℃伅 - 搴曢儴 */}
                          <div className='flex items-end h-6'>
                            {(() => {
                              const sourceKey = `${source.source}-${source.id}`;
                              const videoInfo = videoInfoMap.get(sourceKey);
                              if (videoInfo) {
                                if (!videoInfo.hasError) {
                                  return (
                                    <div className='flex items-end gap-3 text-xs'>
                                      <div className='text-blue-600 dark:text-blue-400 font-medium text-xs'>
                                        {videoInfo.loadSpeed}
                                      </div>
                                      <div className='text-orange-600 dark:text-orange-400 font-medium text-xs'>
                                        {videoInfo.pingTime}ms
                                      </div>
                                    </div>
                                  );
                                } else {
                                  return (
                                    <div className='text-red-500/90 dark:text-red-400 font-medium text-xs'>
                                      无测速数据
                                    </div>
                                  ); // 鍗犱綅div
                                }
                              }
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                <div className='flex-shrink-0 mt-auto pt-2 border-t border-gray-400 dark:border-gray-700'>
                  <button
                    onClick={() => {
                      if (videoTitle) {
                        router.push(
                          `/search?q=${encodeURIComponent(videoTitle)}`
                        );
                      }
                    }}
                    className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors py-2'
                  >
                    影片匹配有误？点击去搜索
                  </button>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;

