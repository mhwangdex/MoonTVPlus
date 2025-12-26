/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);

  // 检查是否配置了 OpenList
  const hasOpenList = !!(
    config.OpenListConfig?.Enabled &&
    config.OpenListConfig?.URL &&
    config.OpenListConfig?.Username &&
    config.OpenListConfig?.Password
  );

  // 搜索 OpenList（如果配置了）
  let openlistResults: any[] = [];
  if (hasOpenList) {
    try {
      const { getCachedMetaInfo, setCachedMetaInfo } = await import('@/lib/openlist-cache');
      const { getTMDBImageUrl } = await import('@/lib/tmdb.search');
      const { db } = await import('@/lib/db');

      const rootPath = config.OpenListConfig!.RootPath || '/';
      let metaInfo = getCachedMetaInfo(rootPath);

      // 如果没有缓存，尝试从数据库读取
      if (!metaInfo) {
        try {
          const metainfoJson = await db.getGlobalValue('video.metainfo');
          if (metainfoJson) {
            metaInfo = JSON.parse(metainfoJson);
            if (metaInfo) {
              setCachedMetaInfo(rootPath, metaInfo);
            }
          }
        } catch (error) {
          console.error('[Search] 从数据库读取 metainfo 失败:', error);
        }
      }

      if (metaInfo && metaInfo.folders) {
        openlistResults = Object.entries(metaInfo.folders)
          .filter(([folderName, info]: [string, any]) => {
            const matchFolder = folderName.toLowerCase().includes(query.toLowerCase());
            const matchTitle = info.title.toLowerCase().includes(query.toLowerCase());
            return matchFolder || matchTitle;
          })
          .map(([folderName, info]: [string, any]) => ({
            id: folderName,
            source: 'openlist',
            source_name: '私人影库',
            title: info.title,
            poster: getTMDBImageUrl(info.poster_path),
            episodes: [],
            episodes_titles: [],
            year: info.release_date.split('-')[0] || '',
            desc: info.overview,
            type_name: info.media_type === 'movie' ? '电影' : '电视剧',
            douban_id: 0,
          }));
      }
    } catch (error) {
      console.error('[Search] 搜索 OpenList 失败:', error);
    }
  }

  // 添加超时控制和错误处理，避免慢接口拖累整体响应
  const searchPromises = apiSites.map((site) =>
    Promise.race([
      searchFromApi(site, query),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
      ),
    ]).catch((err) => {
      console.warn(`搜索失败 ${site.name}:`, err.message);
      return []; // 返回空数组而不是抛出错误
    })
  );

  try {
    const results = await Promise.allSettled(searchPromises);
    const successResults = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => (result as PromiseFulfilledResult<any>).value);
    let flattenedResults = [...openlistResults, ...successResults.flat()];
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    const cacheTime = await getCacheTime();

    if (flattenedResults.length === 0) {
      // no cache if empty
      return NextResponse.json({ results: [] }, { status: 200 });
    }

    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
