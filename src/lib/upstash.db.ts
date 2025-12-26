/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { Redis } from '@upstash/redis';

import { AdminConfig } from './admin.types';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';
import { userInfoCache } from './user-cache';

// 搜索历史最大条数
const SEARCH_HISTORY_LIMIT = 20;

// 数据类型转换辅助函数
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 添加Upstash Redis操作重试包装器
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = i === maxRetries - 1;
      const isConnectionError =
        err.message?.includes('Connection') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ENOTFOUND') ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.name === 'UpstashError';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Upstash Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

export class UpstashRedisStorage implements IStorage {
  private client: Redis;

  constructor() {
    this.client = getUpstashRedisClient();
  }

  // ---------- 播放记录 ----------
  private prKey(user: string, key: string) {
    return `u:${user}:pr:${key}`; // u:username:pr:source+id
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await withRetry(() =>
      this.client.get(this.prKey(userName, key))
    );
    return val ? (val as PlayRecord) : null;
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await withRetry(() => this.client.set(this.prKey(userName, key), record));
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const pattern = `u:${userName}:pr:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, PlayRecord> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        // 截取 source+id 部分
        const keyPart = ensureString(fullKey.replace(`u:${userName}:pr:`, ''));
        result[keyPart] = value as PlayRecord;
      }
    }
    return result;
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.prKey(userName, key)));
  }

  // ---------- 收藏 ----------
  private favKey(user: string, key: string) {
    return `u:${user}:fav:${key}`;
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await withRetry(() =>
      this.client.get(this.favKey(userName, key))
    );
    return val ? (val as Favorite) : null;
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.favKey(userName, key), favorite)
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const pattern = `u:${userName}:fav:*`;
    const keys: string[] = await withRetry(() => this.client.keys(pattern));
    if (keys.length === 0) return {};

    const result: Record<string, Favorite> = {};
    for (const fullKey of keys) {
      const value = await withRetry(() => this.client.get(fullKey));
      if (value) {
        const keyPart = ensureString(fullKey.replace(`u:${userName}:fav:`, ''));
        result[keyPart] = value as Favorite;
      }
    }
    return result;
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.del(this.favKey(userName, key)));
  }

  // ---------- 用户注册 / 登录 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await withRetry(() => this.client.set(this.userPwdKey(userName), password));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    // 确保比较时都是字符串类型
    return ensureString(stored) === password;
  }

  // 检查用户是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判断 key 是否存在
    const exists = await withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改用户密码
  async changePassword(userName: string, newPassword: string): Promise<void> {
    // 简单存储明文密码，生产环境应加密
    await withRetry(() =>
      this.client.set(this.userPwdKey(userName), newPassword)
    );
  }

  // 删除用户及其所有数据
  async deleteUser(userName: string): Promise<void> {
    // 删除用户密码
    await withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 删除搜索历史
    await withRetry(() => this.client.del(this.shKey(userName)));

    // 删除播放记录
    const playRecordPattern = `u:${userName}:pr:*`;
    const playRecordKeys = await withRetry(() =>
      this.client.keys(playRecordPattern)
    );
    if (playRecordKeys.length > 0) {
      await withRetry(() => this.client.del(...playRecordKeys));
    }

    // 删除收藏夹
    const favoritePattern = `u:${userName}:fav:*`;
    const favoriteKeys = await withRetry(() =>
      this.client.keys(favoritePattern)
    );
    if (favoriteKeys.length > 0) {
      await withRetry(() => this.client.del(...favoriteKeys));
    }

    // 删除跳过片头片尾配置
    const skipConfigPattern = `u:${userName}:skip:*`;
    const skipConfigKeys = await withRetry(() =>
      this.client.keys(skipConfigPattern)
    );
    if (skipConfigKeys.length > 0) {
      await withRetry(() => this.client.del(...skipConfigKeys));
    }
  }

  // ---------- 新版用户存储（使用Hash和Sorted Set） ----------
  private userInfoKey(userName: string) {
    return `user:${userName}:info`;
  }

  private userListKey() {
    return 'user:list';
  }

  private oidcSubKey(oidcSub: string) {
    return `oidc:sub:${oidcSub}`;
  }

  // SHA256加密密码
  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // 创建新用户（新版本）
  async createUserV2(
    userName: string,
    password: string,
    role: 'owner' | 'admin' | 'user' = 'user',
    tags?: string[],
    oidcSub?: string,
    enabledApis?: string[]
  ): Promise<void> {
    // 先检查用户是否已存在（原子性检查）
    const exists = await withRetry(() =>
      this.client.exists(this.userInfoKey(userName))
    );
    if (exists === 1) {
      throw new Error('用户已存在');
    }

    const hashedPassword = await this.hashPassword(password);
    const createdAt = Date.now();

    // 存储用户信息到Hash
    const userInfo: Record<string, any> = {
      role,
      banned: false,  // 直接使用布尔值
      password: hashedPassword,
      created_at: createdAt.toString(),
    };

    if (tags && tags.length > 0) {
      userInfo.tags = JSON.stringify(tags);
    }

    if (oidcSub) {
      userInfo.oidcSub = oidcSub;
      // 创建OIDC映射
      await withRetry(() => this.client.set(this.oidcSubKey(oidcSub), userName));
    }

    if (enabledApis && enabledApis.length > 0) {
      userInfo.enabledApis = JSON.stringify(enabledApis);
    }

    await withRetry(() => this.client.hset(this.userInfoKey(userName), userInfo));

    // 添加到用户列表（Sorted Set，按注册时间排序）
    await withRetry(() => this.client.zadd(this.userListKey(), {
      score: createdAt,
      member: userName,
    }));

    // 如果创建的是站长用户，清除站长存在状态缓存
    if (userName === process.env.USERNAME) {
      const { ownerExistenceCache } = await import('./user-cache');
      ownerExistenceCache.delete(userName);
    }
  }

  // 验证用户密码（新版本）
  async verifyUserV2(userName: string, password: string): Promise<boolean> {
    const userInfo = await withRetry(() =>
      this.client.hgetall(this.userInfoKey(userName))
    );

    if (!userInfo || !userInfo.password) {
      return false;
    }

    const hashedPassword = await this.hashPassword(password);
    return userInfo.password === hashedPassword;
  }

  // 获取用户信息（新版本）
  async getUserInfoV2(userName: string): Promise<{
    role: 'owner' | 'admin' | 'user';
    banned: boolean;
    tags?: string[];
    oidcSub?: string;
    enabledApis?: string[];
    created_at: number;
  } | null> {
    // 先从缓存获取
    const cached = userInfoCache?.get(userName);
    if (cached) {
      return cached;
    }

    const userInfo = await withRetry(() =>
      this.client.hgetall(this.userInfoKey(userName))
    );

    if (!userInfo || Object.keys(userInfo).length === 0) {
      return null;
    }

    // 处理 banned 字段：可能是字符串 'true'/'false' 或布尔值 true/false
    let banned = false;
    if (typeof userInfo.banned === 'boolean') {
      banned = userInfo.banned;
    } else if (typeof userInfo.banned === 'string') {
      banned = userInfo.banned === 'true';
    }

    // 安全解析 tags 字段
    let tags: string[] | undefined = undefined;
    if (userInfo.tags) {
      if (Array.isArray(userInfo.tags)) {
        tags = userInfo.tags;
      } else if (typeof userInfo.tags === 'string') {
        try {
          tags = JSON.parse(userInfo.tags);
        } catch {
          // 如果解析失败，可能是单个字符串，转换为数组
          tags = [userInfo.tags];
        }
      }
    }

    // 安全解析 enabledApis 字段
    let enabledApis: string[] | undefined = undefined;
    if (userInfo.enabledApis) {
      if (Array.isArray(userInfo.enabledApis)) {
        enabledApis = userInfo.enabledApis;
      } else if (typeof userInfo.enabledApis === 'string') {
        try {
          enabledApis = JSON.parse(userInfo.enabledApis);
        } catch {
          // 如果解析失败，可能是单个字符串，转换为数组
          enabledApis = [userInfo.enabledApis];
        }
      }
    }

    const result = {
      role: (userInfo.role as 'owner' | 'admin' | 'user') || 'user',
      banned,
      tags,
      oidcSub: userInfo.oidcSub as string | undefined,
      enabledApis,
      created_at: parseInt((userInfo.created_at as string) || '0', 10),
    };

    // 存入缓存
    userInfoCache?.set(userName, result);

    return result;
  }

  // 更新用户信息（新版本）
  async updateUserInfoV2(
    userName: string,
    updates: {
      role?: 'owner' | 'admin' | 'user';
      banned?: boolean;
      tags?: string[];
      oidcSub?: string;
      enabledApis?: string[];
    }
  ): Promise<void> {
    const userInfo: Record<string, any> = {};

    if (updates.role !== undefined) {
      userInfo.role = updates.role;
    }

    if (updates.banned !== undefined) {
      // 直接存储布尔值，让 Upstash 自动处理序列化
      userInfo.banned = updates.banned;
    }

    if (updates.tags !== undefined) {
      if (updates.tags.length > 0) {
        userInfo.tags = JSON.stringify(updates.tags);
      } else {
        // 删除tags字段
        await withRetry(() => this.client.hdel(this.userInfoKey(userName), 'tags'));
      }
    }

    if (updates.enabledApis !== undefined) {
      if (updates.enabledApis.length > 0) {
        userInfo.enabledApis = JSON.stringify(updates.enabledApis);
      } else {
        // 删除enabledApis字段
        await withRetry(() => this.client.hdel(this.userInfoKey(userName), 'enabledApis'));
      }
    }

    if (updates.oidcSub !== undefined) {
      const oldInfo = await this.getUserInfoV2(userName);
      if (oldInfo?.oidcSub && oldInfo.oidcSub !== updates.oidcSub) {
        // 删除旧的OIDC映射
        await withRetry(() => this.client.del(this.oidcSubKey(oldInfo.oidcSub!)));
      }
      userInfo.oidcSub = updates.oidcSub;
      // 创建新的OIDC映射
      await withRetry(() => this.client.set(this.oidcSubKey(updates.oidcSub!), userName));
    }

    if (Object.keys(userInfo).length > 0) {
      await withRetry(() => this.client.hset(this.userInfoKey(userName), userInfo));
    }

    // 清除缓存
    userInfoCache?.delete(userName);
  }

  // 修改用户密码（新版本）
  async changePasswordV2(userName: string, newPassword: string): Promise<void> {
    const hashedPassword = await this.hashPassword(newPassword);
    await withRetry(() =>
      this.client.hset(this.userInfoKey(userName), { password: hashedPassword })
    );

    // 清除缓存
    userInfoCache?.delete(userName);
  }

  // 检查用户是否存在（新版本）
  async checkUserExistV2(userName: string): Promise<boolean> {
    const exists = await withRetry(() =>
      this.client.exists(this.userInfoKey(userName))
    );
    return exists === 1;
  }

  // 通过OIDC Sub查找用户名
  async getUserByOidcSub(oidcSub: string): Promise<string | null> {
    const userName = await withRetry(() =>
      this.client.get(this.oidcSubKey(oidcSub))
    );
    return userName ? ensureString(userName) : null;
  }

  // 获取使用特定用户组的用户列表
  async getUsersByTag(tagName: string): Promise<string[]> {
    const affectedUsers: string[] = [];

    // 使用 SCAN 遍历所有用户信息的 key
    let cursor: number | string = 0;
    do {
      const result = await withRetry(() =>
        this.client.scan(cursor as number, { match: 'user:*:info', count: 100 })
      );

      cursor = result[0];
      const keys = result[1];

      // 检查每个用户的 tags
      for (const key of keys) {
        const userInfo = await withRetry(() => this.client.hgetall(key));
        if (userInfo && userInfo.tags) {
          const tags = JSON.parse(userInfo.tags as string);
          if (tags.includes(tagName)) {
            // 从 key 中提取用户名: user:username:info -> username
            const username = key.replace('user:', '').replace(':info', '');
            affectedUsers.push(username);
          }
        }
      }
    } while (typeof cursor === 'number' ? cursor !== 0 : cursor !== '0');

    return affectedUsers;
  }

  // 获取用户列表（分页，新版本）
  async getUserListV2(
    offset: number = 0,
    limit: number = 20,
    ownerUsername?: string
  ): Promise<{
    users: Array<{
      username: string;
      role: 'owner' | 'admin' | 'user';
      banned: boolean;
      tags?: string[];
      oidcSub?: string;
      enabledApis?: string[];
      created_at: number;
    }>;
    total: number;
  }> {
    // 获取总数
    let total = await withRetry(() => this.client.zcard(this.userListKey()));

    // 检查站长是否在数据库中（使用缓存）
    let ownerInfo = null;
    let ownerInDatabase = false;
    if (ownerUsername) {
      // 先检查缓存
      const { ownerExistenceCache } = await import('./user-cache');
      const cachedExists = ownerExistenceCache.get(ownerUsername);

      if (cachedExists !== null) {
        // 使用缓存的结果
        ownerInDatabase = cachedExists;
        if (ownerInDatabase) {
          // 如果站长在数据库中，获取详细信息
          ownerInfo = await this.getUserInfoV2(ownerUsername);
        }
      } else {
        // 缓存未命中，查询数据库
        ownerInfo = await this.getUserInfoV2(ownerUsername);
        ownerInDatabase = !!ownerInfo;
        // 更���缓存
        ownerExistenceCache.set(ownerUsername, ownerInDatabase);
      }

      // 如果站长不在数据库中，总数+1（无论在哪一页都要加）
      if (!ownerInDatabase) {
        total += 1;
      }
    }

    // 如果站长不在数据库中且在第一页，需要调整获取的用户数量和偏移量
    let actualOffset = offset;
    let actualLimit = limit;

    if (ownerUsername && !ownerInDatabase) {
      if (offset === 0) {
        // 第一页：只获取 limit-1 个用户，为站长留出位置
        actualLimit = limit - 1;
      } else {
        // 其他页：偏移量需要减1，因为站长占据了第一页的一个位置
        actualOffset = offset - 1;
      }
    }

    // 获取用户列表（按注册时间升序）
    const usernames = await withRetry(() =>
      this.client.zrange(this.userListKey(), actualOffset, actualOffset + actualLimit - 1)
    );

    const users = [];

    // 如果有站长且在第一页，确保站长始终在第一位
    if (ownerUsername && offset === 0) {
      // 即使站长不在数据库中，也要添加站长（站长使用环境变量认证）
      users.push({
        username: ownerUsername,
        role: 'owner' as const,
        banned: ownerInfo?.banned || false,
        tags: ownerInfo?.tags,
        oidcSub: ownerInfo?.oidcSub,
        enabledApis: ownerInfo?.enabledApis,
        created_at: ownerInfo?.created_at || 0,
      });
    }

    // 获取其他用户信息
    for (const username of usernames) {
      const usernameStr = ensureString(username);
      // 跳过站长（已经添加）
      if (ownerUsername && usernameStr === ownerUsername) {
        continue;
      }

      const userInfo = await this.getUserInfoV2(usernameStr);
      if (userInfo) {
        users.push({
          username: usernameStr,
          role: userInfo.role,
          banned: userInfo.banned,
          tags: userInfo.tags,
          oidcSub: userInfo.oidcSub,
          enabledApis: userInfo.enabledApis,
          created_at: userInfo.created_at,
        });
      }
    }

    return { users, total };
  }

  // 删除用户（新版本）
  async deleteUserV2(userName: string): Promise<void> {
    // 获取用户信息
    const userInfo = await this.getUserInfoV2(userName);

    // 删除OIDC映射
    if (userInfo?.oidcSub) {
      await withRetry(() => this.client.del(this.oidcSubKey(userInfo.oidcSub!)));
    }

    // 删除用户信息Hash
    await withRetry(() => this.client.del(this.userInfoKey(userName)));

    // 从用户列表中移除
    await withRetry(() => this.client.zrem(this.userListKey(), userName));

    // 删除用户的其他数据（播放记录、收藏等）
    await this.deleteUser(userName);

    // 清除缓存
    userInfoCache?.delete(userName);
  }

  // ---------- 搜索历史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await withRetry(() =>
      this.client.lrange(this.shKey(userName), 0, -1)
    );
    // 确保返回的都是字符串类型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    // 插入到最前
    await withRetry(() => this.client.lpush(key, ensureString(keyword)));
    // 限制最大长度
    await withRetry(() => this.client.ltrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    } else {
      await withRetry(() => this.client.del(key));
    }
  }

  // ---------- 获取全部用户 ----------
  async getAllUsers(): Promise<string[]> {
    // 从新版用户列表获取
    const userListKey = this.userListKey();
    const users = await withRetry(() =>
      this.client.zrange(userListKey, 0, -1)
    );
    const userList = users.map(u => ensureString(u));

    // 确保站长在列表中（站长可能不在数据库中，使用环境变量认证）
    const ownerUsername = process.env.USERNAME;
    if (ownerUsername && !userList.includes(ownerUsername)) {
      userList.unshift(ownerUsername);
    }

    return userList;
  }

  // ---------- 管理员配置 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await withRetry(() => this.client.get(this.adminConfigKey()));
    return val ? (val as AdminConfig) : null;
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await withRetry(() => this.client.set(this.adminConfigKey(), config));
  }

  // ---------- 跳过片头片尾配置 ----------
  private skipConfigKey(user: string, source: string, id: string) {
    return `u:${user}:skip:${source}+${id}`;
  }

  private danmakuFilterConfigKey(user: string) {
    return `u:${user}:danmaku_filter`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const val = await withRetry(() =>
      this.client.get(this.skipConfigKey(userName, source, id))
    );
    return val ? (val as SkipConfig) : null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.skipConfigKey(userName, source, id), config)
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await withRetry(() =>
      this.client.del(this.skipConfigKey(userName, source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const pattern = `u:${userName}:skip:*`;
    const keys = await withRetry(() => this.client.keys(pattern));

    if (keys.length === 0) {
      return {};
    }

    const configs: { [key: string]: SkipConfig } = {};

    // 批量获取所有配置
    const values = await withRetry(() => this.client.mget(keys));

    keys.forEach((key, index) => {
      const value = values[index];
      if (value) {
        // 从key中提取source+id
        const match = key.match(/^u:.+?:skip:(.+)$/);
        if (match) {
          const sourceAndId = match[1];
          configs[sourceAndId] = value as SkipConfig;
        }
      }
    });

    return configs;
  }

  // ---------- 弹幕过滤配置 ----------
  async getDanmakuFilterConfig(
    userName: string
  ): Promise<import('./types').DanmakuFilterConfig | null> {
    const val = await withRetry(() =>
      this.client.get(this.danmakuFilterConfigKey(userName))
    );
    return val ? (val as import('./types').DanmakuFilterConfig) : null;
  }

  async setDanmakuFilterConfig(
    userName: string,
    config: import('./types').DanmakuFilterConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.danmakuFilterConfigKey(userName), config)
    );
  }

  async deleteDanmakuFilterConfig(userName: string): Promise<void> {
    await withRetry(() =>
      this.client.del(this.danmakuFilterConfigKey(userName))
    );
  }

  // 清空所有数据
  async clearAllData(): Promise<void> {
    try {
      // 获取所有用户
      const allUsers = await this.getAllUsers();

      // 删除所有用户及其数据
      for (const username of allUsers) {
        await this.deleteUser(username);
      }

      // 删除管理员配置
      await withRetry(() => this.client.del(this.adminConfigKey()));

      console.log('所有数据已清空');
    } catch (error) {
      console.error('清空数据失败:', error);
      throw new Error('清空数据失败');
    }
  }

  // ---------- 通用键值存储 ----------
  private globalValueKey(key: string) {
    return `global:${key}`;
  }

  async getGlobalValue(key: string): Promise<string | null> {
    const val = await withRetry(() =>
      this.client.get(this.globalValueKey(key))
    );
    // Upstash 会自动反序列化 JSON，如果值是对象，需要重新序列化为字符串
    if (val === null) return null;
    if (typeof val === 'string') return val;
    // 如果是对象（Upstash 自动反序列化的结果），重新序列化
    return JSON.stringify(val);
  }

  async setGlobalValue(key: string, value: string): Promise<void> {
    await withRetry(() =>
      this.client.set(this.globalValueKey(key), value)
    );
  }

  async deleteGlobalValue(key: string): Promise<void> {
    await withRetry(() => this.client.del(this.globalValueKey(key)));
  }

  // ---------- 通知相关 ----------
  private notificationsKey(userName: string) {
    return `u:${userName}:notifications`;
  }

  private lastFavoriteCheckKey(userName: string) {
    return `u:${userName}:last_fav_check`;
  }

  async getNotifications(userName: string): Promise<import('./types').Notification[]> {
    const val = await withRetry(() =>
      this.client.get(this.notificationsKey(userName))
    );
    return val ? (val as import('./types').Notification[]) : [];
  }

  async addNotification(
    userName: string,
    notification: import('./types').Notification
  ): Promise<void> {
    const notifications = await this.getNotifications(userName);
    notifications.unshift(notification); // 新通知放在最前面
    // 限制通知数量，最多保留100条
    if (notifications.length > 100) {
      notifications.splice(100);
    }
    await withRetry(() =>
      this.client.set(this.notificationsKey(userName), notifications)
    );
  }

  async markNotificationAsRead(
    userName: string,
    notificationId: string
  ): Promise<void> {
    const notifications = await this.getNotifications(userName);
    const notification = notifications.find((n) => n.id === notificationId);
    if (notification) {
      notification.read = true;
      await withRetry(() =>
        this.client.set(this.notificationsKey(userName), notifications)
      );
    }
  }

  async deleteNotification(
    userName: string,
    notificationId: string
  ): Promise<void> {
    const notifications = await this.getNotifications(userName);
    const filtered = notifications.filter((n) => n.id !== notificationId);
    await withRetry(() =>
      this.client.set(this.notificationsKey(userName), filtered)
    );
  }

  async clearAllNotifications(userName: string): Promise<void> {
    await withRetry(() => this.client.del(this.notificationsKey(userName)));
  }

  async getUnreadNotificationCount(userName: string): Promise<number> {
    const notifications = await this.getNotifications(userName);
    return notifications.filter((n) => !n.read).length;
  }

  async getLastFavoriteCheckTime(userName: string): Promise<number> {
    const val = await withRetry(() =>
      this.client.get(this.lastFavoriteCheckKey(userName))
    );
    return val ? (val as number) : 0;
  }

  async setLastFavoriteCheckTime(
    userName: string,
    timestamp: number
  ): Promise<void> {
    await withRetry(() =>
      this.client.set(this.lastFavoriteCheckKey(userName), timestamp)
    );
  }
}

// 单例 Upstash Redis 客户端
function getUpstashRedisClient(): Redis {
  const globalKey = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');
  let client: Redis | undefined = (global as any)[globalKey];

  if (!client) {
    const upstashUrl = process.env.UPSTASH_URL;
    const upstashToken = process.env.UPSTASH_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'UPSTASH_URL and UPSTASH_TOKEN env variables must be set'
      );
    }

    // 创建 Upstash Redis 客户端
    client = new Redis({
      url: upstashUrl,
      token: upstashToken,
      // 可选配置
      retry: {
        retries: 3,
        backoff: (retryCount: number) =>
          Math.min(1000 * Math.pow(2, retryCount), 30000),
      },
    });

    console.log('Upstash Redis client created successfully');

    (global as any)[globalKey] = client;
  }

  return client;
}
