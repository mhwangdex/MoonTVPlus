'use client';

import { X, Calendar, Star, Clock, Tag, Users, Globe, Film } from 'lucide-react';
import Image from 'next/image';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface DetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  poster?: string;
  doubanId?: number;
  bangumiId?: number;
  isBangumi?: boolean;
  tmdbId?: number;
  type?: 'movie' | 'tv';
  seasonNumber?: number;
  cmsData?: {
    desc?: string;
    episodes?: string[];
    episodes_titles?: string[];
  };
  // 用于调用 source-detail API
  sourceId?: string;
  source?: string;
}

interface DetailData {
  title: string;
  originalTitle?: string;
  year?: string;
  poster?: string;
  rating?: {
    value: number;
    count: number;
  };
  intro?: string;
  genres?: string[];
  directors?: Array<{ name: string }>;
  actors?: Array<{ name: string }>;
  countries?: string[];
  languages?: string[];
  duration?: string;
  episodesCount?: number;
  releaseDate?: string;
  status?: string;
  tagline?: string;
  seasons?: number;
  overview?: string;
}

const DetailPanel: React.FC<DetailPanelProps> = ({
  isOpen,
  onClose,
  title,
  poster,
  doubanId,
  bangumiId,
  isBangumi,
  tmdbId,
  type = 'movie',
  seasonNumber,
  cmsData,
  sourceId,
  source,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 确保组件在客户端挂载后才渲染 Portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // 控制动画状态
  useEffect(() => {
    let animationId: number;
    let timer: NodeJS.Timeout;

    if (isOpen) {
      setIsVisible(true);
      animationId = requestAnimationFrame(() => {
        animationId = requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      setIsAnimating(false);
      timer = setTimeout(() => {
        setIsVisible(false);
      }, 200);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isOpen]);

  // 阻止背景滚动
  useEffect(() => {
    if (isVisible) {
      // 保存当前滚动位置
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      const body = document.body;
      const html = document.documentElement;

      // 获取滚动条宽度
      const scrollBarWidth = window.innerWidth - html.clientWidth;

      // 保存原始样式
      const originalBodyStyle = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        paddingRight: body.style.paddingRight,
        overflow: body.style.overflow,
      };

      // 设置body样式来阻止滚动，但保持原位置
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = `-${scrollX}px`;
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      body.style.paddingRight = `${scrollBarWidth}px`;

      return () => {
        // 恢复所有原始样式
        body.style.position = originalBodyStyle.position;
        body.style.top = originalBodyStyle.top;
        body.style.left = originalBodyStyle.left;
        body.style.right = originalBodyStyle.right;
        body.style.width = originalBodyStyle.width;
        body.style.paddingRight = originalBodyStyle.paddingRight;
        body.style.overflow = originalBodyStyle.overflow;

        // 使用 requestAnimationFrame 确保样式恢复后再滚动
        requestAnimationFrame(() => {
          window.scrollTo(scrollX, scrollY);
        });
      };
    }
  }, [isVisible]);

  // ESC键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isVisible, onClose]);

  // 获取详情数据
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const fetchDetail = async () => {
      setLoading(true);
      setError(null);

      try {
        // 优先使用苹果CMS数据（短剧等）
        // 如果 cmsData 存在但 desc 为空，尝试通过 source-detail API 获取
        if (cmsData) {
          if (cmsData.desc) {
            // 有 desc，直接使用
            setDetailData({
              title: title,
              intro: cmsData.desc,
              episodesCount: cmsData.episodes?.length,
              poster: poster,
            });
            setLoading(false);
            return;
          }

          // cmsData 存在但 desc 为空，尝试通过 API 获取详情
          if (sourceId && source) {
            try {
              const response = await fetch(
                `/api/source-detail?id=${encodeURIComponent(sourceId)}&source=${encodeURIComponent(source)}&title=${encodeURIComponent(title)}`
              );
              if (response.ok) {
                const data = await response.json();
                setDetailData({
                  title: data.title || title,
                  intro: data.desc || '',
                  episodesCount: data.episodes?.length || cmsData.episodes?.length,
                  poster: data.poster || poster,
                  year: data.year,
                });
                setLoading(false);
                return;
              }
            } catch (err) {
              console.error('获取source-detail失败:', err);
              // 继续执行后续逻辑
            }
          }
        }

        // 优先使用 Bangumi ID（因为 isBangumi 为 true 时，doubanId 实际上是 bangumiId）
        if (bangumiId || (isBangumi && doubanId)) {
          const actualBangumiId = bangumiId || doubanId;
          const response = await fetch(`https://api.bgm.tv/v0/subjects/${actualBangumiId}`);
          if (!response.ok) {
            throw new Error('获取Bangumi详情失败');
          }
          const data = await response.json();

          setDetailData({
            title: data.name_cn || data.name,
            originalTitle: data.name,
            year: data.date ? data.date.substring(0, 4) : undefined,
            poster: data.images?.large || poster,
            rating: data.rating
              ? {
                  value: data.rating.score,
                  count: data.rating.total,
                }
              : undefined,
            intro: data.summary,
            genres: data.tags?.map((tag: any) => tag.name).slice(0, 5),
            episodesCount: data.eps,
            releaseDate: data.date,
          });
          return;
        }

        // 使用豆瓣ID
        if (doubanId && !isBangumi) {
          const response = await fetch(`/api/douban/detail?id=${doubanId}`);
          if (!response.ok) {
            throw new Error('获取豆瓣详情失败');
          }
          const data = await response.json();

          setDetailData({
            title: data.title,
            originalTitle: data.original_title,
            year: data.year,
            poster: data.pic?.large || data.pic?.normal || poster,
            rating: data.rating
              ? {
                  value: data.rating.value,
                  count: data.rating.count,
                }
              : undefined,
            intro: data.intro,
            genres: data.genres,
            directors: data.directors,
            actors: data.actors,
            countries: data.countries,
            languages: data.languages,
            duration: data.durations?.[0],
            episodesCount: data.episodes_count,
          });
          return;
        }

        // 使用 TMDB 搜索
        if (title) {
          // 移除季度信息进行搜索
          let searchTitle = title;
          let extractedSeasonNumber = seasonNumber;

          // 匹配各种季度格式: 第一季、第1季、第一部、Season 1、S1等
          const seasonPatterns = [
            /第([一二三四五六七八九十\d]+)[季部]/,
            /Season\s*(\d+)/i,
            /S(\d+)/i,
          ];

          for (const pattern of seasonPatterns) {
            const match = title.match(pattern);
            if (match) {
              searchTitle = title.replace(pattern, '').trim();
              // 如果没有传入seasonNumber,尝试从标题中提取
              if (!extractedSeasonNumber) {
                const seasonStr = match[1];
                // 中文数字转数字
                const chineseNumbers: Record<string, number> = {
                  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
                  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
                };
                extractedSeasonNumber = chineseNumbers[seasonStr] || parseInt(seasonStr) || undefined;
              }
              break;
            }
          }

          const searchResponse = await fetch(
            `/api/tmdb/search?query=${encodeURIComponent(searchTitle)}`
          );
          if (!searchResponse.ok) {
            throw new Error('搜索失败');
          }
          const searchData = await searchResponse.json();

          if (searchData.results && searchData.results.length > 0) {
            const result = searchData.results[0];
            const detailId = result.id;
            const mediaType = result.media_type || type;

            // 获取详情
            const detailResponse = await fetch(`/api/tmdb/detail?id=${detailId}&type=${mediaType}`);
            if (!detailResponse.ok) {
              throw new Error('获取TMDB详情失败');
            }
            const detailResult = await detailResponse.json();

            // 如果有季度信息,尝试获取季度详情
            let seasonData = null;
            if (extractedSeasonNumber && mediaType === 'tv') {
              try {
                const seasonResponse = await fetch(
                  `/api/tmdb/seasons?id=${detailId}&season=${extractedSeasonNumber}`
                );
                if (seasonResponse.ok) {
                  seasonData = await seasonResponse.json();
                }
              } catch (err) {
                console.error('获取季度信息失败', err);
              }
            }

            setDetailData({
              title: mediaType === 'movie' ? detailResult.title : detailResult.name,
              originalTitle:
                mediaType === 'movie' ? detailResult.original_title : detailResult.original_name,
              year:
                mediaType === 'movie'
                  ? detailResult.release_date?.substring(0, 4)
                  : detailResult.first_air_date?.substring(0, 4),
              poster: detailResult.poster_path
                ? `https://image.tmdb.org/t/p/w500${detailResult.poster_path}`
                : poster,
              rating: detailResult.vote_average
                ? {
                    value: detailResult.vote_average,
                    count: detailResult.vote_count,
                  }
                : undefined,
              intro: seasonData?.overview || detailResult.overview,
              genres: detailResult.genres?.map((g: any) => g.name),
              countries: detailResult.production_countries?.map((c: any) => c.name),
              languages: detailResult.spoken_languages?.map((l: any) => l.name),
              duration: detailResult.runtime ? `${detailResult.runtime}分钟` : undefined,
              episodesCount: seasonData?.episodes?.length || detailResult.number_of_episodes,
              releaseDate:
                mediaType === 'movie' ? detailResult.release_date : detailResult.first_air_date,
              status: detailResult.status,
              tagline: detailResult.tagline,
              seasons: detailResult.number_of_seasons,
              overview: detailResult.overview,
            });
            return;
          }

          throw new Error('未找到相关内容');
        }

        throw new Error('缺少必要的查询参数');
      } catch (err) {
        console.error('获取详情失败:', err);
        setError(err instanceof Error ? err.message : '获取详情失败');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [isOpen, doubanId, bangumiId, isBangumi, tmdbId, title, type, seasonNumber, poster, cmsData, sourceId, source]);

  if (!isVisible || !mounted) return null;

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out ${
          isAnimating ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        style={{
          backdropFilter: 'blur(4px)',
          willChange: 'opacity',
        }}
      />

      {/* 详情面板 */}
      <div
        className="relative w-full max-w-2xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden transition-all duration-200 ease-out"
        style={{
          willChange: 'transform, opacity',
          backfaceVisibility: 'hidden',
          transform: isAnimating ? 'scale(1) translateZ(0)' : 'scale(0.95) translateZ(0)',
          opacity: isAnimating ? 1 : 0,
        }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">详情</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
          >
            <X size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="overflow-y-auto max-h-[calc(90vh-4rem)]">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
            </div>
          )}

          {error && (
            <div className="p-6 text-center">
              <p className="text-red-500 dark:text-red-400">{error}</p>
            </div>
          )}

          {!loading && !error && detailData && (
            <div className="p-6">
              {/* 海报和基本信息 */}
              <div className="flex gap-6 mb-6">
                {detailData.poster && (
                  <div className="relative w-32 h-48 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0">
                    <Image src={detailData.poster} alt={detailData.title} fill className="object-cover" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                    {detailData.title}
                  </h3>
                  {detailData.originalTitle && detailData.originalTitle !== detailData.title && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                      {detailData.originalTitle}
                    </p>
                  )}

                  {/* 评分 */}
                  {detailData.rating && (
                    <div className="flex items-center gap-2 mb-3">
                      <Star
                        size={20}
                        className="text-yellow-500 fill-yellow-500"
                      />
                      <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {detailData.rating.value.toFixed(1)}
                      </span>
                      {detailData.rating.count > 0 && (
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          ({detailData.rating.count} 评价)
                        </span>
                      )}
                    </div>
                  )}

                  {/* 类型标签 */}
                  {detailData.genres && detailData.genres.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {detailData.genres.map((genre, index) => (
                        <span
                          key={index}
                          className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                        >
                          {genre}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 年份和时长 */}
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
                    {detailData.year && (
                      <div className="flex items-center gap-1">
                        <Calendar size={16} />
                        <span>{detailData.year}</span>
                      </div>
                    )}
                    {detailData.duration && (
                      <div className="flex items-center gap-1">
                        <Clock size={16} />
                        <span>{detailData.duration}</span>
                      </div>
                    )}
                    {detailData.episodesCount && (
                      <div className="flex items-center gap-1">
                        <Film size={16} />
                        <span>{detailData.episodesCount} 集</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 简介 */}
              {(detailData.intro || detailData.overview) && (
                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    简介
                  </h4>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {detailData.intro || detailData.overview}
                  </p>
                </div>
              )}

              {/* 导演和演员 */}
              {detailData.directors && detailData.directors.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                    <Users size={16} />
                    导演
                  </h4>
                  <p className="text-gray-700 dark:text-gray-300">
                    {detailData.directors.map((d) => d.name).join(', ')}
                  </p>
                </div>
              )}

              {detailData.actors && detailData.actors.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
                    <Users size={16} />
                    演员
                  </h4>
                  <p className="text-gray-700 dark:text-gray-300">
                    {detailData.actors.slice(0, 10).map((a) => a.name).join(', ')}
                  </p>
                </div>
              )}

              {/* 制作信息 */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                {detailData.countries && detailData.countries.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-1">
                      <Globe size={14} />
                      国家/地区
                    </h4>
                    <p className="text-gray-700 dark:text-gray-300">
                      {detailData.countries.join(', ')}
                    </p>
                  </div>
                )}

                {detailData.languages && detailData.languages.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-1">
                      <Tag size={14} />
                      语言
                    </h4>
                    <p className="text-gray-700 dark:text-gray-300">
                      {detailData.languages.join(', ')}
                    </p>
                  </div>
                )}

                {detailData.releaseDate && (
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-1">
                      <Calendar size={14} />
                      上映日期
                    </h4>
                    <p className="text-gray-700 dark:text-gray-300">{detailData.releaseDate}</p>
                  </div>
                )}

                {detailData.status && (
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">状态</h4>
                    <p className="text-gray-700 dark:text-gray-300">{detailData.status}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

export default DetailPanel;
