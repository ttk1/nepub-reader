// 読書履歴（作品ごとに最後に読んだ話）と、EpubReader が保存する話ごとの読書位置の管理。
// トップページ（index.js）とリーダー（reader.js）で共有する。

const HISTORY_KEY = 'nepub_reading_history'
export const MAX_HISTORY = 50
// EpubReader の storageKey。読書位置は `<storageKey>:position:<open() の key>` に保存される
export const READER_STORAGE_KEY = 'nepub-reader'
const POSITION_PREFIX = `${READER_STORAGE_KEY}:position:`

/** 作品のキー（site:novel_id）。site がない古い履歴はなろう扱い */
export const novelKey = (item) => `${item.site || 'narou'}:${item.novel_id}`

/** 話のキー（読書位置の保存キー）。1 話ごとの EPUB は作品名が共通なので話ごとに分ける */
export const episodeKey = (site, novelId, episode) => `${site}:${novelId}:${episode}`

export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? []
  } catch {
    return []
  }
}

export function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {}
}

/** 読んだ話を履歴の先頭に記録し、同じ作品の他の話の読書位置は消す（位置は作品ごとに最新の 1 話分だけ残す） */
export function recordHistory({ site, novel_id, novel_title, episode_title, last_episode }) {
  const entry = { site, novel_id, novel_title, episode_title, last_episode, last_accessed: new Date().toISOString() }
  const key = novelKey(entry)
  saveHistory([entry, ...getHistory().filter((item) => novelKey(item) !== key)].slice(0, MAX_HISTORY))
  removePositions(`${key}:`, POSITION_PREFIX + episodeKey(site, novel_id, last_episode))
}

/** 読書位置を消す。prefix は作品のキーの範囲（例: "narou:n1234ab:"、'' ですべて）、keep は残すキー */
export function removePositions(prefix = '', keep = '') {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(POSITION_PREFIX + prefix) && key !== keep) localStorage.removeItem(key)
    }
  } catch {}
}
