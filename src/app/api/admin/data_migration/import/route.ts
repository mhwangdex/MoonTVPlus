/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gunzip } from 'zlib';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { configSelfCheck, setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const gunzipAsync = promisify(gunzip);

export async function POST(req: NextRequest) {
  try {
    // 检查存储类型
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存储进行数据迁移' },
        { status: 400 }
      );
    }

    // 验证身份和权限
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 检查用户权限（只有站长可以导入数据）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json({ error: '权限不足，只有站长可以导入数据' }, { status: 401 });
    }

    // 解析表单数据
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;

    if (!file) {
      return NextResponse.json({ error: '请选择备份文件' }, { status: 400 });
    }

    if (!password) {
      return NextResponse.json({ error: '请提供解密密码' }, { status: 400 });
    }

    // 读取文件内容
    const encryptedData = await file.text();

    // 解密数据
    let decryptedData: string;
    try {
      decryptedData = SimpleCrypto.decrypt(encryptedData, password);
    } catch (error) {
      return NextResponse.json({ error: '解密失败，请检查密码是否正确' }, { status: 400 });
    }

    // 解压缩数据
    const compressedBuffer = Buffer.from(decryptedData, 'base64');
    const decompressedBuffer = await gunzipAsync(compressedBuffer);
    const decompressedData = decompressedBuffer.toString();

    // 解析JSON数据
    let importData: any;
    try {
      importData = JSON.parse(decompressedData);
    } catch (error) {
      return NextResponse.json({ error: '备份文件格式错误' }, { status: 400 });
    }

    // 验证数据格式
    if (!importData.data || !importData.data.adminConfig || !importData.data.userData) {
      return NextResponse.json({ error: '备份文件格式无效' }, { status: 400 });
    }

    // 开始导入数据 - 先清空现有数据
    await db.clearAllData();

    // 导入管理员配置
    importData.data.adminConfig = configSelfCheck(importData.data.adminConfig);
    await db.saveAdminConfig(importData.data.adminConfig);
    await setCachedConfig(importData.data.adminConfig);

    // 清除短剧视频源缓存（因为导入的配置可能包含不同的视频源）
    try {
      await db.deleteGlobalValue('duanju');
      console.log('已清除短剧视频源缓存');
    } catch (error) {
      console.error('清除短剧视频源缓存失败:', error);
      // 不影响主流程，继续执行
    }

    // 导入V2用户信息
    if (importData.data.usersV2 && Array.isArray(importData.data.usersV2)) {
      for (const userV2 of importData.data.usersV2) {
        try {
          // 跳过环境变量中的站长（站长使用环境变量认证）
          if (userV2.username === process.env.USERNAME) {
            console.log(`跳过站长 ${userV2.username} 的导入`);
            continue;
          }

          // 获取用户的加密密码
          const userData = importData.data.userData[userV2.username];
          const passwordV2 = userData?.passwordV2;

          if (passwordV2) {
            // 将站长角色转换为普通角色
            const importedRole = userV2.role === 'owner' ? 'user' : userV2.role;
            if (userV2.role === 'owner') {
              console.log(`用户 ${userV2.username} 的角色从 owner 转换为 user`);
            }

            // 直接使用加密后的密码创建用户
            const storage = (db as any).storage;
            if (storage && typeof storage.client?.hset === 'function') {
              const userInfoKey = `user:${userV2.username}:info`;
              const createdAt = userV2.created_at || Date.now();

              const userInfo: any = {
                role: importedRole,
                banned: userV2.banned,
                password: passwordV2,
                created_at: createdAt.toString(),
              };

              if (userV2.tags && userV2.tags.length > 0) {
                userInfo.tags = JSON.stringify(userV2.tags);
              }

              if (userV2.oidcSub) {
                userInfo.oidcSub = userV2.oidcSub;
                // 创建OIDC映射
                const oidcSubKey = `oidc:sub:${userV2.oidcSub}`;
                await storage.client.set(oidcSubKey, userV2.username);
              }

              if (userV2.enabledApis && userV2.enabledApis.length > 0) {
                userInfo.enabledApis = JSON.stringify(userV2.enabledApis);
              }

              await storage.client.hset(userInfoKey, userInfo);

              // 添加到用户列表（Sorted Set）
              const userListKey = 'user:list';
              await storage.client.zadd(userListKey, {
                score: createdAt,
                member: userV2.username,
              });

              console.log(`V2用户 ${userV2.username} 导入成功`);
            }
          }
        } catch (error) {
          console.error(`导入V2用户 ${userV2.username} 失败:`, error);
        }
      }
    }

    // 导入用户数据
    const userData = importData.data.userData;
    for (const username in userData) {
      const user = userData[username];

      // 重新注册用户（包含密码）- 仅用于旧版用户
      if (user.password && !importData.data.usersV2?.find((u: any) => u.username === username)) {
        await db.registerUser(username, user.password);
      }

      // 导入播放记录
      if (user.playRecords) {
        for (const [key, record] of Object.entries(user.playRecords)) {
          await (db as any).storage.setPlayRecord(username, key, record);
        }
      }

      // 导入收藏夹
      if (user.favorites) {
        for (const [key, favorite] of Object.entries(user.favorites)) {
          await (db as any).storage.setFavorite(username, key, favorite);
        }
      }

      // 导入搜索历史
      if (user.searchHistory && Array.isArray(user.searchHistory)) {
        for (const keyword of user.searchHistory.reverse()) { // 反转以保持顺序
          await db.addSearchHistory(username, keyword);
        }
      }

      // 导入跳过片头片尾配置
      if (user.skipConfigs) {
        for (const [key, skipConfig] of Object.entries(user.skipConfigs)) {
          const [source, id] = key.split('+');
          if (source && id) {
            await db.setSkipConfig(username, source, id, skipConfig as any);
          }
        }
      }
    }

    return NextResponse.json({
      message: '数据导入成功',
      importedUsers: Object.keys(userData).length,
      importedUsersV2: importData.data.usersV2?.length || 0,
      timestamp: importData.timestamp,
      serverVersion: typeof importData.serverVersion === 'string' ? importData.serverVersion : '未知版本'
    });

  } catch (error) {
    console.error('数据导入失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导入失败' },
      { status: 500 }
    );
  }
}
