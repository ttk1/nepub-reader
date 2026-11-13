// 元サイト（小説家になろう / カクヨム）の名前と URL。トップページ（index.js）とリーダー（reader.js）で共有する。
// site は 'narou' か 'kakuyomu'。話はなろうなら話数、カクヨムならエピソード ID。

export const siteName = (site) => (site === 'kakuyomu' ? 'カクヨム' : '小説家になろう')

/** 作品のページ */
export const novelUrl = (site, novelId) =>
  site === 'kakuyomu' ? `https://kakuyomu.jp/works/${encodeURIComponent(novelId)}` : `https://ncode.syosetu.com/${encodeURIComponent(novelId)}/`

/** 話のページ */
export const episodeUrl = (site, novelId, episode) =>
  site === 'kakuyomu' ? `${novelUrl(site, novelId)}/episodes/${encodeURIComponent(episode)}` : `${novelUrl(site, novelId)}${encodeURIComponent(episode)}/`
