// リーダー画面。1 話ぶんの EPUB を EpubReader で表示し、最後のページから先へ進むと次の話、
// 最初のページから戻ると前の話（の最後のページ）をページ遷移なしで読み込む。
import { EpubReader } from './epub-viewer/index.js'
import { READER_STORAGE_KEY, episodeKey, recordHistory } from './history.js'

// URL はサーバー側で検証済み（/read/<site>/<作品 ID>/<話>。話はなろうなら話数、カクヨムならエピソード ID）
const [, site, novelId, firstEpisode] = location.pathname.split('/').slice(1)

const reader = new EpubReader(document.getElementById('reader'), { storageKey: READER_STORAGE_KEY })
const title = reader.toolbar.querySelector('.title')
const status = document.createElement('span')
title.after(status)
reader.toolbar.prepend(Object.assign(document.createElement('a'), { href: '/', textContent: 'トップ' }))

/** 表示中の話と前後の話（null = ない。なろうの次話は開いてみるまで分からない） */
let current
// bookend / bookstart はキーを押すたびに発生するので、読み込み中は無視する
let loading = false

async function show(episode, location) {
  status.textContent = '読み込み中…'
  const res = await fetch(`/epub/${site}/${novelId}/${episode}`)
  if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status })
  const book = await reader.open(await res.blob(), { key: episodeKey(site, novelId, episode), location })

  const n = Number(episode)
  current =
    site === 'narou'
      ? { episode, prev: n > 1 ? n - 1 : null, next: n + 1 }
      : { episode, prev: res.headers.get('X-Prev-Episode') || null, next: res.headers.get('X-Next-Episode') || null }
  const novelTitle = book.metadata.title
  const episodeTitle = book.toc[0]?.label ?? ''
  title.textContent = `${novelTitle}　${episodeTitle}`
  document.title = `${episodeTitle} - ${novelTitle}`
  history.replaceState(null, '', `/read/${site}/${novelId}/${episode}`)
  recordHistory({
    site,
    novel_id: novelId,
    novel_title: novelTitle,
    episode_title: episodeTitle,
    last_episode: site === 'narou' ? n : episode, // なろうは話数（数値）で保存する（従来の形式）
  })
  status.textContent = ''
}

/** 次の話の ID。カクヨムで次話なしなら、その後に公開されていないかサーバーに 1 回だけ確認する */
async function findNext() {
  if (current.next || site !== 'kakuyomu' || current.rechecked) return current.next
  const res = await fetch(`/api/kakuyomu/next-episode/${novelId}/${current.episode}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  current.rechecked = true
  return (current.next = data.next_episode_id)
}

async function turn(forward) {
  if (loading || !current) return
  loading = true
  try {
    const episode = forward ? await findNext() : current.prev
    if (!episode) {
      status.textContent = forward ? '最新話です' : '最初の話です'
      return
    }
    await show(episode, forward ? { index: 0, progress: 0 } : { index: -1, progress: 1 })
  } catch (e) {
    if (forward && e.status === 404 && site === 'narou') {
      current.next = null // 最新話
      status.textContent = '最新話です'
    } else {
      status.textContent = e.message
    }
  } finally {
    loading = false
  }
}

reader.viewer.addEventListener('bookend', () => turn(true))
reader.viewer.addEventListener('bookstart', () => turn(false))
reader.viewer.addEventListener('relocate', () => {
  if (!loading) status.textContent = '' // ページをめくったら「最新話です」などを消す
})
reader.viewer.addEventListener('error', (e) => {
  status.textContent = `ページを表示できませんでした: ${e.detail.error}`
})

loading = true
show(firstEpisode) // 読書位置が保存されていれば続きから
  .catch((e) => (status.textContent = e.message))
  .finally(() => (loading = false))
