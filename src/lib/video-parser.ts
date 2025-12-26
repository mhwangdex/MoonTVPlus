import parseTorrentName from 'parse-torrent-name';

export interface ParsedVideoInfo {
  episode?: number;
  season?: number;
  title?: string;
}

/**
 * 解析视频文件名
 */
export function parseVideoFileName(fileName: string): ParsedVideoInfo {
  try {
    const parsed = parseTorrentName(fileName);

    // 如果 parse-torrent-name 成功解析出集数，直接返回
    if (parsed.episode) {
      return {
        episode: parsed.episode,
        season: parsed.season,
        title: parsed.title,
      };
    }
  } catch (error) {
    console.error('parse-torrent-name 解析失败:', fileName, error);
  }

  // 降级方案：使用多种正则模式提取集数
  // 按优先级排序：更具体的模式优先
  const patterns = [
    // S01E01, s01e01, S01E01.5 (支持小数) - 最具体
    /[Ss]\d+[Ee](\d+(?:\.\d+)?)/,
    // [01], (01), [01.5], (01.5) (支持小数) - 很具体
    /[\[\(](\d+(?:\.\d+)?)[\]\)]/,
    // E01, E1, e01, e1, E01.5 (支持小数)
    /[Ee](\d+(?:\.\d+)?)/,
    // 第01集, 第1集, 第01话, 第1话, 第1.5集 (支持小数)
    /第(\d+(?:\.\d+)?)[集话]/,
    // _01_, -01-, _01.5_, -01.5- (支持小数)
    /[_\-](\d+(?:\.\d+)?)[_\-]/,
    // 01.mp4, 001.mp4, 01.5.mp4 (纯数字开头，支持小数) - 最不具体
    /^(\d+(?:\.\d+)?)[^\d.]/,
  ];

  for (const pattern of patterns) {
    const match = fileName.match(pattern);
    if (match && match[1]) {
      const episode = parseFloat(match[1]);
      if (episode > 0 && episode < 10000) { // 合理的集数范围
        return { episode };
      }
    }
  }

  // 如果所有模式都失败，返回空对象（调用方会处理）
  return {};
}
