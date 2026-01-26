import useSWR from 'swr';
import { useMemo } from 'react';
import type { DoubanMovie } from '@/types/douban';
import type { CategoryData, HeroData, HeroMovie } from '@/types/home';
import { getHeroMovies, getNewContent } from '@/lib/douban-service';

// SWR 缓存键
const SWR_KEY_HERO = 'home-hero';
const SWR_KEY_CATEGORIES = 'home-categories';

interface UseHomeDataReturn {
  categories: CategoryData[];
  heroMovies: DoubanMovie[];
  heroDataList: HeroData[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * 管理首页数据加载
 * 使用 SWR 实现缓存，页面返回时不会重复加载
 */
export function useHomeData(): UseHomeDataReturn {
  // Hero Banner 数据
  const {
    data: heroData,
    error: heroError,
    isLoading: heroLoading,
    mutate: mutateHero,
  } = useSWR(SWR_KEY_HERO, getHeroMovies);

  // 分类数据
  const {
    data: categoryData,
    error: categoryError,
    isLoading: categoryLoading,
    mutate: mutateCategories,
  } = useSWR(SWR_KEY_CATEGORIES, getNewContent);

  // 转换 Hero 数据格式
  const { heroMovies, heroDataList } = useMemo(() => {
    if (!heroData || !Array.isArray(heroData)) {
      return { heroMovies: [], heroDataList: [] };
    }

    const heroMoviesList: HeroMovie[] = heroData.map((hero) => ({
      id: hero.id,
      title: hero.title,
      cover: hero.cover || '',
      url: hero.url || '',
      rate: hero.rate || '',
      episode_info: hero.episode_info || '',
      cover_x: 0,
      cover_y: 0,
      playable: false,
      is_new: false,
    }));

    const heroDataArray: HeroData[] = heroData.map((hero) => ({
      poster_horizontal: hero.poster_horizontal,
      poster_vertical: hero.poster_vertical,
      description: hero.description,
      genres: hero.genres,
    }));

    return { heroMovies: heroMoviesList, heroDataList: heroDataArray };
  }, [heroData]);

  // 转换分类数据格式
  const categories = useMemo(() => {
    if (!categoryData || !Array.isArray(categoryData)) {
      return [];
    }

    return categoryData.map((cat) => ({
      name: cat.name,
      data: cat.data.map((item) => ({
        id: item.id,
        title: item.title,
        rate: item.rate,
        cover: item.cover,
        url: item.url,
        episode_info: item.episode_info,
      })),
    }));
  }, [categoryData]);

  // 刷新所有数据
  const refetch = async () => {
    await Promise.all([mutateHero(), mutateCategories()]);
  };

  // 合并错误信息
  const error = heroError?.message || categoryError?.message || null;

  // 仅在 Hero 加载中时显示 loading
  // 分类数据可以后台加载
  const loading = heroLoading && !heroData;

  return {
    categories,
    heroMovies,
    heroDataList,
    loading,
    error,
    refetch,
  };
}
