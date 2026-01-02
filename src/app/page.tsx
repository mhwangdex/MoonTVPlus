/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronRight, Bot, ListVideo } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { getTMDBImageUrl, TMDBItem } from '@/lib/tmdb.client';
import { DoubanItem } from '@/lib/types';

import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';
import HttpWarningDialog from '@/components/HttpWarningDialog';
import BannerCarousel from '@/components/BannerCarousel';
import AIChatPanel from '@/components/AIChatPanel';

function HomeClient() {
  // 移除了 activeTab 状态，收藏夹功能已移到 UserMenu
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [hotDuanju, setHotDuanju] = useState<any[]>([]);
  const [upcomingContent, setUpcomingContent] = useState<TMDBItem[]>([]);
  const [bangumiCalendarData, setBangumiCalendarData] = useState<
    BangumiCalendarData[]
  >([]);
  const [loading, setLoading] = useState(true);
  const { announcement } = useSite();

  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [showHttpWarning, setShowHttpWarning] = useState(true);
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [sourceSearchEnabled, setSourceSearchEnabled] = useState(true);

  // 检查AI功能是否启用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled =
        (window as any).RUNTIME_CONFIG?.AI_ENABLED &&
        (window as any).RUNTIME_CONFIG?.AI_ENABLE_HOMEPAGE_ENTRY;
      setAiEnabled(enabled);
    }
  }, []);

  // 检查源站寻片功能是否启用
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled = (window as any).RUNTIME_CONFIG?.ENABLE_SOURCE_SEARCH !== false;
      setSourceSearchEnabled(enabled);
    }
  }, []);

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  useEffect(() => {
    const CACHE_DURATION = 60 * 60 * 1000; // 1小时

    const getCache = (key: string) => {
      try {
        const cached = localStorage.getItem(key);
        if (!cached) return null;
        const { data, timestamp } = JSON.parse(cached);
        return { data, expired: Date.now() - timestamp > CACHE_DURATION };
      } catch {
        return null;
      }
    };

    const setCache = (key: string, data: any) => {
      try {
        localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
      } catch {}
    };

    const moviesCache = getCache('homepage_movies');
    const tvShowsCache = getCache('homepage_tvshows');
    const varietyCache = getCache('homepage_variety');
    const bangumiCache = getCache('homepage_bangumi');
    const duanjuCache = getCache('homepage_duanju');
    const upcomingCache = getCache('homepage_upcoming');

    if (moviesCache?.data) setHotMovies(moviesCache.data);
    if (tvShowsCache?.data) setHotTvShows(tvShowsCache.data);
    if (varietyCache?.data) setHotVarietyShows(varietyCache.data);
    if (bangumiCache?.data) setBangumiCalendarData(bangumiCache.data);
    if (duanjuCache?.data) setHotDuanju(duanjuCache.data);
    if (upcomingCache?.data) setUpcomingContent(upcomingCache.data);

    const hasCache = moviesCache || tvShowsCache || varietyCache || bangumiCache || duanjuCache || upcomingCache;
    if (hasCache) setLoading(false);

    const needsRefresh = !moviesCache || moviesCache.expired || !tvShowsCache || tvShowsCache.expired ||
                         !varietyCache || varietyCache.expired || !bangumiCache || bangumiCache.expired ||
                         !duanjuCache || duanjuCache.expired || !upcomingCache || upcomingCache.expired;

    if (needsRefresh) {
      (async () => {
        try {
          const [moviesData, tvShowsData, varietyShowsData, bangumiCalendarData] = await Promise.all([
            getDoubanCategories({ kind: 'movie', category: '热门', type: '全部' }),
            getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
            getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
            GetBangumiCalendarData(),
          ]);

          if (moviesData.code === 200) {
            setHotMovies(moviesData.list);
            setCache('homepage_movies', moviesData.list);
          }
          if (tvShowsData.code === 200) {
            setHotTvShows(tvShowsData.list);
            setCache('homepage_tvshows', tvShowsData.list);
          }
          if (varietyShowsData.code === 200) {
            setHotVarietyShows(varietyShowsData.list);
            setCache('homepage_variety', varietyShowsData.list);
          }
          setBangumiCalendarData(bangumiCalendarData);
          setCache('homepage_bangumi', bangumiCalendarData);

          try {
            const duanjuResponse = await fetch('/api/duanju/recommends');
            if (duanjuResponse.ok) {
              const duanjuResult = await duanjuResponse.json();
              if (duanjuResult.code === 200 && duanjuResult.data) {
                setHotDuanju(duanjuResult.data);
                setCache('homepage_duanju', duanjuResult.data);
              }
            }
          } catch (error) {
            console.error('获取热播短剧数据失败:', error);
          }

          try {
            const response = await fetch('/api/tmdb/upcoming');
            if (response.ok) {
              const result = await response.json();
              if (result.code === 200 && result.data) {
                const sorted = [...result.data].sort((a, b) => {
                  const dateA = new Date(a.release_date || '9999-12-31').getTime();
                  const dateB = new Date(b.release_date || '9999-12-31').getTime();
                  return dateA - dateB;
                });
                setUpcomingContent(sorted);
                setCache('homepage_upcoming', sorted);
              }
            }
          } catch (error) {
            console.error('获取TMDB即将上映数据失败:', error);
          }

          setLoading(false);
        } catch (error) {
          console.error('获取推荐数据失败:', error);
          setLoading(false);
        }
      })();
    }
  }, []);



  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  return (
    <PageLayout>
      {/* TMDB 热门轮播图 */}
      <div className='w-full mb-4'>
        <BannerCarousel />
      </div>

      <div className='px-2 sm:px-10 pb-4 sm:pb-8 overflow-visible'>
        <div className='max-w-[95%] mx-auto'>
          {/* 首页内容 */}
          <>
              {/* 源站寻片和AI问片入口 */}
              <div className='flex items-center justify-end gap-2 mb-4'>
                {/* 源站寻片入口 */}
                {sourceSearchEnabled && (
                  <Link href='/source-search'>
                    <button
                      className='p-2 rounded-lg text-blue-500 hover:text-blue-600 transition-colors'
                      title='源站寻片'
                    >
                      <ListVideo size={20} />
                    </button>
                  </Link>
                )}

                {/* AI问片入口 */}
                {aiEnabled && (
                  <button
                    onClick={() => setShowAIChat(true)}
                    className='p-2 rounded-lg text-purple-500 hover:text-purple-600 transition-colors'
                    title='AI问片'
                  >
                    <Bot size={20} />
                  </button>
                )}
              </div>

              {/* 继续观看 */}
              <ContinueWatching />

              {/* 热门电影 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    热门电影
                  </h2>
                  <Link
                    href='/douban?type=movie'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? // 加载状态显示灰色占位数据
                      Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <div className='aspect-[2/3] bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                          <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4' />
                        </div>
                      ))
                    : hotMovies.map((movie) => (
                        <div
                          key={movie.id}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <VideoCard
                            id={movie.id}
                            poster={movie.poster}
                            title={movie.title}
                            year={movie.year}
                            rate={movie.rate}
                            type='movie'
                            from='douban'
                          />
                        </div>
                      ))}
                </ScrollableRow>
              </section>

              {/* 热播短剧 */}
              {hotDuanju.length > 0 && (
                <section className='mb-8'>
                  <div className='mb-4 flex items-center justify-between'>
                    <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                      热播短剧
                    </h2>
                  </div>
                  <ScrollableRow>
                    {loading
                      ? Array.from({ length: 8 }).map((_, index) => (
                          <div
                            key={index}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <div className='aspect-[2/3] bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                            <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4' />
                          </div>
                        ))
                      : hotDuanju.map((duanju) => (
                          <div
                            key={duanju.id + duanju.source}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <VideoCard
                              id={duanju.id}
                              source={duanju.source}
                              poster={duanju.poster}
                              title={duanju.title}
                              year={duanju.year}
                              type='tv'
                              from='search'
                              source_name={duanju.source_name}
                              episodes={duanju.episodes?.length}
                              douban_id={duanju.douban_id}
                              cmsData={{
                                desc: duanju.desc,
                                episodes: duanju.episodes,
                                episodes_titles: duanju.episodes_titles,
                              }}
                            />
                          </div>
                        ))}
                  </ScrollableRow>
                </section>
              )}

              {/* 每日新番放送 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    新番放送
                  </h2>
                  <Link
                    href='/douban?type=anime'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? // 加载状态显示灰色占位数据
                      Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                            <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                          </div>
                          <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                        </div>
                      ))
                    : // 展示当前日期的番剧
                      (() => {
                        // 获取当前日期对应的星期
                        const today = new Date();
                        const weekdays = [
                          'Sun',
                          'Mon',
                          'Tue',
                          'Wed',
                          'Thu',
                          'Fri',
                          'Sat',
                        ];
                        const currentWeekday = weekdays[today.getDay()];

                        // 找到当前星期对应的番剧数据，并过滤掉没有图片的
                        const todayAnimes =
                          bangumiCalendarData
                            .find((item) => item.weekday.en === currentWeekday)
                            ?.items.filter((anime) => anime.images) || [];

                        return todayAnimes.map((anime, index) => (
                          <div
                            key={`${anime.id}-${index}`}
                            className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                          >
                            <VideoCard
                              from='douban'
                              title={anime.name_cn || anime.name}
                              poster={
                                anime.images?.large ||
                                anime.images?.common ||
                                anime.images?.medium ||
                                anime.images?.small ||
                                anime.images?.grid ||
                                ''
                              }
                              douban_id={anime.id}
                              rate={anime.rating?.score?.toFixed(1) || ''}
                              year={anime.air_date?.split('-')?.[0] || ''}
                              isBangumi={true}
                            />
                          </div>
                        ));
                      })()}
                </ScrollableRow>
              </section>

              {/* 热门剧集 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    热门剧集
                  </h2>
                  <Link
                    href='/douban?type=tv'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <div className='aspect-[2/3] bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                          <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4' />
                        </div>
                      ))
                    : hotTvShows.map((tvShow) => (
                        <div
                          key={tvShow.id}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <VideoCard
                            id={tvShow.id}
                            poster={tvShow.poster}
                            title={tvShow.title}
                            year={tvShow.year}
                            rate={tvShow.rate}
                            type='tv'
                            from='douban'
                          />
                        </div>
                      ))}
                </ScrollableRow>
              </section>

              {/* 热门综艺 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    热门综艺
                  </h2>
                  <Link
                    href='/douban?type=tv&category=show'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <div className='aspect-[2/3] bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-2' />
                          <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4' />
                        </div>
                      ))
                    : hotVarietyShows.map((varietyShow) => (
                        <div
                          key={varietyShow.id}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <VideoCard
                            id={varietyShow.id}
                            poster={varietyShow.poster}
                            title={varietyShow.title}
                            year={varietyShow.year}
                            rate={varietyShow.rate}
                            type='tv'
                            from='douban'
                          />
                        </div>
                      ))}
                </ScrollableRow>
              </section>

              {/* 即将上映/播出 (TMDB) */}
              {upcomingContent.length > 0 && (
                <section className='mb-8'>
                  <div className='mb-4 flex items-center justify-between'>
                    <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                      即将上映
                    </h2>
                  </div>
                  <ScrollableRow>
                    {upcomingContent.map((item) => (
                      <div
                        key={`${item.media_type}-${item.id}`}
                        className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                      >
                        <VideoCard
                          title={item.title}
                          poster={getTMDBImageUrl(item.poster_path)}
                          year={item.release_date?.split('-')?.[0] || ''}
                          rate={
                            item.vote_average && item.vote_average > 0
                              ? item.vote_average.toFixed(1)
                              : ''
                          }
                          type={item.media_type === 'tv' ? 'tv' : 'movie'}
                          from='douban'
                          releaseDate={item.release_date}
                          isUpcoming={true}
                        />
                      </div>
                    ))}
                  </ScrollableRow>
                </section>
              )}
          </>
        </div>
      </div>

      {/* HTTP 环境警告弹窗 */}
      {showHttpWarning && (
        <HttpWarningDialog onClose={() => setShowHttpWarning(false)} />
      )}

      {/* AI问片面板 */}
      {aiEnabled && (
        <AIChatPanel
          isOpen={showAIChat}
          onClose={() => setShowAIChat(false)}
          welcomeMessage='你好！我是MoonTVPlus的AI影视助手。想看什么电影或剧集？需要推荐吗？'
        />
      )}

      {/* 公告弹窗 */}
      {showAnnouncement && (
        <div className='fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'>
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6'>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3'>
              公告
            </h3>
            <div className='text-gray-700 dark:text-gray-300 mb-4 whitespace-pre-wrap'>
              {announcement}
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement || '')}
              className='w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors'
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
