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

    // ホイールスクロールによるエピソード遷移用の状態
    var wheelAccumulator = 0;
    var wheelThreshold = 100;
    var wheelResetTimer = null;

    // ホイールイベントハンドラ
    function handleWheel(e) {
        if (!getEpisodeInfo()) return;

        var delta = e.deltaX || e.deltaY;
        var atFirst = isFirstSpread();
        var atLast = isLastSpread();

        // 境界ページでない場合はリセット
        if (!atFirst && !atLast) {
            wheelAccumulator = 0;
            return;
        }

        // 境界ページで、進行方向へのスクロールのみ蓄積
        if ((atFirst && delta < 0) || (atLast && delta > 0)) {
            clearTimeout(wheelResetTimer);
            wheelAccumulator += Math.abs(delta);
            wheelResetTimer = setTimeout(function() { wheelAccumulator = 0; }, 800);

            if (wheelAccumulator > wheelThreshold) {
                wheelAccumulator = 0;
                if (atFirst) {
                    goToPrevEpisode();
                } else {
                    goToNextEpisode();
                }
            }
        } else {
            wheelAccumulator = 0;
        }
    }

    // メインドキュメントにキーイベントを登録
    document.addEventListener('keydown', handleKeyDown, true);

    // メインドキュメントにホイールイベントを登録
    document.addEventListener('wheel', handleWheel, { passive: true });

    // 文字サイズ変更時に Biscuits に保存（リロード時も設定が維持される）
    E.bind('bibi:changed-font-size', function() {
        if (O.Biscuits && I.FontSizeChanger) {
            O.Biscuits.memorize('Bibi', { FontSize: { Step: I.FontSizeChanger.Step || 0 } });
        }
    });

    // 読書履歴を LocalStorage に保存
    function saveReadingHistory(info, novelTitle) {
        if (!info) return;
        var STORAGE_KEY = 'nepub_reading_history';
        var MAX_HISTORY = 50;
        var history = [];
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored) history = JSON.parse(stored);
        } catch (e) {
            history = [];
        }
        // 既存のエントリを探す
        var existingIndex = history.findIndex(function(item) {
            return item.novel_id === info.novel;
        });
        var entry = {
            novel_id: info.novel,
            novel_title: novelTitle || info.novel,
            last_episode: info.episode,
            last_accessed: new Date().toISOString()
        };
        if (existingIndex !== -1) {
            // 既存エントリを更新して先頭に移動
            history.splice(existingIndex, 1);
        }
        history.unshift(entry);
        // 最大件数を超えたら古いものを削除
        if (history.length > MAX_HISTORY) {
            history = history.slice(0, MAX_HISTORY);
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        } catch (e) {
            console.warn('Failed to save reading history:', e);
        }
    }

    // EPUBのメタデータから小説タイトルを取得
    function getNovelTitle() {
        try {
            // B.Package.Metadata から title を取得
            if (B && B.Package && B.Package.Metadata && B.Package.Metadata.title) {
                var title = B.Package.Metadata.title[0];
                if (title) return title;
            }
        } catch (e) {
            console.warn('Failed to get novel title:', e);
        }
        return null;
    }

    // 本の読み込み完了後の処理
    E.bind('bibi:opened', function() {
        // edge=foot が指定されている場合、末尾へ移動
        if (window.location.hash.indexOf('edge=foot') !== -1) {
            setTimeout(navigateToFoot, 100);
        }

        // 各アイテムの contentDocument にキーイベントとホイールイベントを登録
        if (R && R.Items) {
            R.Items.forEach(function(item) {
                if (item.contentDocument) {
                    item.contentDocument.addEventListener('keydown', handleKeyDown, true);
                    item.contentDocument.addEventListener('wheel', handleWheel, { passive: true });
                }
            });
        }

        // 境界ページでのクリックによるエピソード遷移
        // 各アイテム（iframe）のcontentDocumentにクリックイベントを追加
        if (getEpisodeInfo() && R && R.Items) {
            var handleEpisodeClick = function(e) {
                var mainRect = R.Main.getBoundingClientRect();
                var width = mainRect.width;
                var flipperWidth = width * 0.25;

                // iframe内でのクリック位置を親の座標系に変換
                var iframe = e.target.ownerDocument.defaultView.frameElement;
                var iframeRect = iframe ? iframe.getBoundingClientRect() : { left: 0 };
                var clickXInParent = iframeRect.left + e.clientX;

                // 左側クリック（縦書きでは次ページ方向）
                if (clickXInParent < flipperWidth && isLastSpread()) {
                    goToNextEpisode();
                }
                // 右側クリック（縦書きでは前ページ方向）
                else if (clickXInParent > width - flipperWidth && isFirstSpread()) {
                    goToPrevEpisode();
                }
            };

            R.Items.forEach(function(item) {
                if (item.contentDocument) {
                    item.contentDocument.addEventListener('click', handleEpisodeClick, true);
                }
            });
        }

        // 読書履歴を保存
        var episodeInfo = getEpisodeInfo();
        if (episodeInfo) {
            var novelTitle = getNovelTitle();
            saveReadingHistory(episodeInfo, novelTitle);
        }
    });
});
