/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';
import { getTMDBTrendingContent, getTMDBVideos } from '@/lib/tmdb.client';
import { getConfig } from '@/lib/config';

// 缓存配置 - 服务器内存缓存3小时
const CACHE_DURATION = 3 * 60 * 60 * 1000; // 3小时

// 为不同数据源分别维护缓存
let tmdbCache: { data: any; timestamp: number } | null = null;
let txCache: { data: any; timestamp: number } | null = null;

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 获取配置
    const config = await getConfig();
    const bannerDataSource = config.SiteConfig?.BannerDataSource || 'TMDB';

    // 根据数据源选择对应的缓存
    const cache = bannerDataSource === 'TX' ? txCache : tmdbCache;

    // 检查缓存
    if (cache && Date.now() - cache.timestamp < CACHE_DURATION) {
      return NextResponse.json(cache.data);
    }

    let result: any;

    // 根据配置的数据源获取数据
    if (bannerDataSource === 'TX') {
      // 使用TX数据源
      result = await getTXBannerContent();
      // 添加数据源标识
      result.source = 'TX';
      // 更新TX缓存
      txCache = {
        data: result,
        timestamp: Date.now(),
      };
    } else {
      // 使用TMDB数据源（默认）
      const apiKey = config.SiteConfig?.TMDBApiKey;
      const proxy = config.SiteConfig?.TMDBProxy;

      if (!apiKey) {
        return NextResponse.json(
          { code: 400, message: 'TMDB API Key 未配置' },
          { status: 400 }
        );
      }

      // 获取热门内容
      result = await getTMDBTrendingContent(apiKey, proxy);

      // 为每个项目获取视频数据
      if (result.code === 200 && result.list) {
        const itemsWithVideos = await Promise.all(
          result.list.map(async (item: any) => {
            const videoKey = await getTMDBVideos(apiKey, item.media_type, item.id, proxy);
            return { ...item, video_key: videoKey };
          })
        );
        result.list = itemsWithVideos;
      }

      // 添加数据源标识
      result.source = 'TMDB';
      // 更新TMDB缓存
      tmdbCache = {
        data: result,
        timestamp: Date.now(),
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('获取热门内容失败:', error);
    return NextResponse.json(
      { code: 500, message: '获取热门内容失败' },
      { status: 500 }
    );
  }
}

/**
 * 获取TX轮播图内容
 */
async function getTXBannerContent(): Promise<{ code: number; list: any[] }> {
  try {
    // TX API 配置
    const txApiUrl = 'https://pbaccess.video.qq.com/trpc.vector_layout.page_view.PageService/getPage?video_appid=3000010&vversion_platform=2&vdevice_guid=a458b2024f8d6f14';
    const requestBody = {
      page_params: {
        page_type: 'channel',
        page_id: '100101',
        scene: 'channel',
        new_mark_label_enabled: '1',
        vl_to_mvl: '',
        free_watch_trans_info: '{"ad_frequency_control_time_list":{}}',
        ad_exp_ids: '',
        ams_cookies: 'lv_play_index=33; o_minduid=PBUiqKSklDHZsTs2JqmXhTsczQfz5uzY; appuser=CC19AC2067F39B71',
        ad_trans_data: '{"ad_request_id":"uglfjd6-26n6yw4-gs9tlvy-k19l366","game_sessions":[]}',
        skip_privacy_types: '0',
        support_click_scan: '1',
      },
      page_bypass_params: {
        params: {
          platform_id: '2',
          caller_id: '3000010',
          data_mode: 'default',
          user_mode: 'default',
          specified_strategy: '',
          page_type: 'channel',
          page_id: '100101',
          scene: 'channel',
          new_mark_label_enabled: '1',
        },
        scene: 'channel',
        app_version: '',
        abtest_bypass_id: 'a458b2024f8d6f14',
      },
      page_context: null,
    };

    // 发送请求到TX API
    const response = await fetch(txApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15000),
    });
	
    if (!response.ok) {
      console.error('TX API 请求失败:', response.status, response.statusText);
      return { code: response.status, list: [] };
    }

    const data = await response.json();

    // 解析响应数据
    const bannerItems = parseTXBannerData(data);

    return {
      code: 200,
      list: bannerItems,
    };
  } catch (error) {
    console.error('获取 TX 轮播图数据失败:', error);
    return { code: 500, list: [] };
  }
}

/**
 * 解析TX API响应数据，提取轮播图信息
 */
function parseTXBannerData(data: any): any[] {
  try {
    const cardList = data?.data?.CardList;
    if (!Array.isArray(cardList)) {
      return [];
    }

    // 找到所有类型为 pc_shelves 的卡片
    const pcShelvesCards = cardList.filter((card: any) => card.type === 'pc_shelves');
    if (pcShelvesCards.length === 0) {
      return [];
    }

    // 尝试每个 pc_shelves 卡片，直到找到有效数据
    for (let i = 0; i < pcShelvesCards.length; i++) {
      const pcShelvesCard = pcShelvesCards[i];

      const cards = pcShelvesCard?.children_list?.list?.cards;
      if (!Array.isArray(cards) || cards.length === 0) {
        continue;
      }

    // 转换为统一格式
    const cardsWithParams = cards.filter((card: any) => card.params);

    const mappedItems = cardsWithParams.map((card: any, index: number) => {
        const params = card.params;

        // 获取标题（优先使用title）
        const title = params.title || '';

        // 获取子标题（优先使用priority_sub_title，其次rec_normal_reason）
        const subtitle = params.priority_sub_title || params.rec_normal_reason || '';

        // 获取标签（用"|"分割）
        const topicLabel = params.topic_label || '';
        const tags = topicLabel ? topicLabel.split('|').filter(Boolean) : [];

        // 获取背景图
        const backdropPath = params.priority_image_url || '';

        return {
          id: index + 1, // 使用索引作为ID
          title,
          subtitle,
          tags,
          backdrop_path: backdropPath,
          poster_path: backdropPath, // 使用相同的图片
          release_date: '',
          overview: subtitle,
          vote_average: 0,
          media_type: 'tv',
          genre_ids: [],
        };
      });

      const bannerItems = mappedItems.filter((item: any) => {
        // 只保留有标题和背景图的项目
        if (!item.title || !item.backdrop_path) return false;
        // 剔除标题包含"免费合集"的数据
        if (item.title.includes('免费合集')) return false;
        return true;
      });

      if (bannerItems.length > 0) {
        return bannerItems;
      }
    }

    // 所有 pc_shelves 卡片都没有有效数据
    return [];
  } catch (error) {
    console.error('解析 TX 轮播图数据失败:', error);
    return [];
  }
}
