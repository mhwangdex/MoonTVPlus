/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

    // 调试信息
    const debugInfo = {
      storageType,
      envVars: {
        hasRedisUrl: !!process.env.REDIS_URL,
        hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
        hasUpstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
        hasKvrocksUrl: !!process.env.KVROCKS_URL,
        watchRoomEnabled: process.env.WATCH_ROOM_ENABLED,
        watchRoomServerType: process.env.WATCH_ROOM_SERVER_TYPE,
        hasWatchRoomExternalUrl: !!process.env.WATCH_ROOM_EXTERNAL_SERVER_URL,
        hasWatchRoomExternalAuth: !!process.env.WATCH_ROOM_EXTERNAL_SERVER_AUTH,
      },
      watchRoomConfig: {
        enabled: process.env.WATCH_ROOM_ENABLED === 'true',
        serverType: process.env.WATCH_ROOM_SERVER_TYPE || 'internal',
        externalServerUrl: process.env.WATCH_ROOM_EXTERNAL_SERVER_URL,
        externalServerAuth: process.env.WATCH_ROOM_EXTERNAL_SERVER_AUTH ? '***' : undefined,
      },
      configReadError: null as string | null,
    };

    // 尝试读取配置（验证数据库连接）
    try {
      await getConfig();
    } catch (error) {
      debugInfo.configReadError = (error as Error).message;
    }

    return NextResponse.json(debugInfo, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Debug API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get debug info',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
