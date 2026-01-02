/* eslint-disable @typescript-eslint/no-explicit-any */

import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';
import { getNextApiKey } from './tmdb.client';

export interface TMDBSearchResult {
  id: number;
  title?: string; // 电影
  name?: string; // 电视剧
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  overview: string;
  vote_average: number;
  media_type: 'movie' | 'tv';
}

interface TMDBSearchResponse {
  results: TMDBSearchResult[];
  page: number;
  total_pages: number;
  total_results: number;
}

/**
 * 搜索 TMDB (电影+电视剧)
 */
export async function searchTMDB(
  apiKey: string,
  query: string,
  proxy?: string,
  year?: number
): Promise<{ code: number; result: TMDBSearchResult | null }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey) {
      return { code: 400, result: null };
    }

    // 使用 multi search 同时搜索电影和电视剧
    let url = `https://api.themoviedb.org/3/search/multi?api_key=${actualKey}&language=zh-CN&query=${encodeURIComponent(query)}&page=1`;

    // 如果提供了年份，添加到搜索参数中
    if (year) {
      url += `&year=${year}`;
    }

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

    // 使用 node-fetch 而不是原生 fetch，因为原生 fetch 不支持 agent 选项
    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB 搜索失败:', response.status, response.statusText);
      return { code: response.status, result: null };
    }

    const data: TMDBSearchResponse = await response.json() as TMDBSearchResponse;

    // 过滤出电影和电视剧，取第一个结果
    const validResults = data.results.filter(
      (item) => item.media_type === 'movie' || item.media_type === 'tv'
    );

    if (validResults.length === 0) {
      return { code: 404, result: null };
    }

    return {
      code: 200,
      result: validResults[0],
    };
  } catch (error) {
    console.error('TMDB 搜索异常:', error);
    return { code: 500, result: null };
  }
}

/**
 * TMDB 季度信息
 */
export interface TMDBSeasonInfo {
  id: number;
  name: string;
  season_number: number;
  episode_count: number;
  air_date: string | null;
  poster_path: string | null;
  overview: string;
}

/**
 * TMDB 电视剧详情（包含季度列表）
 */
interface TMDBTVDetails {
  id: number;
  name: string;
  seasons: TMDBSeasonInfo[];
  number_of_seasons: number;
  poster_path: string | null;
  first_air_date: string;
  overview: string;
  vote_average: number;
}

/**
 * 获取电视剧的季度列表
 */
export async function getTVSeasons(
  apiKey: string,
  tvId: number,
  proxy?: string
): Promise<{ code: number; seasons: TMDBSeasonInfo[] | null }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey) {
      return { code: 400, seasons: null };
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
      console.error('TMDB 获取电视剧详情失败:', response.status, response.statusText);
      return { code: response.status, seasons: null };
    }

    const data: TMDBTVDetails = await response.json() as TMDBTVDetails;

    // 过滤掉特殊季度（如 Season 0 通常是特别篇）
    const validSeasons = data.seasons.filter((season) => season.season_number > 0);

    return {
      code: 200,
      seasons: validSeasons,
    };
  } catch (error) {
    console.error('TMDB 获取季度列表异常:', error);
    return { code: 500, seasons: null };
  }
}

/**
 * 获取电视剧特定季度的详细信息
 */
export async function getTVSeasonDetails(
  apiKey: string,
  tvId: number,
  seasonNumber: number,
  proxy?: string
): Promise<{ code: number; season: TMDBSeasonInfo | null }> {
  try {
    const actualKey = getNextApiKey(apiKey);
    if (!actualKey) {
      return { code: 400, season: null };
    }

    const url = `https://api.themoviedb.org/3/tv/${tvId}/season/${seasonNumber}?api_key=${actualKey}&language=zh-CN`;

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
      console.error('TMDB 获取季度详情失败:', response.status, response.statusText);
      return { code: response.status, season: null };
    }

    const data: TMDBSeasonInfo = await response.json() as TMDBSeasonInfo;

    return {
      code: 200,
      season: data,
    };
  } catch (error) {
    console.error('TMDB 获取季度详情异常:', error);
    return { code: 500, season: null };
  }
}

/**
 * 获取 TMDB 图片完整 URL
 */
export function getTMDBImageUrl(
  path: string | null,
  size: string = 'w500'
): string {
  if (!path) return '';

  // 如果已经是完整的 URL (http:// 或 https://),直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  return `https://image.tmdb.org/t/p/${size}${path}`;
}
