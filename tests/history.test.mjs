// 読書履歴（static/history.js）のテスト。Node.js の標準のテストランナーで動かす（実行方法は CLAUDE.md）
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const HISTORY_KEY = 'nepub_reading_history'

/** localStorage の代わり（history.js が使う範囲だけ） */
class FakeStorage {
  #items = new Map()
  get length() {
    return this.#items.size
  }
  key = (i) => [...this.#items.keys()][i] ?? null
  getItem = (key) => this.#items.get(key) ?? null
  setItem = (key, value) => this.#items.set(key, String(value))
  removeItem = (key) => this.#items.delete(key)
  keys = () => [...this.#items.keys()]
}

let load = 0
/** history.js を読み込み直す（読み込み時に、以前の版の読書位置の移行が走る） */
const loadHistory = () => import(`../nepub_reader/static/history.js?${load++}`)
const stored = () => JSON.parse(localStorage.getItem(HISTORY_KEY))
const entry = (fields) => ({ site: 'narou', novel_id: 'n1', novel_title: '作品', episode_title: '話', last_episode: 1, ...fields })

beforeEach(() => {
  globalThis.localStorage = new FakeStorage()
})

test('読んだ話を先頭に記録し、同じ作品の前の記録と置き換える', async () => {
  const { getHistory, recordHistory } = await loadHistory()
  recordHistory(entry({ novel_id: 'n1', last_episode: 1 }))
  recordHistory(entry({ novel_id: 'n2', last_episode: 5 }))
  recordHistory(entry({ novel_id: 'n1', last_episode: 2, position: { index: 0, progress: 0.3 } }))

  const history = getHistory()
  assert.deepEqual(history.map((item) => [item.novel_id, item.last_episode]), [['n1', 2], ['n2', 5]])
  assert.deepEqual(history[0].position, { index: 0, progress: 0.3 })
  assert.match(history[0].last_accessed, /^\d{4}-\d\d-\d\dT/)
})

test('履歴は 50 件まで', async () => {
  const { getHistory, recordHistory } = await loadHistory()
  for (let i = 0; i < 55; i++) recordHistory(entry({ novel_id: `n${i}` }))
  assert.equal(getHistory().length, 50)
  assert.equal(getHistory()[0].novel_id, 'n54')
})

test('読書位置は、履歴が指している話のものだけを保存・復元する', async () => {
  const { recordHistory, savePosition, savedPosition } = await loadHistory()
  recordHistory(entry({ site: 'narou', novel_id: 'n1', last_episode: 3 }))
  assert.equal(savedPosition('narou', 'n1', '3'), undefined)

  // なろうの話数は履歴では数値、URL では文字列
  savePosition('narou', 'n1', '3', { index: 0, progress: 0.5 })
  assert.deepEqual(savedPosition('narou', 'n1', '3'), { index: 0, progress: 0.5 })
  assert.equal(savedPosition('narou', 'n1', '4'), undefined)
  assert.equal(savedPosition('kakuyomu', 'n1', '3'), undefined)

  // 別のタブで先の話を開いた後に、前の話の位置で上書きしない
  recordHistory(entry({ site: 'narou', novel_id: 'n1', last_episode: 4, position: { index: 0, progress: 0 } }))
  savePosition('narou', 'n1', '3', { index: 0, progress: 0.9 })
  assert.deepEqual(savedPosition('narou', 'n1', '4'), { index: 0, progress: 0 })
})

test('壊れた履歴や読書位置は使わない', async () => {
  const { getHistory, savedPosition } = await loadHistory()
  localStorage.setItem(HISTORY_KEY, '{')
  assert.deepEqual(getHistory(), [])
  localStorage.setItem(HISTORY_KEY, '{"a":1}')
  assert.deepEqual(getHistory(), [])
  localStorage.setItem(HISTORY_KEY, JSON.stringify([entry({ last_episode: 1, position: { index: 'x', progress: null } })]))
  assert.equal(savedPosition('narou', 'n1', '1'), undefined)
})

test('保存された履歴に壊れた項目があっても、使える項目は読める', async () => {
  const { getHistory, recordHistory } = await loadHistory()
  const good = entry({ novel_id: 'n2', last_episode: 7, last_accessed: '2026-01-01T00:00:00.000Z' })
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify([null, 'x', { novel_id: 'n1' }, { novel_id: 'n3', last_episode: { a: 1 } }, { novel_id: 'n4', novel_title: 5, episode_title: {}, last_episode: 2, last_accessed: 9 }, good]),
  )
  assert.deepEqual(getHistory().map((item) => [item.novel_id, item.novel_title, item.episode_title, item.last_accessed]), [
    ['n4', 'n4', '', ''],
    ['n2', '作品', '話', '2026-01-01T00:00:00.000Z'],
  ])
  // 記録もできる（壊れた項目は、このときに取り除かれる）
  recordHistory(entry({ novel_id: 'n5' }))
  assert.deepEqual(stored().map((item) => item.novel_id), ['n5', 'n4', 'n2'])
})

test('site のない古い履歴は、なろうとして扱う', async () => {
  const { novelKey, savedPosition } = await loadHistory()
  const old = { novel_id: 'n1', last_episode: 2, position: { index: 0, progress: 0.2 } }
  localStorage.setItem(HISTORY_KEY, JSON.stringify([old]))
  assert.equal(novelKey(old), 'narou:n1')
  assert.deepEqual(savedPosition('narou', 'n1', '2'), { index: 0, progress: 0.2 })
})

test('以前の版が保存した読書位置を履歴に移して消す', async () => {
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify([entry({ site: 'kakuyomu', novel_id: '100', last_episode: '200' }), entry({ site: 'narou', novel_id: 'n1', last_episode: 3 })]),
  )
  localStorage.setItem('nepub-reader:position:kakuyomu:100:200', JSON.stringify({ index: 0, progress: 0.5 }))
  localStorage.setItem('nepub-reader:position:narou:n1:2', JSON.stringify({ index: 0, progress: 0.9 })) // 履歴が指していない話
  localStorage.setItem('nepub-reader:position:narou:n9:1', '{') // 壊れたもの
  localStorage.setItem('nepub-reader:settings', JSON.stringify({ theme: 'dark' }))

  await loadHistory()
  assert.deepEqual(stored()[0].position, { index: 0, progress: 0.5 })
  assert.equal(stored()[1].position, undefined)
  assert.deepEqual(localStorage.keys().sort(), ['nepub-reader:settings', HISTORY_KEY])
})

test('履歴を合わせる: 同じ作品は新しい方を残し、新しい順に並べる', async () => {
  const { mergeHistory } = await loadHistory()
  const merged = mergeHistory(
    [entry({ novel_id: 'n1', last_episode: 5, last_accessed: '2026-03-01T00:00:00.000Z' }), entry({ novel_id: 'n2', last_accessed: '2026-01-01T00:00:00.000Z' })],
    [entry({ novel_id: 'n1', last_episode: 9, last_accessed: '2026-02-01T00:00:00.000Z' }), entry({ novel_id: 'n3', last_accessed: '2026-04-01T00:00:00.000Z' })],
  )
  assert.deepEqual(merged.map((item) => [item.novel_id, item.last_episode]), [['n3', 1], ['n1', 5], ['n2', 1]])
})

test('インポートする履歴は、既知の項目だけを残す', async () => {
  const { sanitizeHistoryItem } = await loadHistory()
  assert.deepEqual(
    sanitizeHistoryItem({
      site: 'kakuyomu',
      novel_id: 100,
      novel_title: '作品',
      episode_title: '話',
      last_episode: '200',
      last_accessed: '2026-01-01T00:00:00.000Z',
      position: { index: 0, progress: 0.5, extra: 1 },
      unknown: '<script>',
    }),
    {
      site: 'kakuyomu',
      novel_id: '100',
      novel_title: '作品',
      episode_title: '話',
      last_episode: '200',
      last_accessed: '2026-01-01T00:00:00.000Z',
      position: { index: 0, progress: 0.5 },
    },
  )
  // site がない、タイトルが文字列でない、位置が壊れている
  assert.deepEqual(sanitizeHistoryItem({ novel_id: 'n1', last_episode: 3, novel_title: 1, position: 'x' }), {
    site: 'narou',
    novel_id: 'n1',
    novel_title: 'n1',
    episode_title: '',
    last_episode: 3,
    last_accessed: '',
    position: undefined,
  })
  for (const junk of [null, 'x', 1, {}, { novel_id: 'n1' }, { last_episode: 1 }, { novel_id: 'n1', last_episode: {} }]) assert.equal(sanitizeHistoryItem(junk), null)
})
