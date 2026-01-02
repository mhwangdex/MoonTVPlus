/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getNextApiKey } from '@/lib/tmdb.client';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

export const runtime = 'nodejs';

/**
 * GET /api/tmdb/detail?id=xxx&type=movie|tv
 * 获取TMDB详情
 */
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type') || 'movie';

    if (!id) {
      return NextResponse.json({ error: '缺少ID参数' }, { status: 400 });
    }

    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig.TMDBApiKey;
    const tmdbProxy = config.SiteConfig.TMDBProxy;

    const actualKey = getNextApiKey(tmdbApiKey || '');
    if (!actualKey) {
      return NextResponse.json(
        { error: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    // 根据类型选择API端点
    const endpoint = type === 'movie' ? 'movie' : 'tv';
    const url = `https://api.themoviedb.org/3/${endpoint}/${id}?api_key=${actualKey}&language=zh-CN&append_to_response=credits`;

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

    const response = await nodeFetch(url, fetchOptions);

    if (!response.ok) {
      console.error('TMDB 详情获取失败:', response.status, response.statusText);
      return NextResponse.json(
        { error: 'TMDB 详情获取失败', code: response.status },
        { status: response.status }
      );
    }

    const data: any = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error('TMDB详情获取失败:', error);
    return NextResponse.json(
      { error: '获取详情失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
