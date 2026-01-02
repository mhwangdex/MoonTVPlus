/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

// TMDB API Key 轮询管理
let currentKeyIndex = 0;

/**
 * 解析并获取下一个可用的 TMDB API Key
 * @param apiKeys - API Key 字符串（支持逗号分隔的多个key）
 * @returns 当前应使用的 API Key
 */
export function getNextApiKey(apiKeys: string): string {
  if (!apiKeys) return '';

  const keys = apiKeys.split(',').map(k => k.trim()).filter(k => k);
  if (keys.length === 0) return '';
  if (keys.length === 1) return keys[0];

  // 轮询获取下一个key
  const key = keys[currentKeyIndex % keys.length];
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;

  return key;
}

export interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  overview: string;
  vote_average: number;
}

export interface TMDBTVShow {
  id: number;
  name: string;
  poster_path: string | null;
  first_air_date: string;
  overview: string;
  vote_average: number;
}

// 统一的类型，用于显示
export interface TMDBItem {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path?: string | null; // 背景图，用于轮播图
  release_date: string;
  overview: string;
  vote_average: number;
  media_type: 'movie' | 'tv';
  genre_ids?: number[]; // 类型ID列表
  video_key?: string; // YouTube视频key
}

interface TMDBUpcomingResponse {
  results: TMDBMovie[];
  page: number;
  total_pages: number;
  total_results: number;
}

interface TMDBTVAiringTodayResponse {
  results: TMDBTVShow[];
  page: number;
  total_pages: number;
  total_results: number;
}

/**
 * 获取即将上映的电影
 * @param apiKey - TMDB API Key
 * @param page - 页码
 * @param region - 地区代码，默认 CN (中国)
 * @param proxy - 代理服务器地址
 * @returns 即将上映的电影列表
 */
export async function getTMDBUpcomingMovies(
  apiKey: string,
  page: number = 1,
  region: string = 'CN',
  proxy?: string
): Promise<{ code: number; list: TMDBMovie[] }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey) {
      return { code: 400, list: [] };
    }

    const url = `https://api.themoviedb.org/3/movie/upcoming?api_key=${actualKey}&language=zh-CN&page=${page}&region=${region}`;
    const fetchOptions: any = proxy
      ? {
          agent: new HttpsProxyAgent(proxy, {
            timeout: 30000,
            keepAlive: false,
          }),
          signal: AbortSignal.timeout(30000),
        }
      : {
          signal: AbortSignal.timeout(15000),
        };

    // 使用 node-fetch 而不是原生 fetch
    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB API 请求失败:', response.status, response.statusText);
      return { code: response.status, list: [] };
    }

    const data: TMDBUpcomingResponse = await response.json() as TMDBUpcomingResponse;

    return {
      code: 200,
      list: data.results,
    };
  } catch (error) {
    console.error('获取 TMDB 即将上映电影失败:', error);
    return { code: 500, list: [] };
  }
}

/**
 * 获取正在播出的电视剧
 * @param apiKey - TMDB API Key
 * @param page - 页码
 * @param proxy - 代理服务器地址
 * @returns 正在播出的电视剧列表
 */
export async function getTMDBUpcomingTVShows(
  apiKey: string,
  page: number = 1,
  proxy?: string
): Promise<{ code: number; list: TMDBTVShow[] }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey) {
      return { code: 400, list: [] };
    }

    // 使用 on_the_air 接口获取正在播出的电视剧
    const url = `https://api.themoviedb.org/3/tv/on_the_air?api_key=${actualKey}&language=zh-CN&page=${page}`;
    const fetchOptions: any = proxy
      ? {
          agent: new HttpsProxyAgent(proxy, {
            timeout: 30000,
            keepAlive: false,
          }),
          signal: AbortSignal.timeout(30000),
        }
      : {
          signal: AbortSignal.timeout(15000),
        };

    // 使用 node-fetch 而不是原生 fetch
    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB TV API 请求失败:', response.status, response.statusText);
      return { code: response.status, list: [] };
    }

    const data: TMDBTVAiringTodayResponse = await response.json() as TMDBTVAiringTodayResponse;

    return {
      code: 200,
      list: data.results,
    };
  } catch (error) {
    console.error('获取 TMDB 正在播出电视剧失败:', error);
    return { code: 500, list: [] };
  }
}

/**
 * 获取即将上映/播出的内容（电影+电视剧）
 * @param apiKey - TMDB API Key
 * @param proxy - 代理服务器地址
 * @returns 统一格式的即将上映/播出列表
 */
export async function getTMDBUpcomingContent(
  apiKey: string,
  proxy?: string
): Promise<{ code: number; list: TMDBItem[] }> {
  try {
    if (!apiKey) {
      return { code: 400, list: [] };
    }

    // 并行获取电影和电视剧数据
    const [moviesResult, tvShowsResult] = await Promise.all([
      getTMDBUpcomingMovies(apiKey, 1, 'CN', proxy),
      getTMDBUpcomingTVShows(apiKey, 1, proxy),
    ]);

    // 检查是否有错误
    if (moviesResult.code !== 200 && tvShowsResult.code !== 200) {
      // 两个请求都失败，返回错误
      return { code: moviesResult.code, list: [] };
    }

    // 获取今天的日期（本地时区）
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 转换电影数据为统一格式，并过滤掉已上映的
    const movies: TMDBItem[] = moviesResult.code === 200
      ? moviesResult.list
          .filter((movie) => {
            // 只保留未来上映的电影
            return movie.release_date && movie.release_date >= todayStr;
          })
          .map((movie) => ({
            id: movie.id,
            title: movie.title,
            poster_path: movie.poster_path,
            release_date: movie.release_date,
            overview: movie.overview,
            vote_average: movie.vote_average,
            media_type: 'movie' as const,
          }))
      : [];

    // 转换电视剧数据为统一格式，并过滤掉已播出的
    const tvShows: TMDBItem[] = tvShowsResult.code === 200
      ? tvShowsResult.list
          .filter((tv) => {
            // 只保留未来播出的电视剧
            return tv.first_air_date && tv.first_air_date >= todayStr;
          })
          .map((tv) => ({
            id: tv.id,
            title: tv.name,
            poster_path: tv.poster_path,
            release_date: tv.first_air_date,
            overview: tv.overview,
            vote_average: tv.vote_average,
            media_type: 'tv' as const,
          }))
      : [];

    // 合并并返回
    const allContent = [...movies, ...tvShows];

    return {
      code: 200,
      list: allContent,
    };
  } catch (error) {
    console.error('获取 TMDB 即将上映内容失败:', error);
    return { code: 500, list: [] };
  }
}

/**
 * 获取视频（预告片）
 * @param apiKey - TMDB API Key
 * @param mediaType - 媒体类型 (movie 或 tv)
 * @param mediaId - 媒体ID
 * @param proxy - 代理服务器地址
 * @returns YouTube视频key（只返回预告片）
 */
export async function getTMDBVideos(
  apiKey: string,
  mediaType: 'movie' | 'tv',
  mediaId: number,
  proxy?: string
): Promise<string | null> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey) {
      return null;
    }

    const url = `https://api.themoviedb.org/3/${mediaType}/${mediaId}/videos?api_key=${actualKey}`;
    const fetchOptions: any = proxy
      ? {
          agent: new HttpsProxyAgent(proxy, {
            timeout: 30000,
            keepAlive: false,
          }),
          signal: AbortSignal.timeout(30000),
        }
      : {
          signal: AbortSignal.timeout(15000),
        };

    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();
    const videos = data.results || [];

    // 只查找YouTube预告片
    const trailer = videos.find((v: any) =>
      v.site === 'YouTube' && v.type === 'Trailer'
    );

    return trailer?.key || null;
  } catch (error) {
    console.error('获取 TMDB 视频失败:', error);
    return null;
  }
}

/**
 * 获取热门内容（电影+电视剧）
 * @param apiKey - TMDB API Key
 * @param proxy - 代理服务器地址
 * @returns 热门内容列表
 */
export async function getTMDBTrendingContent(
  apiKey: string,
  proxy?: string
): Promise<{ code: number; list: TMDBItem[] }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey) {
      return { code: 400, list: [] };
    }

    // 获取本周热门内容（电影+电视剧）
    const url = `https://api.themoviedb.org/3/trending/all/week?api_key=${actualKey}&language=zh-CN`;
    const fetchOptions: any = proxy
      ? {
          agent: new HttpsProxyAgent(proxy, {
            timeout: 30000,
            keepAlive: false,
          }),
          signal: AbortSignal.timeout(30000),
        }
      : {
          signal: AbortSignal.timeout(15000),
        };

    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB Trending API 请求失败:', response.status, response.statusText);
      return { code: response.status, list: [] };
    }

    const data: any = await response.json();

    // 转换为统一格式，只保留有backdrop_path的项目（用于轮播图）
    const items: TMDBItem[] = data.results
      .filter((item: any) => item.backdrop_path) // 只保留有背景图的
      .slice(0, 10) // 只取前10个
      .map((item: any) => ({
        id: item.id,
        title: item.title || item.name,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path, // 添加背景图
        release_date: item.release_date || item.first_air_date || '',
        overview: item.overview,
        vote_average: item.vote_average,
        media_type: item.media_type as 'movie' | 'tv',
        genre_ids: item.genre_ids || [], // 保存类型ID
      }));

    return {
      code: 200,
      list: items,
    };
  } catch (error) {
    console.error('获取 TMDB 热门内容失败:', error);
    return { code: 500, list: [] };
  }
}

/**
 * 获取 TMDB 图片完整 URL
 * @param path - 图片路径
 * @param size - 图片尺寸，默认 w500
 * @returns 完整的图片 URL
 */
export function getTMDBImageUrl(
  path: string | null,
  size: string = 'w500'
): string {
  if (!path) return '';
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

/**
 * TMDB 类型映射（中文）
 */
export const TMDB_GENRES: Record<number, string> = {
  // 电影类型
  28: '动作',
  12: '冒险',
  16: '动画',
  35: '喜剧',
  80: '犯罪',
  99: '纪录',
  18: '剧情',
  10751: '家庭',
  14: '奇幻',
  36: '历史',
  27: '恐怖',
  10402: '音乐',
  9648: '悬疑',
  10749: '爱情',
  878: '科幻',
  10770: '电视电影',
  53: '惊悚',
  10752: '战争',
  37: '西部',
  // 电视剧类型
  10759: '动作冒险',
  10762: '儿童',
  10763: '新闻',
  10764: '真人秀',
  10765: '科幻奇幻',
  10766: '肥皂剧',
  10767: '脱口秀',
  10768: '战争政治',
};

/**
 * 根据类型ID获取类型名称列表
 * @param genreIds - 类型ID数组
 * @param limit - 最多返回几个类型，默认2个
 * @returns 类型名称数组
 */
export function getGenreNames(genreIds: number[] = [], limit: number = 2): string[] {
  return genreIds
    .map(id => TMDB_GENRES[id])
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * 搜索多媒体内容
 * @param apiKey - TMDB API Key
 * @param query - 搜索关键词
 * @param proxy - 代理服务器地址
 * @returns 搜索结果列表
 */
export async function searchTMDBMulti(
  apiKey: string,
  query: string,
  proxy?: string
): Promise<{ code: number; results: any[] }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey || !query) {
      return { code: 400, results: [] };
    }

    const url = `https://api.themoviedb.org/3/search/multi?api_key=${actualKey}&language=zh-CN&query=${encodeURIComponent(query)}&page=1`;
    const fetchOptions: any = proxy
      ? {
          agent: new HttpsProxyAgent(proxy, {
            timeout: 30000,
            keepAlive: false,
          }),
          signal: AbortSignal.timeout(30000),
        }
      : {
          signal: AbortSignal.timeout(15000),
        };

    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB Search API 请求失败:', response.status, response.statusText);
      return { code: response.status, results: [] };
    }

    const data: any = await response.json();

    return {
      code: 200,
      results: data.results || [],
    };
  } catch (error) {
    console.error('搜索 TMDB 内容失败:', error);
    return { code: 500, results: [] };
  }
}

/**
 * 获取电影推荐
 * @param apiKey - TMDB API Key
 * @param movieId - 电影ID
 * @param proxy - 代理服务器地址
 * @returns 推荐列表
 */
export async function getTMDBMovieRecommendations(
  apiKey: string,
  movieId: number,
  proxy?: string
): Promise<{ code: number; results: TMDBMovie[] }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey || !movieId) {
      return { code: 400, results: [] };
    }

    const url = `https://api.themoviedb.org/3/movie/${movieId}/recommendations?api_key=${actualKey}&language=zh-CN&page=1`;
    const fetchOptions: any = proxy
      ? {
          agent: new HttpsProxyAgent(proxy, {
            timeout: 30000,
            keepAlive: false,
          }),
          signal: AbortSignal.timeout(30000),
        }
      : {
          signal: AbortSignal.timeout(15000),
        };

    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB Movie Recommendations API 请求失败:', response.status, response.statusText);
      return { code: response.status, results: [] };
    }

    const data: any = await response.json();

    return {
      code: 200,
      results: data.results || [],
    };
  } catch (error) {
    console.error('获取 TMDB 电影推荐失败:', error);
    return { code: 500, results: [] };
  }
}

/**
 * 获取电视剧推荐
 * @param apiKey - TMDB API Key
 * @param tvId - 电视剧ID
 * @param proxy - 代理服务器地址
 * @returns 推荐列表
 */
export async function getTMDBTVRecommendations(
  apiKey: string,
  tvId: number,
  proxy?: string
): Promise<{ code: number; results: TMDBTVShow[] }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey || !tvId) {
      return { code: 400, results: [] };
    }

    const url = `https://api.themoviedb.org/3/tv/${tvId}/recommendations?api_key=${actualKey}&language=zh-CN&page=1`;
    const fetchOptions: any = proxy
      ? {
          agent: new HttpsProxyAgent(proxy, {
            timeout: 30000,
            keepAlive: false,
          }),
          signal: AbortSignal.timeout(30000),
        }
      : {
          signal: AbortSignal.timeout(15000),
        };

    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB TV Recommendations API 请求失败:', response.status, response.statusText);
      return { code: response.status, results: [] };
    }

    const data: any = await response.json();

    return {
      code: 200,
      results: data.results || [],
    };
  } catch (error) {
    console.error('获取 TMDB 电视剧推荐失败:', error);
    return { code: 500, results: [] };
  }
}

/**
 * 获取 TMDB 电影详情
 * @param apiKey - TMDB API Key
 * @param movieId - 电影ID
 * @param proxy - 代理服务器地址
 * @returns 电影详情
 */
export async function getTMDBMovieDetails(
  apiKey: string,
  movieId: number,
  proxy?: string
): Promise<{ code: number; details: any }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey) {
      return { code: 400, details: null };
    }

    const url = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${actualKey}&language=zh-CN`;
    const fetchOptions: any = proxy
      ? {
          agent: new HttpsProxyAgent(proxy, {
            timeout: 30000,
            keepAlive: false,
          }),
          signal: AbortSignal.timeout(30000),
        }
      : {
          signal: AbortSignal.timeout(15000),
        };

    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB API 请求失败:', response.status, response.statusText);
      return { code: response.status, details: null };
    }

    const data: any = await response.json();

    return {
      code: 200,
      details: data,
    };
  } catch (error) {
    console.error('获取 TMDB 电影详情失败:', error);
    return { code: 500, details: null };
  }
}

/**
 * 获取 TMDB 电视剧详情
 * @param apiKey - TMDB API Key
 * @param tvId - 电视剧ID
 * @param proxy - 代理服务器地址
 * @returns 电视剧详情
 */
export async function getTMDBTVDetails(
  apiKey: string,
  tvId: number,
  proxy?: string
): Promise<{ code: number; details: any }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey) {
      return { code: 400, details: null };
    }

    const url = `https://api.themoviedb.org/3/tv/${tvId}?api_key=${actualKey}&language=zh-CN`;
    const fetchOptions: any = proxy
      ? {
          agent: new HttpsProxyAgent(proxy, {
            timeout: 30000,
            keepAlive: false,
          }),
          signal: AbortSignal.timeout(30000),
        }
      : {
          signal: AbortSignal.timeout(15000),
        };

    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB API 请求失败:', response.status, response.statusText);
      return { code: response.status, details: null };
    }

    const data: any = await response.json();

    return {
      code: 200,
      details: data,
    };
  } catch (error) {
    console.error('获取 TMDB 电视剧详情失败:', error);
    return { code: 500, details: null };
  }
}
