// トップページ。直前に読んでいた作品（続きを読む）と、読書履歴の一覧・絞り込み・削除・エクスポート・インポート。
import { MAX_HISTORY, getHistory, mergeHistory, novelKey, sanitizeHistoryItem, saveHistory, searchHistory } from './history.js'
import { novelUrl, siteName } from './sites.js'

const resume = document.getElementById('resume')
const list = document.getElementById('history-list')
const count = document.getElementById('history-count')
const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('history-search'))
const moreButton = document.getElementById('history-more')
const message = document.getElementById('history-message')
const exportButton = document.getElementById('history-export')
const clearButton = document.getElementById('history-clear')
const importButton = document.getElementById('history-import')
const importInput = /** @type {HTMLInputElement} */ (document.getElementById('history-import-file'))

const icon = (paths) =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const EXTERNAL_ICON = icon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>')
const DELETE_ICON = icon('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>')

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
  if (action) message.append(el('button', { type: 'button', className: 'quiet', textContent: action.label, onclick: action.run }))
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

/** 履歴の話を開くリーダー画面 */
const readUrl = (item) => `/read/${item.site}/${encodeURIComponent(item.novel_id)}/${encodeURIComponent(item.last_episode)}`

// カクヨムの last_episode はエピソード ID なので話数は出せない。話タイトルのない履歴（なろうの短編）にも出さない
const episodeNumber = (item) => (item.site === 'narou' && item.episode_title ? `第${item.last_episode}話` : '')

/** その話をどこまで読んだか（%）。読書位置のない履歴では null */
const readPercent = (item) => (item.position ? Math.round(Math.min(1, Math.max(0, item.position.progress)) * 100) : null)

/** どこまで読んだかを示す線 */
function progressBar(percent) {
  const fill = el('span')
  fill.style.width = `${percent}%`
  return el('span', { className: 'progress', title: `この話の ${percent}% まで読みました` }, fill)
}

/** 元サイトの作品ページへのリンクと、履歴から削除するボタン */
function itemActions(item) {
  const openInSite = `${siteName(item.site)}で作品ページを開く`
  // 読み上げでは、どの作品のボタンかが分かるように作品名を含める（見た目のツールチップは短いまま）
  const named = (label) => `「${displayTitle(item)}」: ${label}`
  return el(
    'span',
    { className: 'item-actions' },
    el('a', {
      className: 'item-action',
      href: novelUrl(item.site, item.novel_id),
      target: '_blank',
      rel: 'noopener noreferrer',
      title: openInSite,
      ariaLabel: named(openInSite),
      innerHTML: EXTERNAL_ICON,
    }),
    el('button', {
      type: 'button',
      className: 'item-action danger',
      title: 'この履歴を削除',
      ariaLabel: named('履歴を削除'),
      innerHTML: DELETE_ICON,
      onclick: () => deleteHistoryItem(item),
    }),
  )
}

/** 直前に読んでいた作品を、続きを読むためのカードにする（履歴がなければ出さない） */
function renderResume(item) {
  resume.hidden = !item
  if (!item) return resume.replaceChildren()
  const title = displayTitle(item)
  const percent = readPercent(item)
  // 表紙の代わりの、作品名を縦書きにした札。作品名は隣にも出すので、読み上げない
  const cover = el('span', { className: 'cover', ariaHidden: 'true' }, el('span', { className: 'cover-title', textContent: title }))
  // 作品名の長さに合わせて、札の文字の大きさを変える
  cover.dataset.length = title.length <= 10 ? 'short' : title.length > 40 ? 'long' : 'medium'
  resume.replaceChildren(
    el(
      'a',
      { className: 'resume-link', href: readUrl(item) },
      cover,
      el(
        'span',
        { className: 'resume-text' },
        el('h2', { className: 'section-heading', id: 'resume-heading', textContent: '続きを読む' }),
        el('span', { className: 'resume-title', textContent: title }),
        ...(item.episode_title ? [el('span', { className: 'resume-episode', textContent: item.episode_title })] : []),
        el('span', { className: 'resume-meta', textContent: [siteName(item.site), episodeNumber(item), formatDate(item.last_accessed)].filter(Boolean).join('・') }),
        el(
          'span',
          { className: 'resume-foot' },
          el('span', { className: 'resume-go', textContent: '読む' }),
          ...(percent === null ? [] : [el('span', { className: 'resume-progress' }, progressBar(percent), `${percent}%`)]),
        ),
      ),
    ),
    itemActions(item),
  )
}

function historyItem(item) {
  const percent = readPercent(item)
  const link = el(
    'a',
    { className: 'history-link', href: readUrl(item) },
    el(
      'span',
      { className: 'history-text' },
      el('span', { className: 'history-title', textContent: displayTitle(item) }),
      el(
        'span',
        { className: 'history-episode' },
        el('span', { className: 'history-site', textContent: item.site === 'kakuyomu' ? 'カクヨム' : 'なろう' }),
        [episodeNumber(item), item.episode_title].filter(Boolean).join('　'),
      ),
    ),
    el('span', { className: 'history-meta' }, el('span', { textContent: formatDate(item.last_accessed) }), ...(percent === null ? [] : [progressBar(percent)])),
  )
  return el('li', { className: 'history-item' }, link, itemActions(item))
}

// 一覧に一度に出す数（履歴が多くても、ページを開くのが遅くならないように）。「さらに表示」で増やす
const PAGE_SIZE = 30
let shown = PAGE_SIZE
// 絞り込みの欄を出す件数。少ないうちは、目で探せる
const SEARCH_FROM = 8

function renderHistory() {
  const history = getHistory()
  renderResume(history[0])
  searchInput.hidden = history.length <= SEARCH_FROM
  if (searchInput.hidden) searchInput.value = ''
  const query = searchInput.value.trim()
  // いちばん上の作品は「続きを読む」に出ているので、一覧からは除く（絞り込むときは、それも含めて探す）
  const items = query ? searchHistory(history, query) : history.slice(1)
  count.textContent = !history.length ? '' : query ? `${items.length} / ${history.length} 作品` : `${history.length} 作品`
  const empty = !history.length
    ? 'まだ読んだ作品はありません。上の欄に作品の URL を貼ると、読み始められます（別の端末の履歴は、インポートで移せます）'
    : query && !items.length
      ? `「${query}」に合う作品はありません`
      : ''
  list.replaceChildren(...(empty ? [el('li', { className: 'history-empty', textContent: empty })] : items.slice(0, shown).map(historyItem)))
  moreButton.hidden = items.length <= shown
  moreButton.textContent = `さらに表示（残り ${items.length - shown} 件）`
  // 意味のないボタンは隠す（インポートは、履歴が空でもできる）
  exportButton.hidden = clearButton.hidden = history.length === 0
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
searchInput.addEventListener('input', () => {
  shown = PAGE_SIZE
  renderHistory()
})
moreButton.addEventListener('click', () => {
  shown += PAGE_SIZE
  renderHistory()
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
// 初めて使うとき（履歴がないとき）は、操作方法を開いておく
if (getHistory().length === 0) /** @type {HTMLDetailsElement} */ (document.getElementById('help')).open = true
addEventListener('pageshow', (e) => {
  // 送信した後に「戻る」で戻ってきたときは、ボタンを元に戻す
  submitButton.disabled = false
  submitButton.textContent = '読む'
  // リーダーから「戻る」で戻ったとき（ページが前の表示のまま復元される）は、一覧を新しくする
  if (e.persisted) renderHistory()
})
// ほかのタブで読み進めたときにも、一覧を新しくする
addEventListener('storage', renderHistory)
