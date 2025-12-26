/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { searchPansou } from '@/lib/pansou.client';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { keyword } = body;

    if (!keyword) {
      return NextResponse.json(
        { error: '关键词不能为空' },
        { status: 400 }
      );
    }

    // 从系统配置中获取 Pansou 配置
    const config = await getConfig();
    const apiUrl = config.SiteConfig.PansouApiUrl;
    const username = config.SiteConfig.PansouUsername;
    const password = config.SiteConfig.PansouPassword;

    console.log('Pansou 搜索请求:', {
      keyword,
      apiUrl: apiUrl ? '已配置' : '未配置',
      hasAuth: !!(username && password),
    });

    if (!apiUrl) {
      return NextResponse.json(
        { error: '未配置 Pansou API 地址，请在管理面板配置' },
        { status: 400 }
      );
    }

    // 调用 Pansou 搜索
    const results = await searchPansou(apiUrl, keyword, {
      username,
      password,
    });

    console.log('Pansou 搜索结果:', {
      total: results.total,
      hasData: !!results.merged_by_type,
      types: results.merged_by_type ? Object.keys(results.merged_by_type) : [],
    });

    return NextResponse.json(results);
  } catch (error: any) {
    console.error('Pansou 搜索失败:', error);
    return NextResponse.json(
      { error: error.message || '搜索失败' },
      { status: 500 }
    );
  }
}
