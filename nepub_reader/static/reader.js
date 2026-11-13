// リーダー画面。1 話ぶんの EPUB を EpubReader で表示し、最後のページから先へ進むと次の話、
// 最初のページから戻ると前の話（の最後のページ）をページ遷移なしで読み込む。
import { EpubReader } from './epub-viewer/index.js'
import { READER_STORAGE_KEY, recordHistory, savePosition, savedPosition } from './history.js'

// URL はサーバー側で検証済み（/read/<site>/<作品 ID>/<話>。話はなろうなら話数、カクヨムならエピソード ID）
const [, site, novelId, firstEpisode] = location.pathname.split('/').slice(1)

// 話の先頭と、最後のページ（index: -1 = 最後のセクション）
const START = { index: 0, progress: 0 }
const END = { index: -1, progress: 1 }

// EpubReader には表示設定だけを保存させる。読書位置は読書履歴と一緒に持つ（history.js）ので、保存させない
const SETTINGS_KEY = `${READER_STORAGE_KEY}:settings`
const settingsStorage = {
  getItem: (key) => (key === SETTINGS_KEY ? localStorage.getItem(key) : null),
  setItem: (key, value) => {
    if (key === SETTINGS_KEY) localStorage.setItem(key, value)
  },
}

const el = (tag, props, ...children) => {
  const element = Object.assign(document.createElement(tag), props)
  element.append(...children)
  return element
}

const reader = new EpubReader(document.getElementById('reader'), { storage: settingsStorage, storageKey: READER_STORAGE_KEY })
const { toolbar, viewer } = reader
const title = toolbar.querySelector('.title')

// 「前の話」「次の話」。狭い画面では「の」を隠して短くする（reader.css）
const episodeButton = (word, forward) =>
  el('button', { type: 'button', onclick: () => turn(forward) }, word, el('span', { className: 'wide', textContent: 'の' }), '話')
const prevButton = episodeButton('前', false)
const nextButton = episodeButton('次', true)
toolbar.prepend(el('a', { href: '/', textContent: 'トップ' }), prevButton, nextButton)

// 読み込み中・最新話などの知らせ。ツールバーを隠していても見えるよう、ページの上に重ねて出す
const status = document.body.appendChild(el('div', { id: 'status', role: 'status' }))

/** 知らせを出す（'' で消す）。action は一緒に出すボタン { label, run } */
function setStatus(text, action) {
  status.replaceChildren(...(text ? [text] : []))
  if (action) status.append(el('button', { type: 'button', textContent: action.label, onclick: action.run }))
}

/** 表示中の話と前後の話（null = ない。なろうの次話は開いてみるまで分からない） */
let current
// 話の読み込み中は、次の操作を受け付けない（bookend / bookstart はキーを押すたびに発生する）
let loading = false

async function whileLoading(task) {
  if (loading) return
  loading = true
  try {
    await task()
  } finally {
    loading = false
  }
}

/** サーバーへのリクエスト。つながらないときは、利用者に見せられるメッセージのエラーにする */
const request = (url) =>
  fetch(url).catch(() => {
    throw new Error('サーバーに接続できませんでした')
  })

async function fetchEpub(episode) {
  const res = await request(`/epub/${site}/${novelId}/${episode}`)
  if (res.ok) return res
  const message = await res.text()
  // サーバーが用意したメッセージ以外（エラーページの HTML など）は、そのまま出さない
  const known = message.length < 100 && !message.includes('<')
  throw Object.assign(new Error(known ? message : `話を取得できませんでした（${res.status}）`), { status: res.status })
}

/** 話を表示する。location を省略すると、保存された読書位置（なければ先頭）から */
async function show(episode, location = savedPosition(site, novelId, episode)) {
  setStatus('読み込み中…')
  const res = await fetchEpub(episode)
  const book = await reader.open(await res.blob(), { location: location ?? START })

  const n = Number(episode)
  current =
    site === 'narou'
      ? { episode, prev: n > 1 ? n - 1 : null, next: n + 1 }
      : { episode, prev: res.headers.get('X-Prev-Episode') || null, next: res.headers.get('X-Next-Episode') || null }
  prevButton.disabled = !current.prev

  const novelTitle = book.metadata.title
  const episodeTitle = book.toc[0]?.label ?? ''
  title.textContent = `${novelTitle}　${episodeTitle}`
  document.title = `${episodeTitle} - ${novelTitle}`
  // リロードしても同じ話が開くようにする
  history.replaceState(null, '', `/read/${site}/${novelId}/${episode}`)
  recordHistory({
    site,
    novel_id: novelId,
    novel_title: novelTitle,
    episode_title: episodeTitle,
    last_episode: site === 'narou' ? n : episode, // なろうは話数（数値）で保存する（従来の形式）
    position: viewer.location,
  })
  setStatus('')
}

/** 次の話。カクヨムで次話なしなら、その後に公開されていないかサーバーに 1 回だけ確認する */
async function findNext() {
  if (current.next || site !== 'kakuyomu' || current.rechecked) return current.next
  const res = await request(`/api/kakuyomu/next-episode/${novelId}/${current.episode}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  current.rechecked = true
  return (current.next = data.next_episode_id)
}

/** 最新話だと知らせる。その後に公開された話を読めるよう、もう一度確かめるボタンを付ける（押したときだけ元サイトに確認する） */
function showLatest() {
  setStatus('最新話です', {
    label: '再確認',
    run: () => {
      if (site === 'narou') current.next = Number(current.episode) + 1
      else current.rechecked = false
      turn(true)
    },
  })
}

/** 次の話（forward）か前の話へ移る。次の話は先頭から、前の話は最後のページから表示する */
const turn = (forward) =>
  whileLoading(async () => {
    if (!current) return
    try {
      const episode = forward ? await findNext() : current.prev
      if (episode) await show(episode, forward ? START : END)
      else if (forward) showLatest()
      else setStatus('最初の話です')
    } catch (e) {
      if (forward && e.status === 404 && site === 'narou') {
        current.next = null // 最新話
        showLatest()
      } else {
        setStatus(e.message)
      }
    }
  })

/** URL の話を、読んでいた位置から開く。開けなかったら、やり直すボタンを出す */
const start = () =>
  whileLoading(async () => {
    try {
      await show(firstEpisode)
    } catch (e) {
      setStatus(e.message, { label: '再試行', run: start })
    }
  })

// ページの中央のクリック・タップで、ツールバーを出し入れする（隠した分だけページが広がる）。
// 隠したかどうかは覚えておき、次に開いたときも同じにする
const TOOLBAR_KEY = `${READER_STORAGE_KEY}:toolbar`
// ツールバーを出し入れした直後の relocate（ページの大きさが変わったことによるもの）を見分ける
let relayout = false
try {
  toolbar.hidden = localStorage.getItem(TOOLBAR_KEY) === 'hidden'
} catch {}
viewer.addEventListener('tap', () => {
  toolbar.hidden = !toolbar.hidden
  relayout = true
  // 戻し方が分かるように知らせる（ページをめくると消える）
  setStatus(toolbar.hidden ? 'ツールバーを隠しました（ページの中央を押すと戻ります）' : '')
  try {
    localStorage.setItem(TOOLBAR_KEY, toolbar.hidden ? 'hidden' : 'shown')
  } catch {}
})

viewer.addEventListener('bookend', () => turn(true))
viewer.addEventListener('bookstart', () => turn(false))
viewer.addEventListener('relocate', () => {
  if (loading || !current) return
  // ページをめくったら「最新話です」などを消す（ツールバーの出し入れによる再レイアウトでは消さない）
  if (!relayout) setStatus('')
  relayout = false
  savePosition(site, novelId, current.episode, viewer.location)
})
viewer.addEventListener('error', (e) => setStatus(`ページを表示できませんでした: ${e.detail.error}`))
start()
