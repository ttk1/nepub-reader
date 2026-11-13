// トップページ。読書履歴の一覧・削除・エクスポート・インポート。
import { getHistory, mergeHistory, novelKey, sanitizeHistoryItem, saveHistory } from './history.js'

const list = document.getElementById('history-list')
const message = document.getElementById('history-message')
const exportButton = document.getElementById('history-export')
const clearButton = document.getElementById('history-clear')
const importButton = document.getElementById('history-import')
const importInput = document.getElementById('history-import-file')

const EXTERNAL_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'

/** document.createElement の短縮形。props は要素のプロパティ（className, textContent など） */
const el = (tag, props, ...children) => {
  const element = Object.assign(document.createElement(tag), props)
  element.append(...children)
  return element
}

/** 操作の結果を履歴の上に出す。action は一緒に出すボタン { label, run } */
function notify(text, action) {
  message.replaceChildren(...(text ? [text] : []))
  if (action) message.append(el('button', { type: 'button', className: 'history-action', textContent: action.label, onclick: action.run }))
}

function formatDate(isoString) {
  const date = new Date(isoString)
  const minutes = Math.floor((Date.now() - date) / 60000)
  if (Number.isNaN(minutes)) return ''
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}日前`
  return date.toLocaleDateString('ja-JP')
}

// 旧形式の履歴に残っているサイト名は表示時に取る
const displayTitle = (item) => (item.novel_title || `${item.novel_id} - ${item.last_episode}話`).replace(/ - カクヨム$/, '')

function historyItem(item) {
  const site = item.site || 'narou'
  const siteName = site === 'kakuyomu' ? 'カクヨム' : '小説家になろう'
  const id = encodeURIComponent(item.novel_id)
  // カクヨムの last_episode はエピソード ID なので話数は出せない
  const meta = [site === 'narou' && `第${item.last_episode}話`, formatDate(item.last_accessed)].filter(Boolean).join('・')

  const link = el(
    'a',
    { className: 'history-link', href: `/read/${site}/${id}/${encodeURIComponent(item.last_episode)}` },
    el(
      'span',
      { className: 'history-text' },
      el('span', { className: 'history-title', textContent: displayTitle(item) }),
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
    rel: 'noopener noreferrer',
    title: `${siteName}で作品ページを開く`,
    ariaLabel: `${siteName}で作品ページを開く`,
    innerHTML: EXTERNAL_ICON,
  })
  const deleteButton = el('button', {
    type: 'button',
    className: 'history-delete',
    textContent: '✕',
    title: 'この履歴を削除',
    ariaLabel: 'この履歴を削除',
    onclick: () => deleteHistoryItem(item),
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

/** 履歴を保存して表示し直す */
function updateHistory(history, text, action) {
  saveHistory(history)
  renderHistory()
  notify(text, action)
}

// 押し間違えても戻せるよう、確認は挟まずに「元に戻す」を出す
function deleteHistoryItem(item) {
  const key = novelKey(item)
  updateHistory(
    getHistory().filter((other) => novelKey(other) !== key),
    `「${displayTitle(item)}」を履歴から削除しました`,
    { label: '元に戻す', run: () => updateHistory(mergeHistory(getHistory(), [item]), '') },
  )
}

// ---- エクスポート / インポート ----

function exportHistory() {
  const data = { nepub_reader_export: 1, exported_at: new Date().toISOString(), history: getHistory() }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = el('a', { href: URL.createObjectURL(blob), download: `nepub-reader-history_${data.exported_at.slice(0, 10)}.json` })
  a.click()
  URL.revokeObjectURL(a.href)
}

async function importHistory(file) {
  let items
  try {
    const data = JSON.parse(await file.text())
    // エクスポート形式 {history: [...]} と生の配列の両方を受け付ける
    const imported = Array.isArray(data) ? data : data?.history
    if (!Array.isArray(imported)) throw new Error('unsupported format')
    items = imported.map(sanitizeHistoryItem).filter(Boolean)
  } catch {
    notify('履歴ファイルを読み込めませんでした。エクスポートした JSON ファイルを指定してください。')
    return
  }
  if (items.length === 0) {
    notify('読み込める履歴がありませんでした')
    return
  }
  updateHistory(mergeHistory(getHistory(), items), `${items.length} 件の履歴を取り込みました`)
}

exportButton.addEventListener('click', exportHistory)
importButton.addEventListener('click', () => importInput.click())
importInput.addEventListener('change', () => {
  if (importInput.files[0]) importHistory(importInput.files[0])
  importInput.value = ''
})
clearButton.addEventListener('click', () => {
  if (confirm('読書履歴をすべて削除しますか？')) updateHistory([], '読書履歴をすべて削除しました')
})

renderHistory()
