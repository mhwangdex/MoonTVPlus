/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import VideoCard from '@/components/VideoCard';

interface FavoriteItem {
  id: string;
  source: string;
  title: string;
  year: string;
  poster: string;
  episodes?: number;
  source_name?: string;
  currentEpisode?: number;
  search_title?: string;
  origin?: 'vod' | 'live';
}

interface FavoritesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FavoritesPanel: React.FC<FavoritesPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(false);

  // 加载收藏数据
  const loadFavorites = async () => {
    setLoading(true);
    try {
      const allFavorites = await getAllFavorites();
      const allPlayRecords = await getAllPlayRecords();

      // 根据保存时间排序（从近到远）
      const sorted = Object.entries(allFavorites)
        .sort(([, a], [, b]) => b.save_time - a.save_time)
        .map(([key, fav]) => {
          const plusIndex = key.indexOf('+');
          const source = key.slice(0, plusIndex);
          const id = key.slice(plusIndex + 1);

          // 查找对应的播放记录，获取当前集数
          const playRecord = allPlayRecords[key];
          const currentEpisode = playRecord?.index;

          return {
            id,
            source,
            title: fav.title,
            year: fav.year,
            poster: fav.cover,
            episodes: fav.total_episodes,
            source_name: fav.source_name,
            currentEpisode,
            search_title: fav?.search_title,
            origin: fav?.origin,
          } as FavoriteItem;
        });
      setFavoriteItems(sorted);
    } catch (error) {
      console.error('加载收藏失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 清空所有收藏
  const handleClearAll = async () => {
    try {
      await clearAllFavorites();
      setFavoriteItems([]);
    } catch (error) {
      console.error('清空收藏失败:', error);
    }
  };

  // 打开面板时加载收藏
  useEffect(() => {
    if (isOpen) {
      loadFavorites();
    }
  }, [isOpen]);

  // 监听收藏变化,实时移除已取消收藏的项目
  useEffect(() => {
    const unsubscribe = subscribeToDataUpdates('favoritesUpdated', async (newFavorites: Record<string, any>) => {
      if (isOpen) {
        // 获取最新的收藏列表的键
        const currentKeys = Object.keys(newFavorites);

        // 过滤掉已经不在收藏中的项目
        setFavoriteItems((prevItems) =>
          prevItems.filter((item) => {
            const key = `${item.source}+${item.id}`;
            return currentKeys.includes(key);
          })
        );
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen]);

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={onClose}
      />

      {/* 收藏面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[85vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] flex flex-col overflow-hidden'>
        {/* 标题栏 */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex items-center gap-2'>
            <Star className='w-5 h-5 text-yellow-500' />
            <h3 className='text-lg font-bold text-gray-800 dark:text-gray-200'>
              我的收藏
            </h3>
            {favoriteItems.length > 0 && (
              <span className='px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 rounded-full'>
                {favoriteItems.length} 项
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {favoriteItems.length > 0 && (
              <button
                onClick={handleClearAll}
                className='text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors'
              >
                清空全部
              </button>
            )}
            <button
              onClick={onClose}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>
        </div>

        {/* 收藏列表 */}
        <div className='flex-1 overflow-y-auto p-6'>
          {loading ? (
            <div className='flex items-center justify-center py-12'>
              <div className='w-8 h-8 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin'></div>
            </div>
          ) : favoriteItems.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400'>
              <Star className='w-12 h-12 mb-3 opacity-30' />
              <p className='text-sm'>暂无收藏内容</p>
            </div>
          ) : (
            <div className='grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
              {favoriteItems.map((item) => (
                <div key={item.id + item.source} className='w-full'>
                  <VideoCard
                    query={item.search_title}
                    {...item}
                    from='favorite'
                    type={item.episodes && item.episodes > 1 ? 'tv' : ''}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
