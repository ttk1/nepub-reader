// リーダー画面。1 話ぶんの EPUB を EpubReader で表示し、最後のページから先へ進むと次の話、
// 最初のページから戻ると前の話（の最後のページ）をページ遷移なしで読み込む。
import { EpubReader } from './epub-viewer/index.js'
import { READER_STORAGE_KEY, recordHistory, savePosition, savedPosition } from './history.js'
import { episodeUrl, novelUrl, siteName } from './sites.js'

// URL はサーバー側で検証済み（/read/<site>/<作品 ID>/<話>。話はなろうなら話数、カクヨムならエピソード ID）
const [, site, novelId, firstEpisode] = location.pathname.split('/').slice(1)

// 話の先頭と、最後のページ（index: -1 = 最後のセクション）
const START = { index: 0, progress: 0 }
const END = { index: -1, progress: 1 }

// nepub は話タイトルを大きな文字にし、上下に 2 文字分ずつ余白を取る。高さの低い画面（横向きのスマートフォンなど）では
// 余白だけでページが埋まり、1 行に 1 文字しか入らなくなるので、そのときだけ文字と余白を小さくする。
// EPUB には書き込まず表示のときに足すので、キャッシュ済みの話にも効き、後から変えられる
const PAGE_STYLE = '@media (max-height: 500px) { h1 { margin-top: 0.5em; margin-bottom: 0.5em; font-size: 1.4em; } }'

const el = (tag, props, ...children) => {
  const element = Object.assign(document.createElement(tag), props)
  element.append(...children)
  return element
}

// ---- 画面の部品 ----

// EpubReader には表示設定だけを保存させる。読書位置は読書履歴と一緒に持つ（history.js）ので、保存させない
const SETTINGS_KEY = `${READER_STORAGE_KEY}:settings`
const settingsStorage = {
  getItem: (key) => (key === SETTINGS_KEY ? localStorage.getItem(key) : null),
  setItem: (key, value) => {
    if (key !== SETTINGS_KEY) return
    localStorage.setItem(key, value)
    // テーマが変わったかもしれないので、ページの側（theme.js。準備中の背景と、端末の上部の帯の色）に知らせる
    dispatchEvent(new Event('nepub-reader:settings'))
  },
}

// EpubReader の既定の文字サイズ（45px）は、離れて読む大きな画面向け。スマートフォンでは 1 ページに
// 数文字しか入らないので、狭い画面では初期値を小さくする（利用者が変えた後は、その値が使われる）。
// 横向きのスマートフォンは幅が広いので、高さでも見る
const settings = matchMedia('(max-width: 600px), (max-height: 600px)').matches ? { fontSize: 24 } : {}

const reader = new EpubReader(document.getElementById('reader'), { storage: settingsStorage, storageKey: READER_STORAGE_KEY, settings })
const { toolbar, viewer } = reader
/** @type {HTMLElement} */
const title = toolbar.querySelector('.title')

// 「前の話」「次の話」。狭い画面では「の」を隠して短くする（reader.css）
const episodeButton = (word, key, forward) =>
  el('button', { type: 'button', title: `${word}の話（${key} キー）`, onclick: () => turn(forward) }, word, el('span', { className: 'wide', textContent: 'の' }), '話')
const prevButton = episodeButton('前', 'P', false)
const nextButton = episodeButton('次', 'N', true)
toolbar.prepend(el('a', { href: '/', textContent: 'トップ' }), prevButton, nextButton)
// 読んでいる話の、元サイトのページへのリンク（感想を書く、ブックマークする、など）。狭い画面では出さない（reader.css）
const sourceLink = toolbar.appendChild(el('a', { className: 'source', textContent: '元ページ', target: '_blank', rel: 'noopener noreferrer', title: `${siteName(site)}でこの話を開く` }))

// 読み込み中・最新話などの知らせ。ツールバーを隠していても見えるよう、ページの上に重ねて出す
const status = document.body.appendChild(el('div', { id: 'status', role: 'status' }))

/** 知らせを出す（'' で消す）。action は一緒に出すボタン { label, run } */
function setStatus(text, action) {
  status.replaceChildren(...(text ? [text] : []))
  if (action) status.append(el('button', { type: 'button', textContent: action.label, onclick: action.run }))
}

// ---- 話の表示 ----

/** 表示中の話と前後の話（null = ない。なろうの次話は開いてみるまで分からない）。short は、なろうの短編（話に分かれていない作品） */
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
  // EpubReader のエラーは英語なので、何が起きたかを前に付ける
  const book = await reader.open(await res.blob(), { location: location ?? START }).catch((e) => {
    throw new Error(`話を表示できませんでした（${e.message}）`)
  })

  const n = Number(episode)
  // サーバーは、カクヨムと、なろうの短編（1 話として扱う）のときに、前後の話をヘッダーで返す
  const adjacent = res.headers.has('X-Next-Episode')
  current = adjacent
    ? { episode, prev: res.headers.get('X-Prev-Episode') || null, next: res.headers.get('X-Next-Episode') || null, short: site === 'narou' }
    : { episode, prev: n > 1 ? n - 1 : null, next: n + 1 }

  const novelTitle = book.metadata.title
  // 短編は話タイトルが作品名と同じなので、出さない
  const episodeTitle = current.short ? '' : (book.toc[0]?.label ?? '')
  title.textContent = [novelTitle, episodeTitle].filter(Boolean).join('　')
  title.title = title.textContent // 長くて省略されたときに、全体を確かめられるように
  document.title = [episodeTitle, novelTitle].filter(Boolean).join(' - ')
  prevButton.disabled = !current.prev
  sourceLink.href = current.short ? novelUrl(site, novelId) : episodeUrl(site, novelId, episode)
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

// ---- 話の移動 ----

/** 次の話。カクヨムで次話なしなら、その後に公開されていないかサーバーに 1 回だけ確認する */
async function findNext() {
  if (current.next || site !== 'kakuyomu' || current.rechecked) return current.next
  // 確認に失敗しても、自動では繰り返さない（キーを押すたびに元サイトへアクセスしないように）
  current.rechecked = true
  const res = await request(`/api/kakuyomu/next-episode/${novelId}/${current.episode}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `次の話を確認できませんでした（${res.status}）`)
  return (current.next = data.next_episode_id)
}

/** 次の話がないと知らせる。その後に公開された話を読めるよう、もう一度確かめるボタンを付ける（押したときだけ元サイトに確認する） */
function showLatest(text = '最新話です') {
  setStatus(text, {
    label: '再確認',
    run: () => {
      if (site === 'narou') current.next = Number(current.episode) + 1
      else current.rechecked = false
      current.nextError = undefined
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
      else if (forward && current.short) setStatus('短編です（次の話はありません）')
      else if (forward) showLatest(current.nextError) // 確認に失敗していたら、最新話とは言わない
      else setStatus('最初の話です')
    } catch (e) {
      if (forward && e.status === 404 && site === 'narou') {
        current.next = null // 最新話
        showLatest()
      } else if (forward && !current.next) {
        current.nextError = e.message // 次の話の確認に失敗した。やり直せるようにする
        showLatest(e.message)
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

// ---- 操作 ----

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

// N で次の話、P で前の話。ページ送りのキーは EpubReader が受ける
function onKey(e) {
  // 押しっぱなしでは移らない（話を次々に取得して、元サイトに負荷をかけないように）
  if (e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'n') turn(true)
  else if (key === 'p') turn(false)
}
addEventListener('keydown', onKey)

viewer.addEventListener('sectionload', (e) => {
  const { doc } = e.detail
  // 本文をクリックした後はキーが本文の文書に届くので、そちらでも受ける
  doc.defaultView.addEventListener('keydown', onKey)
  doc.head.append(Object.assign(doc.createElement('style'), { textContent: PAGE_STYLE }))
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
