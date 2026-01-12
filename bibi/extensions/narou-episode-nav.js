/*!
 *  Narou Episode Navigation Extension for Bibi
 *  - Automatically navigates to the next/previous episode at book boundaries
 *  - Persists font size settings across episodes using Bibi's Biscuits
 *
 *  Bibi グローバル変数:
 *  - R: Reader（現在の表示状態、ページ情報など）
 *  - E: Events（イベントバインディング）
 *  - O: Options（設定、Biscuits=クッキー管理など）
 *  - I: Interactions（UIコンポーネント、FontSizeChangerなど）
 */
Bibi.x({
    id: "NarouEpisodeNavigation",
    description: "Navigate between episodes of Narou novels.",
    author: "Custom",
    version: "1.0.0"
})(function() {

    // URL パラメータの book からファイル名をパースして小説IDとエピソード番号を取得
    // book=narou/{novel_id}_{episode}.epub 形式を想定
    function getEpisodeInfo() {
        var params = new URLSearchParams(window.location.search);
        var book = params.get('book');
        if (!book) return null;
        // narou/{novel_id}_{episode}.epub からファイル名部分を抽出
        var filename = book.split('/').pop();
        if (!filename) return null;
        // {novel_id}_{episode}.epub をパース
        var match = filename.match(/^(.+)_(\d+)\.epub$/);
        if (!match) return null;
        return { novel: match[1], episode: parseInt(match[2], 10) };
    }

    // 指定方向のエピソードURLを生成
    function getEpisodeUrl(direction) {
        var info = getEpisodeInfo();
        if (!info) return null;
        var newEpisode = info.episode + direction;
        if (newEpisode < 1) return null;
        return '/read/' + info.novel + '/' + newEpisode;
    }

    // 最後のスプレッド（見開き）かどうかを判定
    function isLastSpread() {
        if (!R || !R.Current || !R.Current.Pages || !R.Pages || R.Pages.length === 0) return false;
        var lastPage = R.Pages[R.Pages.length - 1];
        return R.Current.Pages.indexOf(lastPage) !== -1;
    }

    // 最初のスプレッド（見開き）かどうかを判定
    function isFirstSpread() {
        if (!R || !R.Current || !R.Current.Pages || !R.Pages || R.Pages.length === 0) return false;
        var firstPage = R.Pages[0];
        return R.Current.Pages.indexOf(firstPage) !== -1;
    }

    // 末尾ページへ移動
    function navigateToFoot() {
        var lastPage = R.Pages[R.Pages.length - 1];
        R.focusOn({ Destination: lastPage, Duration: 0 });
    }

    // 次のエピソードへ移動
    function goToNextEpisode() {
        var url = getEpisodeUrl(1);
        if (url) window.location.href = url;
    }

    // 前のエピソードの末尾へ移動
    function goToPrevEpisode() {
        var url = getEpisodeUrl(-1);
        if (url) window.location.href = url + '#bibi(edge=foot)';
    }

    // キーイベントハンドラ
    function handleKeyDown(e) {
        if (!getEpisodeInfo()) return;
        if (e.key === 'ArrowLeft' && isLastSpread()) {
            goToNextEpisode();
        } else if (e.key === 'ArrowRight' && isFirstSpread()) {
            goToPrevEpisode();
        }
    }

    // メインドキュメントにキーイベントを登録
    document.addEventListener('keydown', handleKeyDown, true);

    // 文字サイズ変更時に Biscuits に保存（リロード時も設定が維持される）
    E.bind('bibi:changed-font-size', function() {
        if (O.Biscuits && I.FontSizeChanger) {
            O.Biscuits.memorize('Bibi', { FontSize: { Step: I.FontSizeChanger.Step || 0 } });
        }
    });

    // 本の読み込み完了後の処理
    E.bind('bibi:opened', function() {
        // edge=foot が指定されている場合、末尾へ移動
        if (window.location.hash.indexOf('edge=foot') !== -1) {
            setTimeout(navigateToFoot, 100);
        }

        // 各アイテムの contentDocument にキーイベントを登録
        if (R && R.Items) {
            R.Items.forEach(function(item) {
                if (item.contentDocument) {
                    item.contentDocument.addEventListener('keydown', handleKeyDown, true);
                }
            });
        }
    });
});
