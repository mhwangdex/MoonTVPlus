'use client';

import { useEffect } from 'react';
import { initDanmakuModule } from '@/lib/danmaku/api';

/**
 * 弹幕缓存清理组件
 * 在应用启动时执行一次过期缓存清理
 */
export function DanmakuCacheCleanup() {
  useEffect(() => {
    // 只在客户端执行一次
    initDanmakuModule();
  }, []);

  // 这个组件不渲染任何内容
  return null;
}
