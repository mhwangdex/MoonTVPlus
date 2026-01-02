/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { getConfig } from '@/lib/config';
import { generateFolderKey } from '@/lib/crypto';
import { db } from '@/lib/db';
import { OpenListClient } from '@/lib/openlist.client';
import {
  getCachedMetaInfo,
  invalidateMetaInfoCache,
  MetaInfo,
  setCachedMetaInfo,
} from '@/lib/openlist-cache';
import {
  cleanupOldTasks,
  completeScanTask,
  createScanTask,
  failScanTask,
  updateScanTaskProgress,
} from '@/lib/scan-task';
import { parseSeasonFromTitle } from '@/lib/season-parser';
import { searchTMDB, getTVSeasonDetails } from '@/lib/tmdb.search';
import parseTorrentName from 'parse-torrent-name';

/**
 * 启动 OpenList 刷新任务
 */
export async function startOpenListRefresh(clearMetaInfo: boolean = false): Promise<{ taskId: string }> {
  const config = await getConfig();
  const openListConfig = config.OpenListConfig;

  if (
    !openListConfig ||
    !openListConfig.Enabled ||
    !openListConfig.URL ||
    !openListConfig.Username ||
    !openListConfig.Password
  ) {
    throw new Error('OpenList 未配置或未启用');
  }

  const tmdbApiKey = config.SiteConfig.TMDBApiKey;
  const tmdbProxy = config.SiteConfig.TMDBProxy;

  if (!tmdbApiKey) {
    throw new Error('TMDB API Key 未配置');
  }

  cleanupOldTasks();
  const taskId = createScanTask();

  performScan(
    taskId,
    openListConfig.URL,
    openListConfig.RootPath || '/',
    tmdbApiKey,
    tmdbProxy,
    openListConfig.Username,
    openListConfig.Password,
    clearMetaInfo,
    openListConfig.ScanMode || 'hybrid'
  ).catch((error) => {
    console.error('[OpenList Refresh] 后台扫描失败:', error);
    failScanTask(taskId, (error as Error).message);
  });

  return { taskId };
}

/**
 * 执行扫描任务
 */
async function performScan(
  taskId: string,
  url: string,
  rootPath: string,
  tmdbApiKey: string,
  tmdbProxy?: string,
  username?: string,
  password?: string,
  clearMetaInfo?: boolean,
  scanMode: 'torrent' | 'name' | 'hybrid' = 'hybrid'
): Promise<void> {
  const client = new OpenListClient(url, username!, password!);

  updateScanTaskProgress(taskId, 0, 0);

  try {
    let metaInfo: MetaInfo;

    if (clearMetaInfo) {
      metaInfo = {
        folders: {},
        last_refresh: Date.now(),
      };
    } else {
      try {
        const metainfoContent = await db.getGlobalValue('video.metainfo');
        if (metainfoContent) {
          metaInfo = JSON.parse(metainfoContent);
        } else {
          metaInfo = {
            folders: {},
            last_refresh: Date.now(),
          };
        }
      } catch (error) {
        console.error('[OpenList Refresh] 读取现有 metainfo 失败:', error);
        metaInfo = {
          folders: {},
          last_refresh: Date.now(),
        };
      }
    }

    invalidateMetaInfoCache(rootPath);

    const folders: any[] = [];
    let currentPage = 1;
    const pageSize = 100;
    let total = 0;

    while (true) {
      const listResponse = await client.listDirectory(rootPath, currentPage, pageSize, true);

      if (listResponse.code !== 200) {
        throw new Error('OpenList 列表获取失败');
      }

      total = listResponse.data.total;
      const pageFolders = listResponse.data.content.filter((item) => item.is_dir);
      folders.push(...pageFolders);

      if (folders.length >= total) {
        break;
      }

      currentPage++;
    }

    updateScanTaskProgress(taskId, 0, folders.length);

    let newCount = 0;
    let existingCount = 0;
    let errorCount = 0;

    const existingKeys = new Set<string>(Object.keys(metaInfo.folders));

    const folderNameToKey = new Map<string, string>();
    for (const [key, info] of Object.entries(metaInfo.folders)) {
      folderNameToKey.set(info.folderName, key);
    }

    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];

      updateScanTaskProgress(taskId, i + 1, folders.length, folder.name);

      if (!clearMetaInfo && folderNameToKey.has(folder.name)) {
        existingCount++;
        continue;
      }

      const folderKey = generateFolderKey(folder.name, existingKeys);
      existingKeys.add(folderKey);

      try {
        let searchQuery: string;
        let seasonNumber: number | null = null;
        let year: number | null = null;
        let searchResult: any;

        if (scanMode === 'torrent' || scanMode === 'hybrid') {
          const torrentInfo = parseTorrentName(folder.name);
          searchQuery = torrentInfo.title || folder.name;
          seasonNumber = torrentInfo.season || null;
          year = torrentInfo.year || null;

          console.log(`[OpenList Refresh] 种子库模式 - 文件夹: ${folder.name}`);
          console.log(`[OpenList Refresh] 解析结果 - 标题: ${searchQuery}, 季度: ${seasonNumber}, 年份: ${year}`);

          searchResult = await searchTMDB(tmdbApiKey, searchQuery, tmdbProxy, year || undefined);
        }

        if (scanMode === 'name' || (scanMode === 'hybrid' && (!searchResult || searchResult.code !== 200 || !searchResult.result))) {
          const seasonInfo = parseSeasonFromTitle(folder.name);
          searchQuery = seasonInfo.cleanTitle || folder.name;
          seasonNumber = seasonInfo.seasonNumber;
          year = seasonInfo.year;

          console.log(`[OpenList Refresh] 名字匹配模式 - 文件夹: ${folder.name}`);
          console.log(`[OpenList Refresh] 清理后标题: ${searchQuery}, 季度: ${seasonNumber}, 年份: ${year}`);

          searchResult = await searchTMDB(tmdbApiKey, searchQuery, tmdbProxy, year || undefined);
        }

        if (searchResult.code === 200 && searchResult.result) {
          const result = searchResult.result;

          const folderInfo: any = {
            folderName: folder.name,
            tmdb_id: result.id,
            title: result.title || result.name || folder.name,
            poster_path: result.poster_path,
            release_date: result.release_date || result.first_air_date || '',
            overview: result.overview,
            vote_average: result.vote_average,
            media_type: result.media_type,
            last_updated: Date.now(),
            failed: false,
          };

          if (result.media_type === 'tv' && seasonNumber) {
            try {
              const seasonDetails = await getTVSeasonDetails(
                tmdbApiKey,
                result.id,
                seasonNumber,
                tmdbProxy
              );

              if (seasonDetails.code === 200 && seasonDetails.season) {
                folderInfo.season_number = seasonDetails.season.season_number;
                folderInfo.season_name = seasonDetails.season.name;

                if (seasonDetails.season.season_number > 1) {
                  folderInfo.title = `${folderInfo.title} ${seasonDetails.season.name}`;
                }

                if (seasonDetails.season.poster_path) {
                  folderInfo.poster_path = seasonDetails.season.poster_path;
                }
                if (seasonDetails.season.overview) {
                  folderInfo.overview = seasonDetails.season.overview;
                }
                if (seasonDetails.season.air_date) {
                  folderInfo.release_date = seasonDetails.season.air_date;
                }
              } else {
                console.warn(`[OpenList Refresh] 获取季度 ${seasonNumber} 详情失败`);
                folderInfo.season_number = seasonNumber;
              }
            } catch (error) {
              console.error(`[OpenList Refresh] 获取季度详情异常:`, error);
              folderInfo.season_number = seasonNumber;
            }
          }

          metaInfo.folders[folderKey] = folderInfo;
          newCount++;
        } else {
          metaInfo.folders[folderKey] = {
            folderName: folder.name,
            tmdb_id: 0,
            title: folder.name,
            poster_path: null,
            release_date: '',
            overview: '',
            vote_average: 0,
            media_type: 'movie',
            last_updated: Date.now(),
            failed: true,
          };
          errorCount++;
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`[OpenList Refresh] 处理文件夹失败: ${folder.name}`, error);
        metaInfo.folders[folderKey] = {
          folderName: folder.name,
          tmdb_id: 0,
          title: folder.name,
          poster_path: null,
          release_date: '',
          overview: '',
          vote_average: 0,
          media_type: 'movie',
          last_updated: Date.now(),
          failed: true,
        };
        errorCount++;
      }
    }

    metaInfo.last_refresh = Date.now();

    const metainfoContent = JSON.stringify(metaInfo);
    await db.setGlobalValue('video.metainfo', metainfoContent);

    invalidateMetaInfoCache(rootPath);
    setCachedMetaInfo(rootPath, metaInfo);

    const config = await getConfig();
    config.OpenListConfig!.LastRefreshTime = Date.now();
    config.OpenListConfig!.ResourceCount = Object.keys(metaInfo.folders).length;
    await db.saveAdminConfig(config);

    completeScanTask(taskId, {
      total: folders.length,
      new: newCount,
      existing: existingCount,
      errors: errorCount,
    });
  } catch (error) {
    console.error('[OpenList Refresh] 扫描失败:', error);
    failScanTask(taskId, (error as Error).message);
    throw error;
  }
}
