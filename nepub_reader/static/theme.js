// ページのテーマ（<html data-theme="light | sepia | dark">）を、リーダーで選んだテーマ（なければ OS の設定）に合わせる。
// トップページの配色と、リーダーの準備ができるまでの背景に使う。
// 描画の前に決めたいので、モジュールではなく <head> で読み込む通常のスクリプトにしている。
;(() => {
  const systemDark = matchMedia('(prefers-color-scheme: dark)')

  function apply() {
    let theme
    try {
      // EpubReader が保存する設定（history.js の READER_STORAGE_KEY と同じ接頭辞）
      theme = JSON.parse(localStorage.getItem('nepub-reader:settings'))?.theme
    } catch {}
    // 未設定・「自動」は OS の設定に従う
    if (!['light', 'sepia', 'dark'].includes(theme)) theme = systemDark.matches ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
  }

  apply()
  systemDark.addEventListener('change', apply)
  // ブラウザの「戻る」でリーダーから戻ってきたときにも合わせ直す
  addEventListener('pageshow', apply)
})()
