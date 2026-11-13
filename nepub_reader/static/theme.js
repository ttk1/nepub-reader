// ページのテーマ（<html data-theme="light | sepia | dark">）を、リーダーで選んだテーマ（なければ OS の設定）に合わせる。
// トップページの配色と、リーダーの準備ができるまでの背景、端末の上部の帯の色に使う。
// 描画の前に決めたいので、モジュールではなく <head> で読み込む通常のスクリプトにしている。
;(() => {
  const systemDark = matchMedia('(prefers-color-scheme: dark)')
  // 端末の上部の帯（アドレスバーやステータスバー）の色。ページの背景と同じ色にする
  const themeColor = document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }))

  function apply() {
    let theme
    try {
      // EpubReader が保存する設定（history.js の READER_STORAGE_KEY と同じ接頭辞）
      theme = JSON.parse(localStorage.getItem('nepub-reader:settings'))?.theme
    } catch {}
    // 未設定・「自動」は OS の設定に従う
    if (!['light', 'sepia', 'dark'].includes(theme)) theme = systemDark.matches ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
    // <body> ができる前（<head> の読み込み中）は背景が分からないので、できてから決める
    if (document.body) {
      const background = getComputedStyle(document.body).backgroundColor
      themeColor.content = /^rgba\(.*, 0\)$|^transparent$/.test(background) ? '#ffffff' : background
    }
  }

  apply()
  document.addEventListener('DOMContentLoaded', apply)
  systemDark.addEventListener('change', apply)
  // ブラウザの「戻る」でリーダーから戻ってきたときにも合わせ直す
  addEventListener('pageshow', apply)
  // リーダーでテーマを変えたとき。同じページでの設定の保存は storage イベントにならないので、リーダーがこのイベントで知らせる
  addEventListener('nepub-reader:settings', apply)
})()
