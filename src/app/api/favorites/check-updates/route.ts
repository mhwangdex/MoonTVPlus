import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getStorage } from '@/lib/db';
import { getAvailableApiSites } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import { Notification } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const storage = getStorage();
    const username = authInfo.username;
    const now = Date.now();

    console.log(`用户 ${username} 请求检查收藏更新`);
    console.log(`当前时间: ${new Date(now).toLocaleString('zh-CN')}`);
    console.log(`开始检查收藏更新...`);

    // 获取所有收藏
    const favorites = await storage.getAllFavorites(username);
    const favoriteKeys = Object.keys(favorites);

    if (favoriteKeys.length === 0) {
      return NextResponse.json({
        message: '没有收藏',
        updates: [],
      });
    }

    // 获取可用的 API 站点
    const apiSites = await getAvailableApiSites(username);

    // 检查每个收藏的更新
    const updates: Array<{
      source: string;
      id: string;
      title: string;
      old_episodes: number;
      new_episodes: number;
    }> = [];

    // 限制并发请求数量，避免过载
    const BATCH_SIZE = 5;
    for (let i = 0; i < favoriteKeys.length; i += BATCH_SIZE) {
      const batch = favoriteKeys.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (key) => {
          try {
            const favorite = favorites[key];

            // 跳过 live 类型的收藏
            if (favorite.origin === 'live') {
              return;
            }

            // 跳过已完结的收藏
            if (favorite.is_completed) {
              console.log(`跳过已完结的收藏: ${favorite.title}`);
              return;
            }

            // 解析 source 和 id
            const [source, id] = key.split('+');
            if (!source || !id) {
              return;
            }

            // 查找对应的 API 站点
            const apiSite = apiSites.find((site) => site.key === source);
            if (!apiSite) {
              return;
            }

            // 获取最新详情
            const detail = await getDetailFromApi(apiSite, id);

            // 比较集数
            const oldEpisodes = favorite.total_episodes;
            const newEpisodes = detail.episodes.length;

            console.log(`检查收藏: ${favorite.title} (${source}+${id})`);
            console.log(`  旧集数: ${oldEpisodes}, 新集数: ${newEpisodes}`);
            console.log(`  是否完结: ${favorite.is_completed}, 备注: ${favorite.vod_remarks}`);

            if (newEpisodes > oldEpisodes) {
              updates.push({
                source,
                id,
                title: favorite.title,
                old_episodes: oldEpisodes,
                new_episodes: newEpisodes,
              });

              // 更新收藏的集数和完结状态
              await storage.setFavorite(username, key, {
                ...favorite,
                total_episodes: newEpisodes,
                is_completed: detail.vod_remarks
                  ? ['全', '完结', '大结局', 'end', '完'].some((keyword) =>
                      detail.vod_remarks!.toLowerCase().includes(keyword)
                    )
                  : false,
                vod_remarks: detail.vod_remarks,
              });
            }
          } catch (error) {
            console.error(`检查收藏更新失败 (${key}):`, error);
            // 继续处理其他收藏
          }
        })
      );
    }

    console.log(`检查完成，发现 ${updates.length} 个更新`);

    // 如果有更新，创建通知
    if (updates.length > 0) {
      for (const update of updates) {
        const notification: Notification = {
          id: `fav_update_${update.source}_${update.id}_${now}`,
          type: 'favorite_update',
          title: '收藏更新',
          message: `《${update.title}》有新集数更新！从 ${update.old_episodes} 集更新到 ${update.new_episodes} 集`,
          timestamp: now,
          read: false,
          metadata: {
            source: update.source,
            id: update.id,
            title: update.title,
            old_episodes: update.old_episodes,
            new_episodes: update.new_episodes,
          },
        };

        await storage.addNotification(username, notification);
      }
    }

    return NextResponse.json({
      message: updates.length > 0 ? `发现 ${updates.length} 个更新` : '没有更新',
      updates,
      checked: favoriteKeys.length,
    });
  } catch (error) {
    console.error('检查收藏更新失败:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
