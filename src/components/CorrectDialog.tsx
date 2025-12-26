/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

'use client';

import { Search, X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getTMDBImageUrl } from '@/lib/tmdb.search';
import { processImageUrl } from '@/lib/utils';

interface TMDBResult {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  overview: string;
  vote_average: number;
  media_type: 'movie' | 'tv';
}

interface CorrectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folder: string;
  currentTitle: string;
  onCorrect: () => void;
}

export default function CorrectDialog({
  isOpen,
  onClose,
  folder,
  currentTitle,
  onCorrect,
}: CorrectDialogProps) {
  const [searchQuery, setSearchQuery] = useState(currentTitle);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<TMDBResult[]>([]);
  const [error, setError] = useState('');
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery(currentTitle);
      setResults([]);
      setError('');
    }
  }, [isOpen, currentTitle]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setError('请输入搜索关键词');
      return;
    }

    setSearching(true);
    setError('');
    setResults([]);

    try {
      const response = await fetch(
        `/api/tmdb/search?query=${encodeURIComponent(searchQuery)}`
      );

      if (!response.ok) {
        throw new Error('搜索失败');
      }

      const data = await response.json();

      if (data.success && data.results) {
        setResults(data.results);
        if (data.results.length === 0) {
          setError('未找到匹配的结果');
        }
      } else {
        setError('搜索失败');
      }
    } catch (err) {
      console.error('搜索失败:', err);
      setError('搜索失败，请重试');
    } finally {
      setSearching(false);
    }
  };

  const handleCorrect = async (result: TMDBResult) => {
    setCorrecting(true);
    try {
      const response = await fetch('/api/openlist/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder,
          tmdbId: result.id,
          title: result.title || result.name,
          posterPath: result.poster_path,
          releaseDate: result.release_date || result.first_air_date,
          overview: result.overview,
          voteAverage: result.vote_average,
          mediaType: result.media_type,
        }),
      });

      if (!response.ok) {
        throw new Error('纠错失败');
      }

      onCorrect();
      onClose();
    } catch (err) {
      console.error('纠错失败:', err);
      setError('纠错失败，请重试');
    } finally {
      setCorrecting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm'>
      <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col m-4'>
        {/* 头部 */}
        <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            纠错：{currentTitle}
          </h2>
          <button
            onClick={onClose}
            className='text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          >
            <X size={24} />
          </button>
        </div>

        {/* 搜索框 */}
        <div className='p-4 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex gap-2'>
            <input
              type='text'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch();
                }
              }}
              placeholder='输入搜索关键词'
              className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2'
            >
              <Search size={20} />
              <span className='hidden sm:inline'>{searching ? '搜索中...' : '搜索'}</span>
            </button>
          </div>
          {error && (
            <p className='mt-2 text-sm text-red-600 dark:text-red-400'>{error}</p>
          )}
        </div>

        {/* 结果列表 */}
        <div className='flex-1 overflow-y-auto p-4'>
          {results.length === 0 ? (
            <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
              {searching ? '搜索中...' : '请输入关键词搜索'}
            </div>
          ) : (
            <div className='space-y-3'>
              {results.map((result) => (
                <div
                  key={result.id}
                  className='flex gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors'
                >
                  {/* 海报 */}
                  <div className='flex-shrink-0 w-16 h-24 relative rounded overflow-hidden bg-gray-200 dark:bg-gray-700'>
                    {result.poster_path ? (
                      <Image
                        src={processImageUrl(getTMDBImageUrl(result.poster_path))}
                        alt={result.title || result.name || ''}
                        fill
                        className='object-cover'
                        referrerPolicy='no-referrer'
                      />
                    ) : (
                      <div className='w-full h-full flex items-center justify-center text-gray-400 text-xs'>
                        无海报
                      </div>
                    )}
                  </div>

                  {/* 信息 */}
                  <div className='flex-1 min-w-0'>
                    <h3 className='font-semibold text-gray-900 dark:text-gray-100 truncate'>
                      {result.title || result.name}
                    </h3>
                    <p className='text-sm text-gray-600 dark:text-gray-400 mt-1'>
                      {result.media_type === 'movie' ? '电影' : '电视剧'} •{' '}
                      {result.release_date?.split('-')[0] ||
                        result.first_air_date?.split('-')[0] ||
                        '未知'}{' '}
                      • 评分: {result.vote_average.toFixed(1)}
                    </p>
                    <p className='text-xs text-gray-500 dark:text-gray-500 mt-1 line-clamp-2'>
                      {result.overview || '暂无简介'}
                    </p>
                  </div>

                  {/* 选择按钮 */}
                  <div className='flex-shrink-0 flex items-center'>
                    <button
                      onClick={() => handleCorrect(result)}
                      disabled={correcting}
                      className='px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed'
                    >
                      {correcting ? '处理中...' : '选择'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
