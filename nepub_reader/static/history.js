// 読書履歴（作品ごとに、最後に読んだ話とその読書位置）の localStorage 管理。
// トップページ（index.js）とリーダー（reader.js）で共有する。

const HISTORY_KEY = 'nepub_reading_history'
const MAX_HISTORY = 50
/** EpubReader の storageKey。表示設定が `<これ>:settings` に保存される（theme.js も読む） */
export const READER_STORAGE_KEY = 'nepub-reader'

/** 作品のキー（site:novel_id）。site がない古い履歴はなろう扱い */
export const novelKey = (item) => `${item.site || 'narou'}:${item.novel_id}`

/** 読書位置（EpubViewer の location）として使える値か。保存されたものやインポートしたものを確かめる */
export const isPosition = (value) => Number.isFinite(value?.index) && Number.isFinite(value?.progress)

export function getHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY))
    return Array.isArray(history) ? history : []
  } catch {
    return []
  }
}

export function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch {}
}

/** 読んだ話を履歴の先頭に記録する（同じ作品の前の記録と置き換える） */
export function recordHistory({ site, novel_id, novel_title, episode_title, last_episode, position }) {
  const entry = { site, novel_id, novel_title, episode_title, last_episode, last_accessed: new Date().toISOString(), position }
  saveHistory([entry, ...getHistory().filter((item) => novelKey(item) !== novelKey(entry))])
}

/** その話の、保存されている読書位置（履歴がその話を指していなければ undefined） */
export function savedPosition(site, novelId, episode) {
  const item = getHistory().find((item) => novelKey(item) === `${site}:${novelId}`)
  return item && String(item.last_episode) === String(episode) && isPosition(item.position) ? item.position : undefined
}

/** 読んでいる話の読書位置を保存する（履歴がその話を指しているときだけ。別のタブで先の話を開いていたら触らない） */
export function savePosition(site, novelId, episode, position) {
  const history = getHistory()
  const item = history.find((item) => novelKey(item) === `${site}:${novelId}`)
  if (!item || String(item.last_episode) !== String(episode)) return
  item.position = position
  saveHistory(history)
}

// 以前の版は、読書位置を EpubReader に保存させていた（`nepub-reader:position:<site>:<作品 ID>:<話>`）。
// 履歴が指している話のものを履歴に移し、残りは消す
function migratePositions() {
  const prefix = `${READER_STORAGE_KEY}:position:`
  try {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix))
    if (keys.length === 0) return
    const history = getHistory()
    for (const key of keys) {
      const item = history.find((item) => `${novelKey(item)}:${item.last_episode}` === key.slice(prefix.length))
      try {
        const position = JSON.parse(localStorage.getItem(key))
        if (item && !item.position && isPosition(position)) item.position = position
      } catch {}
      localStorage.removeItem(key)
    }
    saveHistory(history)
  } catch {}
}
migratePositions()
