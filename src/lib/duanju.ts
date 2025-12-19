/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { API_CONFIG, getAvailableApiSites } from '@/lib/config';
import { db } from '@/lib/db';

interface CmsClassResponse {
  class?: Array<{
    type_id: string | number;
    type_name: string;
  }>;
}

export interface DuanjuSource {
  key: string;
  name: string;
  api: string;
}

/**
 * 获取包含短剧分类的视频源列表
 */
export async function getDuanjuSources(): Promise<DuanjuSource[]> {
  try {
    // 先查询数据库中是否有缓存
    const cachedData = await db.getGlobalValue('duanju');

    if (cachedData !== null) {
      // 有缓存，直接返回（getGlobalValue 已经处理了序列化问题）
      return cachedData ? JSON.parse(cachedData) : [];
    }

    // 没有缓存，开始筛选
    console.log('开始筛选包含短剧分类的视频源...');
    const allSources = await getAvailableApiSites();
    const duanjuSources: DuanjuSource[] = [];

    // 并发���求所有视频源的分类列表
    const checkPromises = allSources.map(async (source) => {
      try {
        const classUrl = `${source.api}?ac=list`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(classUrl, {
          headers: API_CONFIG.search.headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return null;
        }

        const data: CmsClassResponse = await response.json();

        // 检查是否有短剧分类
        if (data.class && Array.isArray(data.class)) {
          const hasDuanju = data.class.some((item) => {
            const typeName = item.type_name?.toLowerCase() || '';
            return (
              typeName.includes('短剧') ||
              typeName.includes('短视频') ||
              typeName.includes('微短剧')
            );
          });

          if (hasDuanju) {
            return {
              key: source.key,
              name: source.name,
              api: source.api,
            };
          }
        }

        return null;
      } catch (error) {
        // 请求失败或超时，忽略该源
        console.error(`检查视频源 ${source.name} 失败:`, error);
        return null;
      }
    });

    const results = await Promise.all(checkPromises);

    // 过滤掉null值
    results.forEach((result) => {
      if (result) {
        duanjuSources.push(result);
      }
    });

    console.log(`找到 ${duanjuSources.length} 个包含短剧分类的视频源`);

    // 存入数据库（即使是空数组也要存）
    await db.setGlobalValue('duanju', JSON.stringify(duanjuSources));

    return duanjuSources;
  } catch (error) {
    console.error('获取短剧视频源失败:', error);
    throw error;
  }
}
