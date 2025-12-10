'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { M3U8Downloader, M3U8DownloadTask } from '@/lib/m3u8-downloader';

interface DownloadContextType {
  downloader: M3U8Downloader;
  tasks: M3U8DownloadTask[];
  addDownloadTask: (url: string, title: string, type?: 'TS' | 'MP4') => Promise<void>;
  startTask: (taskId: string) => void;
  pauseTask: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  retryFailedSegments: (taskId: string) => void;
  getProgress: (taskId: string) => number;
  downloadingCount: number;
  showDownloadPanel: boolean;
  setShowDownloadPanel: (show: boolean) => void;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [downloader] = useState(() => new M3U8Downloader({
    onProgress: (task) => {
      setTasks(downloader.getAllTasks());
    },
    onComplete: (task) => {
      setTasks(downloader.getAllTasks());
    },
    onError: (task, error) => {
      console.error('下载错误:', error);
      setTasks(downloader.getAllTasks());
    },
  }));

  const [tasks, setTasks] = useState<M3U8DownloadTask[]>([]);
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);

  const addDownloadTask = useCallback(async (url: string, title: string, type: 'TS' | 'MP4' = 'TS') => {
    try {
      const taskId = await downloader.createTask(url, title, type);
      setTasks(downloader.getAllTasks());
      await downloader.startTask(taskId);
      setTasks(downloader.getAllTasks());
    } catch (error) {
      console.error('添加下载任务失败:', error);
      throw error;
    }
  }, [downloader]);

  const startTask = useCallback((taskId: string) => {
    downloader.startTask(taskId);
    setTasks(downloader.getAllTasks());
  }, [downloader]);

  const pauseTask = useCallback((taskId: string) => {
    downloader.pauseTask(taskId);
    setTasks(downloader.getAllTasks());
  }, [downloader]);

  const cancelTask = useCallback((taskId: string) => {
    downloader.cancelTask(taskId);
    setTasks(downloader.getAllTasks());
  }, [downloader]);

  const retryFailedSegments = useCallback((taskId: string) => {
    downloader.retryFailedSegments(taskId);
    setTasks(downloader.getAllTasks());
  }, [downloader]);

  const getProgress = useCallback((taskId: string) => {
    return downloader.getProgress(taskId);
  }, [downloader]);

  const downloadingCount = tasks.filter(t => t.status === 'downloading').length;

  return (
    <DownloadContext.Provider
      value={{
        downloader,
        tasks,
        addDownloadTask,
        startTask,
        pauseTask,
        cancelTask,
        retryFailedSegments,
        getProgress,
        downloadingCount,
        showDownloadPanel,
        setShowDownloadPanel,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  const context = useContext(DownloadContext);
  if (context === undefined) {
    throw new Error('useDownload must be used within a DownloadProvider');
  }
  return context;
}
