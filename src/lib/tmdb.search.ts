/* eslint-disable @typescript-eslint/no-explicit-any */

import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

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
  proxy?: string
): Promise<{ code: number; result: TMDBSearchResult | null }> {
  try {
    if (!apiKey) {
      return { code: 400, result: null };
    }

    // 使用 multi search 同时搜索电影和电视剧
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&language=zh-CN&query=${encodeURIComponent(query)}&page=1`;
	
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
 * 获取 TMDB 图片完整 URL
 */
export function getTMDBImageUrl(
  path: string | null,
  size: string = 'w500'
): string {
  if (!path) return '';
  return `https://image.tmdb.org/t/p/${size}${path}`;
}
