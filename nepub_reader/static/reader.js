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

// 本文の表示のしかたを、このアプリの都合で変えるところ。
// EPUB には書き込まず表示のときに足すので、キャッシュ済みの話にも効き、後から変えられる
const PAGE_STYLE = [
  // nepub は話タイトルを大きな文字にし、上下に 2 文字分ずつ余白を取る。高さの低い画面（横向きのスマートフォンなど）では
  // 余白だけでページが埋まり、1 行に 1 文字しか入らなくなるので、そのときだけ文字と余白を小さくする
  '@media (max-height: 500px) { h1 { margin-top: 0.5em; margin-bottom: 0.5em; font-size: 1.4em; } }',
  // 折り返した行は、字間をわずかに広げて行末まで届かせる（本の組版の行頭行末揃え）。
  // 1 行に入る文字数は整数なので、揃えないと、行の長さを文字の大きさで割った余り（最大でほぼ 1 文字分）が行末に溜まる。
  // 縦書きではそれがページの下の余白に見え、ツールバーの出し入れなどで行の長さが変わるたびに、余白が増減して見える
  'p { text-align: justify; }',
].join('\n')

const el = (tag, props, ...children) => {
  const element = Object.assign(document.createElement(tag), props)
  element.append(...children)
  return element
}

// ---- 表示設定の保存と、広い画面での倍率 ----

// 広い画面では、ツールバーなどを拡大している。ページの余白も、同じ幅から同じ倍率で広げる
// （[幅, 倍率]。reader.css の末尾と同じ値。そろっていることは tests/test_static.py が確かめている）
const WIDE_SCALES = [[2400, 1.25], [3000, 1.5], [3600, 1.75]]
const wideQueries = WIDE_SCALES.map(([width]) => matchMedia(`(min-width: ${width}px)`))
const currentWideScale = () => WIDE_SCALES.reduce((scale, [, wider], i) => (wideQueries[i].matches ? wider : scale), 1)
// いまの余白と、その選択肢に掛けてある倍率。ウィンドウの幅が変わったら、fitToWindow() が掛け直す
let wideScale = currentWideScale()

/**
 * 保存する設定（JSON）の余白を `by` 倍する。余白は、倍率を掛ける前の値で保存する: 広げた値のまま保存すると、
 * 幅の違う画面で開いたときに、選んだ段（「標準」など）とは別の段の値に近くなって、段がずれる
 */
function scaleSavedMargin(json, by) {
  try {
    const saved = JSON.parse(json)
    return typeof saved?.margin === 'number' ? JSON.stringify({ ...saved, margin: saved.margin * by }) : json
  } catch {
    return json // 壊れた保存データは、そのまま EpubReader に渡す（EpubReader が捨てる）
  }
}

// EpubReader には表示設定だけを保存させる。読書位置は読書履歴と一緒に持つ（history.js）ので、保存させない
const SETTINGS_KEY = `${READER_STORAGE_KEY}:settings`
const settingsStorage = {
  getItem: (key) => (key === SETTINGS_KEY ? scaleSavedMargin(localStorage.getItem(key), wideScale) : null),
  setItem: (key, value) => {
    if (key !== SETTINGS_KEY) return
    localStorage.setItem(key, scaleSavedMargin(value, 1 / wideScale))
    // テーマが変わったかもしれないので、ページの側（theme.js。準備中の背景と、端末の上部の帯の色）に知らせる
    dispatchEvent(new Event('nepub-reader:settings'))
  },
}

// ---- 表示設定（EpubReader の設定メニュー）の初期値と選択肢 ----

// EpubReader の既定の文字サイズ（45px）は、離れて読む大きな画面向け。スマートフォンでは 1 ページに
// 数文字しか入らないので、狭い画面では初期値を小さくする（利用者が変えた後は、その値が使われる）。
// 横向きのスマートフォンは幅が広いので、高さでも見る
const smallScreen = matchMedia('(max-width: 600px), (max-height: 600px)').matches ? { fontSize: 24 } : {}
// 文字サイズのボタンは、1 回で 1.1 倍にする。既定の 1.2 倍では、スマートフォンで 1 段の差が大きく
// （24 → 29px で、1 ページの行が 1〜2 行変わる）、ちょうどよい大きさを選べない
const FONT_SIZE_STEP = 1.1

// 行間。nepub の EPUB は行間を指定しないので、既定の選択肢にある「本の指定」は「標準」と同じ表示になる。
// それを除いて、刻みを細かくする（既定は 0.3 刻み）
const DEFAULT_LINE_HEIGHT = 1.6
/** @type {[number, string][]} */
const lineHeights = [[1.4, '狭い'], [DEFAULT_LINE_HEIGHT, '標準'], [1.8, 'やや広い'], [2, '広い'], [2.2, 'とても広い']]

// 表示幅。広い画面で少しだけ狭めることもできるように、既定の選択肢（1400 まで）より広いものも用意する。
// 並べるのは、ウィンドウより狭いもののうち、広いほうから 5 つまで（設定メニューの 1 行に収まる数。広い画面で
// 600px まで狭めることは、まずない）。選んでも変わらないもの（ページの幅以上のもの）を隠すのと、1 つも残らないときに
// 行ごと隠すのは、EpubReader がする
const MAX_WIDTHS = [2400, 1800, 1400, 1200, 1000, 800, 600]
/** @returns {[number, string][]} */
const maxWidthChoices = () => [[0, '全幅'], ...MAX_WIDTHS.filter((px) => px < innerWidth).slice(0, 5).map((px) => /** @type {[number, string]} */ ([px, String(px)]))]

// ページの余白（倍率を掛ける前の値）。ツールバーを隠している間の進み具合の文字を、下の余白に重ねて出す（reader.css）ので、
// いちばん狭い余白でも、その文字が本文に重ならずに収まる広さにする（文字 12px + その下 2px + 本文との間 6px。
// スマートフォンでは、これより広げると 1 ページの行が 1 行減る）。広い画面では、文字と同じ倍率（wideScale）を掛ける
/** @type {[number, string][]} */
const MARGINS = [[20, '狭い'], [32, '標準'], [64, '広い'], [96, 'とても広い'], [128, '特大'], [160, '最大']]
const DEFAULT_MARGIN = 32
/** @returns {[number, string][]} */
const marginChoices = () => MARGINS.map(([px, label]) => /** @type {[number, string]} */ ([px * wideScale, label]))

const reader = new EpubReader(document.getElementById('reader'), {
  storage: settingsStorage,
  storageKey: READER_STORAGE_KEY,
  settings: { ...smallScreen, lineHeight: DEFAULT_LINE_HEIGHT, margin: DEFAULT_MARGIN * wideScale },
  choices: { lineHeight: lineHeights, maxWidth: maxWidthChoices(), margin: marginChoices() },
  fontSizeSteps: { step: FONT_SIZE_STEP },
})

/**
 * 保存されていた設定が選択肢にないとき（選択肢を変える前の値）は、いちばん近い選択肢に寄せる。
 * 表示幅は寄せない（画面より広い値は、選択肢になくても全幅と同じ表示で、広い画面で開いたときにまた効く）
 * @param {'lineHeight' | 'margin'} name
 * @param {[number, string][]} choices
 * @param {number} saved
 */
function snapToChoices(name, choices, saved) {
  const nearest = choices.map(([value]) => value).reduce((a, b) => (Math.abs(b - saved) < Math.abs(a - saved) ? b : a))
  if (nearest !== reader.settings[name]) reader.setSettings({ [name]: nearest })
}
// 行間の 0 は、以前の選択肢の「本の指定」
snapToChoices('lineHeight', lineHeights, reader.settings.lineHeight || DEFAULT_LINE_HEIGHT)
snapToChoices('margin', marginChoices(), reader.settings.margin)

// ウィンドウの幅が変わったら、幅で決まる選択肢（表示幅と余白）を、その場で入れ替える。
// 倍率の変わる幅をまたいだら、余白は、選んでいた段のまま新しい倍率の値にする: そのままだと、進み具合の文字だけが
// 大きくなって（reader.css）、狭い余白では本文に重なる。
// 印刷の間は、紙の幅で判定し直されて幅が変わったように見えるので、何もしない
let printing = false
addEventListener('beforeprint', () => (printing = true))
addEventListener('afterprint', () => (printing = false))
let shownMaxWidths = String(maxWidthChoices())
function fitToWindow() {
  if (printing) return
  const maxWidths = maxWidthChoices()
  // 幅を変えている間は続けて呼ばれるので、並びが変わったときだけ入れ替える
  if (String(maxWidths) !== shownMaxWidths) {
    shownMaxWidths = String(maxWidths)
    reader.setChoices({ maxWidth: maxWidths })
  }
  const scale = currentWideScale()
  if (scale === wideScale) return
  const margin = (reader.settings.margin / wideScale) * scale
  wideScale = scale // 設定を保存するときに外す倍率も、ここから新しい倍率になる
  reader.setChoices({ margin: marginChoices() })
  reader.setSettings({ margin })
}
addEventListener('resize', fitToWindow)
// WebKit は、resize のときにはまだ幅の判定（matchMedia）を新しくしていないので、判定が変わったときにも呼ぶ
for (const query of wideQueries) query.addEventListener('change', fitToWindow)

// ---- 画面の部品 ----

const { toolbar, viewer } = reader
/** @type {HTMLElement} */
const title = toolbar.querySelector('.title')
// 作品名と話タイトルを、このページの見出しとして伝える（読み上げソフトで見出しへ移動できるように）
title.setAttribute('role', 'heading')
title.setAttribute('aria-level', '1')

// 「前の話」「次の話」。狭い画面では「の」を隠して短くする（reader.css）
const episodeButton = (word, key, forward) =>
  el('button', { type: 'button', title: `${word}の話（${key} キー）`, onclick: () => turn(forward) }, word, el('span', { className: 'wide', textContent: 'の' }), '話')
const prevButton = episodeButton('前', 'P', false)
const nextButton = episodeButton('次', 'N', true)
// 話を開くまでは、移る先が分からないので押せなくしておく（開けなかったときも、そのまま）
prevButton.disabled = nextButton.disabled = true
toolbar.prepend(el('a', { href: '/', textContent: 'トップ' }), prevButton, nextButton)
// 読んでいる話の、元サイトのページへのリンク（感想を書く、ブックマークする、など）。狭い画面では出さない（reader.css）
const sourceLink = toolbar.appendChild(el('a', { className: 'source', textContent: '元ページ', target: '_blank', rel: 'noopener noreferrer', title: `${siteName(site)}でこの話を開く` }))

// 読み込み中・最新話などの知らせ。ツールバーを隠していても見えるよう、ページの上に重ねて出す
const status = document.body.appendChild(el('div', { id: 'status', role: 'status' }))

/** リーダーの枠（EpubReader に渡した要素） */
const root = toolbar.parentElement

// ツールバーを隠している間の、進み具合の表示。どこまで読んだかはいつも見ていたいが、そのためにツールバーを
// 出しておくと、その分ページが狭くなる。ページの余白に重ねて出す（reader.css）。
// リーダーの枠の中に置いて、テーマの文字色を引き継ぐ
const miniLine = el('span', { className: 'mini-line' })
const miniText = el('span', { className: 'mini-text' })
const miniProgress = root.appendChild(el('div', { className: 'mini-progress', hidden: true }, miniLine, miniText))
viewer.addEventListener('relocate', (e) => {
  const { page, pages, fraction, rtl } = e.detail
  // ツールバーの進み具合と同じ書き方にする
  miniText.textContent = `${page + 1} / ${pages}（${Math.round(fraction * 100)}%）`
  miniLine.style.setProperty('--fraction', String(fraction))
  // 線は、ページが進む向きに伸びる（縦書きでは右から）
  miniLine.dataset.from = rtl ? 'right' : 'left'
})

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
// 「読み込み中…」を出すまでの時間。キャッシュ済みの話はすぐ開くので、そのたびに知らせが一瞬出て消えるのを避ける
const LOADING_NOTICE_MS = 300

async function whileLoading(task) {
  if (loading) return
  loading = true
  const notice = setTimeout(() => setStatus('読み込み中…'), LOADING_NOTICE_MS)
  try {
    await task()
  } finally {
    clearTimeout(notice)
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
  // 次の話は、ないと分かっていても押せるままにする（最新話だと知らせ、再確認のボタンを出すため）
  nextButton.disabled = false
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
      startFailed = false
    } catch (e) {
      startFailed = true
      setStatus(e.message, { label: '再試行', run: start })
    }
    showToolbar()
  })

// ---- 操作 ----

// ツールバーは、ページの上に重ねて出す（reader.css）。ページはいつも画面いっぱいで、ツールバーを出し入れしても
// 大きさが変わらない。ツールバーの分だけページを縮めると、出し入れのたびに本文が組み直され、読んでいる場所が
// ずれて分からなくなる。
// ページの中央のクリック・タップで出し入れする。出しているとページの上の端が隠れるので、操作するときだけ出すもの。
// 出したかどうかは覚えず、開いたときはいつも隠しておく
let toolbarOpen = false
// 隠したツールバーを、マウスを画面の上の端に寄せている間だけ出しているか
let peeking = false
// 話を開けなかった。隠していても、トップページへ戻るリンクのあるツールバーを出しておく
let startFailed = false

function showToolbar() {
  toolbar.hidden = !(toolbarOpen || peeking || startFailed)
  miniProgress.hidden = !toolbar.hidden
}
// M キーで出したときに、フォーカスを置けるようにする
toolbar.tabIndex = -1
showToolbar()

function toggleToolbar() {
  toolbarOpen = !toolbarOpen
  peeking = false
  showToolbar()
}
viewer.addEventListener('tap', toggleToolbar)

// マウスを画面の上の端（ツールバーが出るあたり）に寄せても出し、離れたら隠す（出し方を忘れても出せるように）。
// タッチ操作には、寄せるという動きがないので働かせない
// ツールバーの高さより少し広い範囲。広い画面ではツールバーを拡大している（reader.css）ので、その分広げる
const peekZone = () => 48 * (Number(getComputedStyle(toolbar).zoom) || 1)
/** マウスが動いた。y は画面の上の端からの位置、onToolbar はツールバー（メニューを含む）の上にあるか */
function onMouseMove(y, onToolbar) {
  if (toolbarOpen) return
  // メニューを開いている間は、マウスが離れても隠さない（メニューを閉じた後で、離れていれば隠す）
  const wanted = onToolbar || y <= peekZone() || (peeking && toolbar.querySelector('details[open]') !== null)
  if (wanted === peeking) return
  peeking = wanted
  showToolbar()
}
const isMouse = (e) => e.pointerType === 'mouse'
addEventListener('pointermove', (e) => isMouse(e) && onMouseMove(e.clientY, e.target instanceof Node && toolbar.contains(e.target)))
// マウスが画面の外へ出た（ブラウザのタブやアドレスバーへ動かした）
document.documentElement.addEventListener('pointerleave', (e) => isMouse(e) && onMouseMove(Infinity, false))

// N で次の話、P で前の話、M でツールバーの出し入れ。ページ送りのキーは EpubReader が受ける
function onKey(e) {
  // 押しっぱなしでは働かせない（話を次々に取得して、元サイトに負荷をかけないように）
  if (e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'n') turn(true)
  else if (key === 'p') turn(false)
  else if (key === 'm' && !toolbar.querySelector('details[open]')) {
    // キーボードだけで使うときは、これがツールバーの唯一の出し方。出したら、続けて Tab で中のボタンへ進めるように、
    // フォーカスをツールバーに置く（本文にあると、Tab がツールバーへ行かない）。
    // メニューを開いている間は働かせない（メニューごと隠すと、見えないメニューが、キーでのページ送りを止め続ける）
    toggleToolbar()
    if (toolbarOpen) toolbar.focus()
  }
}
addEventListener('keydown', onKey)

viewer.addEventListener('sectionload', (e) => {
  const { doc } = e.detail
  // 本文をクリックした後はキーが本文の文書に届くので、そちらでも受ける
  doc.defaultView.addEventListener('keydown', onKey)
  // 本文の上でのマウスの動きも、本文の文書にしか届かない。本文の枠の位置を足して、画面の上の端からの位置にする
  doc.addEventListener('pointermove', (e) => isMouse(e) && onMouseMove(e.clientY + (doc.defaultView.frameElement?.getBoundingClientRect().top ?? 0), false))
  doc.head.append(Object.assign(doc.createElement('style'), { textContent: PAGE_STYLE }))
})
viewer.addEventListener('bookend', () => turn(true))
viewer.addEventListener('bookstart', () => turn(false))
viewer.addEventListener('relocate', () => {
  if (loading || !current) return
  // ページをめくったら「最新話です」などを消す
  setStatus('')
  savePosition(site, novelId, current.episode, viewer.location)
})
// ページ送りや書籍内のリンクでの移動に失敗した（EpubViewer のエラーは英語なので、何が起きたかを前に付ける）
viewer.addEventListener('error', (e) => {
  const { error } = e.detail
  setStatus(`ページを表示できませんでした（${error instanceof Error ? error.message : error}）`)
})

start()
