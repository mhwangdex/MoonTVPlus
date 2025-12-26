/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

interface Video {
  id: string;
  folder: string;
  tmdbId: number;
  title: string;
  poster: string;
  releaseDate: string;
  overview: string;
  voteAverage: number;
  mediaType: 'movie' | 'tv';
}

export default function PrivateLibraryPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    fetchVideos();
  }, [page]);

  const fetchVideos = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/openlist/list?page=${page}&pageSize=${pageSize}`
      );

      if (!response.ok) {
        throw new Error('获取视频列表失败');
      }

      const data = await response.json();

      if (data.error) {
        setError(data.error);
        setVideos([]);
      } else {
        setVideos(data.list || []);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error('获取视频列表失败:', err);
      setError('获取视频列表失败');
      setVideos([]);
    } finally {
      setLoading(false);
    }
  };

  const handleVideoClick = (video: Video) => {
    // 跳转到播放页面
    router.push(`/play?source=openlist&id=${encodeURIComponent(video.folder)}`);
  };

  return (
    <PageLayout activePath='/private-library'>
      <div className='container mx-auto px-4 py-6'>
        <div className='mb-6'>
          <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
            私人影库
          </h1>
          <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
            观看自我收藏的高清视频吧
          </p>
        </div>

        {error && (
          <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6'>
            <p className='text-red-800 dark:text-red-200'>{error}</p>
          </div>
        )}

        {loading ? (
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
            {Array.from({ length: pageSize }).map((_, index) => (
              <div
                key={index}
                className='animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg aspect-[2/3]'
              />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className='text-center py-12'>
            <p className='text-gray-500 dark:text-gray-400'>
              暂无视频，请在管理面板配置 OpenList 并刷新
            </p>
          </div>
        ) : (
          <>
            <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
              {videos.map((video) => (
                <VideoCard
                  key={video.id}
                  id={video.folder}
                  source='openlist'
                  title={video.title}
                  poster={video.poster}
                  year={video.releaseDate.split('-')[0]}
                  from='search'
                />
              ))}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className='flex justify-center items-center gap-4 mt-8'>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className='px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors'
                >
                  上一页
                </button>

                <span className='text-gray-700 dark:text-gray-300'>
                  第 {page} / {totalPages} 页
                </span>

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className='px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors'
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}
