// トップページ。読書履歴の一覧・削除・エクスポート・インポート。
import { MAX_HISTORY, getHistory, mergeHistory, novelKey, sanitizeHistoryItem, saveHistory } from './history.js'
import { novelUrl, siteName } from './sites.js'

const list = document.getElementById('history-list')
const message = document.getElementById('history-message')
const exportButton = document.getElementById('history-export')
const clearButton = document.getElementById('history-clear')
const importButton = document.getElementById('history-import')
const importInput = /** @type {HTMLInputElement} */ (document.getElementById('history-import-file'))

const EXTERNAL_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'

/** document.createElement の短縮形。props は要素のプロパティ（className, textContent など） */
const el = (tag, props, ...children) => {
  const element = Object.assign(document.createElement(tag), props)
  element.append(...children)
  return element
}

// 知らせを出しておく時間。「元に戻す」を押すのに十分で、いつまでも残らない長さ
const MESSAGE_MS = 12000
let messageTimer

/** 操作の結果を履歴の上に出す（しばらくすると消える）。action は一緒に出すボタン { label, run } */
function notify(text, action) {
  clearTimeout(messageTimer)
  message.replaceChildren(...(text ? [text] : []))
  if (action) message.append(el('button', { type: 'button', className: 'history-action', textContent: action.label, onclick: action.run }))
  if (text) messageTimer = setTimeout(() => message.replaceChildren(), MESSAGE_MS)
}

function formatDate(isoString) {
  const date = new Date(isoString)
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
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
  const openInSite = `${siteName(site)}で作品ページを開く`
  // 読み上げでは、どの作品のボタンかが分かるように作品名を含める（見た目のツールチップは短いまま）
  const named = (label) => `「${displayTitle(item)}」: ${label}`
  // カクヨムの last_episode はエピソード ID なので話数は出せない。話タイトルのない履歴（なろうの短編）にも出さない
  const meta = [site === 'narou' && item.episode_title && `第${item.last_episode}話`, formatDate(item.last_accessed)].filter(Boolean).join('・')

  const link = el(
    'a',
    { className: 'history-link', href: `/read/${site}/${encodeURIComponent(item.novel_id)}/${encodeURIComponent(item.last_episode)}` },
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
    href: novelUrl(site, item.novel_id),
    target: '_blank',
    rel: 'noopener noreferrer',
    title: openInSite,
    ariaLabel: named(openInSite),
    innerHTML: EXTERNAL_ICON,
  })
  const deleteButton = el('button', {
    type: 'button',
    className: 'history-delete',
    textContent: '✕',
    title: 'この履歴を削除',
    ariaLabel: named('履歴を削除'),
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
  const merged = mergeHistory(getHistory(), items)
  // 履歴に残せる数には上限がある。あふれる分があれば伝える
  const overflow = merged.length > MAX_HISTORY ? `（新しい順に ${MAX_HISTORY} 件を残しています）` : ''
  updateHistory(merged, `${items.length} 件の履歴を取り込みました${overflow}`)
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

// ---- URL の入力 ----

const form = document.getElementById('url-form')
/** @type {HTMLButtonElement} */
const submitButton = form.querySelector('button[type="submit"]')
// すぐ URL を貼れるよう入力欄にフォーカスする。タッチ操作の端末では、開くたびにキーボードが出てしまうのでしない
if (matchMedia('(hover: hover) and (pointer: fine)').matches) document.getElementById('url-input').focus()
// URL を送信したら、画面が変わるまでボタンを押せなくする（二重に送信しないように）
form.addEventListener('submit', () => {
  submitButton.disabled = true
  submitButton.textContent = '開いています…'
})

// ---- 表示 ----

renderHistory()
addEventListener('pageshow', (e) => {
  // 送信した後に「戻る」で戻ってきたときは、ボタンを元に戻す
  submitButton.disabled = false
  submitButton.textContent = '読む'
  // リーダーから「戻る」で戻ったとき（ページが前の表示のまま復元される）は、一覧を新しくする
  if (e.persisted) renderHistory()
})
// ほかのタブで読み進めたときにも、一覧を新しくする
addEventListener('storage', renderHistory)
