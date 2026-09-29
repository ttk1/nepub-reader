// トップページ。読書履歴の一覧・削除・エクスポート・インポート。
import { MAX_HISTORY, getHistory, novelKey, removePositions, saveHistory } from './history.js'

const list = document.getElementById('history-list')
const exportButton = document.getElementById('history-export')
const clearButton = document.getElementById('history-clear-btn')
const importButton = document.getElementById('history-import')
const importInput = document.getElementById('history-import-file')

const EXTERNAL_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'

/** document.createElement の短縮形。props は要素のプロパティ（className, textContent など） */
const el = (tag, props, ...children) => {
  const element = Object.assign(document.createElement(tag), props)
  element.append(...children)
  return element
}

function formatDate(isoString) {
  const date = new Date(isoString)
  const minutes = Math.floor((Date.now() - date) / 60000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}日前`
  return date.toLocaleDateString('ja-JP')
}

function historyItem(item) {
  const site = item.site || 'narou'
  const id = encodeURIComponent(item.novel_id)

  // 旧形式の履歴に残っているサイト名サフィックスは表示時に除去する
  const title = (item.novel_title || `${item.novel_id} - ${item.last_episode}話`).replace(/ - カクヨム$/, '')
  // カクヨムの last_episode はエピソード ID なので話数は出せない
  const meta = [site === 'narou' && `第${item.last_episode}話`, formatDate(item.last_accessed)].filter(Boolean).join('・')

  const link = el(
    'a',
    { className: 'history-link', href: `/read/${site}/${id}/${encodeURIComponent(item.last_episode)}` },
    el(
      'span',
      { className: 'history-text' },
      el('span', { className: 'history-title', textContent: title }),
      ...(item.episode_title ? [el('span', { className: 'history-episode', textContent: item.episode_title })] : []),
    ),
    el(
      'span',
      { className: 'history-meta' },
      el('span', { textContent: meta }),
      el('span', { className: `badge badge-${site}`, textContent: site === 'kakuyomu' ? 'カクヨム' : 'なろう' }),
    ),
  )
  // 元サイトの作品トップページへの外部リンク
  const external = el('a', {
    className: 'history-external',
    href: site === 'kakuyomu' ? `https://kakuyomu.jp/works/${id}` : `https://ncode.syosetu.com/${id}/`,
    target: '_blank',
    rel: 'noopener',
    title: site === 'kakuyomu' ? 'カクヨムで作品ページを開く' : '小説家になろうで作品ページを開く',
    innerHTML: EXTERNAL_ICON,
  })
  const deleteButton = el('button', {
    className: 'history-delete',
    textContent: '✕',
    title: 'この履歴を削除',
    onclick: () => deleteHistoryItem(novelKey(item)),
  })
  return el('li', { className: 'history-item' }, link, external, deleteButton)
}

function renderHistory() {
  const history = getHistory()
  // 履歴が空でもインポートできるようセクションは常時表示し、意味のないボタンだけ隠す
  exportButton.hidden = clearButton.hidden = history.length === 0
  list.replaceChildren(
    ...(history.length
      ? history.map(historyItem)
      : [el('li', { className: 'history-empty', textContent: '履歴はありません（別の PC の履歴はエクスポート/インポートで移せます）' })]),
  )
}

// 履歴と一緒に、その作品の読書位置も消す
function deleteHistoryItem(key) {
  saveHistory(getHistory().filter((item) => novelKey(item) !== key))
  removePositions(`${key}:`)
  renderHistory()
}

// ---- エクスポート / インポート ----

function exportHistory() {
  const data = { nepub_reader_export: 1, exported_at: new Date().toISOString(), history: getHistory() }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = el('a', { href: URL.createObjectURL(blob), download: `nepub-reader-history_${data.exported_at.slice(0, 10)}.json` })
  a.click()
  URL.revokeObjectURL(a.href)
}

// インポートデータの各エントリを検証し、既知のフィールドだけ残す
function sanitizeItem(item) {
  if (!item || typeof item !== 'object' || !item.novel_id || item.last_episode == null) return null
  const text = (value, fallback) => (typeof value === 'string' ? value : fallback)
  return {
    site: item.site === 'kakuyomu' ? 'kakuyomu' : 'narou',
    novel_id: String(item.novel_id),
    novel_title: text(item.novel_title, String(item.novel_id)),
    episode_title: text(item.episode_title, ''),
    last_episode: item.last_episode,
    last_accessed: text(item.last_accessed, ''),
  }
}

// 同一作品は last_accessed が新しい方を残し、新しい順に並べる（ISO 8601 文字列は辞書順で時刻順になる）
function mergeHistory(current, imported) {
  const newer = (a, b) => (a.last_accessed || '') > (b.last_accessed || '')
  const latest = new Map()
  for (const item of [...current, ...imported]) {
    const key = novelKey(item)
    if (!latest.has(key) || newer(item, latest.get(key))) latest.set(key, item)
  }
  return [...latest.values()].sort((a, b) => newer(b, a) - newer(a, b)).slice(0, MAX_HISTORY)
}

async function importHistory(file) {
  let items
  try {
    const data = JSON.parse(await file.text())
    // エクスポート形式 {history: [...]} と生の配列の両方を受け付ける
    const imported = Array.isArray(data) ? data : data?.history
    if (!Array.isArray(imported)) throw new Error('unsupported format')
    items = imported.map(sanitizeItem).filter(Boolean)
  } catch {
    alert('履歴ファイルを読み込めませんでした。エクスポートした JSON ファイルを指定してください。')
    return
  }
  if (items.length === 0) {
    alert('読み込める履歴がありませんでした')
    return
  }
  saveHistory(mergeHistory(getHistory(), items))
  renderHistory()
  alert(`${items.length} 件の履歴を取り込みました`)
}

exportButton.addEventListener('click', exportHistory)
importButton.addEventListener('click', () => importInput.click())
importInput.addEventListener('change', () => {
  if (importInput.files[0]) importHistory(importInput.files[0])
  importInput.value = ''
})
clearButton.addEventListener('click', () => {
  if (!confirm('読書履歴をすべて削除しますか？')) return
  saveHistory([])
  removePositions()
  renderHistory()
})

renderHistory()
