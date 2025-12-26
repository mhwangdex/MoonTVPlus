/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

export const runtime = 'nodejs';

/**
 * GET /api/tmdb/search?query=xxx
 * 搜索TMDB，返回多个结果供用户选择
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');

    if (!query) {
      return NextResponse.json({ error: '缺少查询参数' }, { status: 400 });
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { error: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    // 使用 multi search 同时搜索电影和电视剧
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&language=zh-CN&query=${encodeURIComponent(query)}&page=1`;

    const fetchOptions: any = tmdbProxy
      ? {
          agent: new HttpsProxyAgent(tmdbProxy, {
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
      console.error('TMDB 搜索失败:', response.status, response.statusText);
      return NextResponse.json(
        { error: 'TMDB 搜索失败', code: response.status },
        { status: response.status }
      );
    }

    const data: any = await response.json();

    // 过滤出电影和电视剧
    const validResults = data.results.filter(
      (item: any) => item.media_type === 'movie' || item.media_type === 'tv'
    );

    return NextResponse.json({
      success: true,
      results: validResults,
      total: validResults.length,
    });
  } catch (error) {
    console.error('TMDB搜索失败:', error);
    return NextResponse.json(
      { error: '搜索失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
