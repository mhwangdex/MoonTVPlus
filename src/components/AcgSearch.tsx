/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { AlertCircle, Download, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';

import Toast, { ToastProps } from '@/components/Toast';

interface AcgSearchItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  torrentUrl: string;
  description: string;
  images: string[];
}

interface AcgSearchResult {
  keyword: string;
  page: number;
  total: number;
  items: AcgSearchItem[];
}

interface AcgSearchProps {
  keyword: string;
  triggerSearch?: boolean;
  onError?: (error: string) => void;
}

export default function AcgSearch({
  keyword,
  triggerSearch,
  onError,
}: AcgSearchProps) {
  const [loading, setLoading] = useState(false);
  const [allItems, setAllItems] = useState<AcgSearchItem[]>([]); // 所有加载的项目
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<AcgSearchItem | null>(null);
  const [customName, setCustomName] = useState('');
  const [toast, setToast] = useState<ToastProps | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreRef = useRef(false);

  // 执行搜索
  const performSearch = async (page: number, isLoadMore = false) => {
    if (isLoadingMoreRef.current) return;

    isLoadingMoreRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/acg/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keyword: keyword.trim(),
          page,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '搜索失败');
      }

      const data: AcgSearchResult = await response.json();

      if (isLoadMore) {
        // 追加新数据
        setAllItems(prev => [...prev, ...data.items]);
        // 如果当前页没有结果，说明没有更多了
        setHasMore(data.items.length > 0);
      } else {
        // 新搜索，重置数据
        setAllItems(data.items);
        // 如果第一页有结果，假设可能还有更多
        setHasMore(data.items.length > 0);
      }

      setCurrentPage(page);
    } catch (err: any) {
      const errorMsg = err.message || '搜索失败，请稍后重试';
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLoading(false);
      isLoadingMoreRef.current = false;
    }
  };

  useEffect(() => {
    // triggerSearch 变化时触发搜索（无论是 true 还是 false）
    if (triggerSearch === undefined) {
      return;
    }

    const currentKeyword = keyword.trim();
    if (!currentKeyword) {
      return;
    }

    // 重置状态并开始新搜索
    setAllItems([]);
    setCurrentPage(1);
    setHasMore(true);
    performSearch(1, false);
  }, [triggerSearch]);

  // 加载更多数据
  const loadMore = useCallback(() => {
    if (!loading && hasMore && !isLoadingMoreRef.current) {
      performSearch(currentPage + 1, true);
    }
  }, [loading, hasMore, currentPage]);

  // 使用 Intersection Observer 监听滚动到底部
  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting) {
          loadMore();
        }
      },
      {
        root: null,
        rootMargin: '100px',
        threshold: 0.1,
      }
    );

    observer.observe(element);

    return () => {
      observer.unobserve(element);
    };
  }, [loadMore]);

  // 打开命名弹窗
  const handleOpenDownloadDialog = (item: AcgSearchItem) => {
    setSelectedItem(item);
    setCustomName(keyword.trim());
    setShowNameDialog(true);
  };

  // 确认下载
  const handleConfirmDownload = async () => {
    if (!selectedItem || !customName.trim()) {
      return;
    }

    setDownloadingId(selectedItem.guid);
    setShowNameDialog(false);

    try {
      const response = await fetch('/api/acg/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: selectedItem.torrentUrl,
          name: customName.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '添加下载任务失败');
      }

      setToast({
        message: data.message || '已添加到离线下载队列',
        type: 'success',
        onClose: () => setToast(null),
      });
    } catch (err: any) {
      setToast({
        message: err.message || '添加下载任务失败',
        type: 'error',
        onClose: () => setToast(null),
      });
    } finally {
      setDownloadingId(null);
      setSelectedItem(null);
      setCustomName('');
    }
  };

  if (loading && allItems.length === 0) {
    return (
      <div className='flex items-center justify-center py-12'>
        <div className='text-center'>
          <Loader2 className='mx-auto h-8 w-8 animate-spin text-green-600 dark:text-green-400' />
          <p className='mt-4 text-sm text-gray-600 dark:text-gray-400'>
            正在搜索动漫资源...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex items-center justify-center py-12'>
        <div className='text-center'>
          <AlertCircle className='mx-auto h-12 w-12 text-red-500 dark:text-red-400' />
          <p className='mt-4 text-sm text-red-600 dark:text-red-400'>{error}</p>
        </div>
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div className='flex items-center justify-center py-12'>
        <div className='text-center'>
          <AlertCircle className='mx-auto h-12 w-12 text-gray-400 dark:text-gray-600' />
          <p className='mt-4 text-sm text-gray-600 dark:text-gray-400'>
            未找到相关资源
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 结果列表 */}
      <div className='space-y-3'>
        {allItems.map((item) => (
          <div
            key={item.guid}
            className='p-4 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-green-400 dark:hover:border-green-600 transition-colors'
          >
            {/* 标题 */}
            <div className='mb-2 font-medium text-gray-900 dark:text-gray-100'>
              {item.title}
            </div>

            {/* 发布时间 */}
            <div className='mb-2 text-xs text-gray-500 dark:text-gray-400'>
              {new Date(item.pubDate).toLocaleString('zh-CN')}
            </div>

            {/* 图片预览 */}
            {item.images && item.images.length > 0 && (
              <div className='mb-3 flex gap-2 overflow-x-auto'>
                {item.images.slice(0, 3).map((img, imgIndex) => (
                  <img
                    key={imgIndex}
                    src={img}
                    alt=''
                    className='h-20 w-auto rounded object-cover'
                    loading='lazy'
                  />
                ))}
              </div>
            )}

            {/* 操作按钮 */}
            <div className='flex items-center gap-2'>
              <button
                onClick={() => handleOpenDownloadDialog(item)}
                disabled={downloadingId === item.guid}
                className='flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                title='存到私人影库'
              >
                {downloadingId === item.guid ? (
                  <>
                    <Loader2 className='h-4 w-4 animate-spin' />
                    <span>下载中...</span>
                  </>
                ) : (
                  <>
                    <Download className='h-4 w-4' />
                    <span>存到私人影库</span>
                  </>
                )}
              </button>
              <a
                href={item.link}
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-200 text-gray-700 text-sm hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors'
                title='查看详情'
              >
                <ExternalLink className='h-4 w-4' />
                <span>详情</span>
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* 加载更多指示器 */}
      {hasMore && (
        <div ref={loadMoreRef} className='flex items-center justify-center py-8'>
          <div className='text-center'>
            <Loader2 className='mx-auto h-6 w-6 animate-spin text-green-600 dark:text-green-400' />
            <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
              加载更多...
            </p>
          </div>
        </div>
      )}

      {/* 命名弹窗 */}
      {showNameDialog && (
        <div className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/50'>
          <div className='bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl'>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4'>
              设置资源名称
            </h3>
            <input
              type='text'
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder='请输入资源名称'
              className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500'
              autoFocus
            />
            <div className='mt-4 flex gap-2 justify-end'>
              <button
                onClick={() => {
                  setShowNameDialog(false);
                  setSelectedItem(null);
                  setCustomName('');
                }}
                className='px-4 py-2 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors'
              >
                取消
              </button>
              <button
                onClick={handleConfirmDownload}
                disabled={!customName.trim()}
                className='px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 提示 */}
      {toast && <Toast {...toast} />}
    </div>
  );
}
