'use client';

import React from 'react';
import { useDownload } from '@/contexts/DownloadContext';

export function DownloadBubble() {
  const { tasks, downloadingCount, setShowDownloadPanel } = useDownload();

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className='fixed bottom-6 right-6 z-[9998]'>
      <button
        onClick={() => setShowDownloadPanel(true)}
        className='relative group bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-full p-4 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-110'
      >
        {/* 下载图标 */}
        <svg
          className='w-6 h-6'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
            d='M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4'
          />
        </svg>

        {/* 下载中数量徽章 */}
        {downloadingCount > 0 && (
          <div className='absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center animate-pulse'>
            {downloadingCount}
          </div>
        )}

        {/* 悬停提示 */}
        <div className='absolute bottom-full right-0 mb-2 hidden group-hover:block'>
          <div className='bg-gray-900 text-white text-sm rounded-lg py-2 px-3 whitespace-nowrap'>
            {downloadingCount > 0 ? `${downloadingCount} 个任务下载中` : '查看下载任务'}
            <div className='absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900'></div>
          </div>
        </div>
      </button>
    </div>
  );
}
