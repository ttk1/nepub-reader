/*!
 *  Episode Navigation Extension for Bibi
 *  - Supports both Narou and Kakuyomu novels
 *  - Automatically navigates to the next/previous episode at book boundaries
 *  - For Kakuyomu, reads prev/next episode IDs from URL query parameters
 *  - Persists font size settings across episodes using Bibi's Biscuits
 *
 *  Bibi グローバル変数:
 *  - R: Reader（現在の表示状態、ページ情報など）
 *  - B: Book（EPUBのメタデータ、パッケージ情報など）
 *  - E: Events（イベントバインディング）
 *  - O: Options（設定、Biscuits=クッキー管理など）
 *  - I: Interactions（UIコンポーネント、FontSizeChangerなど）
 */
Bibi.x({
    id: "EpisodeNavigation",
    description: "Navigate between episodes of Narou/Kakuyomu novels.",
    author: "Custom",
    version: "2.0.0"
})(function () {

    // ページめくりのデバウンス用（リモコンのチャタリング対策）
    var lastKeyTime = 0;
    var KEY_DEBOUNCE_MS = 100; // 100ms以内の連続キー入力を無視

    function debounceKeyHandler(e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            var now = Date.now();
            if (now - lastKeyTime < KEY_DEBOUNCE_MS) {
                e.stopImmediatePropagation();
                e.preventDefault();
                return;
            }
            lastKeyTime = now;
        }
    }

    // メインドキュメントにデバウンスハンドラを登録（キャプチャフェーズで先に処理）
    document.addEventListener('keydown', debounceKeyHandler, true);

    // URL パラメータの book からサイト種別・小説ID・エピソードIDを取得
    // book=narou/{novel_id}_{episode}.epub または book=kakuyomu/{work_id}_{episode_id}.epub
    function getEpisodeInfo() {
        var params = new URLSearchParams(window.location.search);
        var book = params.get('book');
        if (!book) return null;

        var parts = book.split('/');
        if (parts.length !== 2) return null;

        var site = parts[0];
        var filename = parts[1];

        var match;
        if (site === 'narou') {
            match = filename.match(/^(.+)_(\d+)\.epub$/);
            if (!match) return null;
            return { site: 'narou', novel: match[1], episode: parseInt(match[2], 10) };
        } else if (site === 'kakuyomu') {
            match = filename.match(/^(\d+)_(\d+)\.epub$/);
            if (!match) return null;
            return { site: 'kakuyomu', novel: match[1], episode: match[2] };
        }
        return null;
    }

    // なろう: 指定方向のエピソードURLを生成
    function getNarouEpisodeUrl(info, direction) {
        var newEpisode = info.episode + direction;
        if (newEpisode < 1) return null;
        return '/read/narou/' + info.novel + '/' + newEpisode;
    }

    // カクヨム: 前後のエピソードIDをURLクエリパラメータから取得
    // サーバー側でリダイレクト時に ?book=...&prev=...&next=... として渡される
    var _kakuyomuNav = (function () {
        var params = new URLSearchParams(window.location.search);
        var book = params.get('book');
        if (!book || book.indexOf('kakuyomu/') !== 0) return null;
        return { prev: params.get('prev') || null, next: params.get('next') || null };
    })();

    function getKakuyomuEpisodeUrl(info, direction) {
        if (!_kakuyomuNav) return null;
        var targetId = direction > 0 ? _kakuyomuNav.next : _kakuyomuNav.prev;
        if (!targetId) return null;
        return '/read/kakuyomu/' + info.novel + '/' + targetId;
    }

    // 統合: エピソードURLを取得
    function getEpisodeUrl(direction) {
        var info = getEpisodeInfo();
        if (!info) return null;
        if (info.site === 'narou') {
            return getNarouEpisodeUrl(info, direction);
        } else if (info.site === 'kakuyomu') {
            return getKakuyomuEpisodeUrl(info, direction);
        }
        return null;
    }

    // カクヨム: 最新話チェック（sessionStorage でキャッシュ）
    var _checkingNextEpisode = false;

    function checkKakuyomuNextEpisode(info, callback) {
        var cacheKey = 'kakuyomu_no_next_' + info.novel + '_' + info.episode;

        // sessionStorage にキャッシュがあれば問い合わせをスキップ
        try {
            if (sessionStorage.getItem(cacheKey)) {
                callback(null);
                return;
            }
        } catch (e) {
            // ignore
        }

        if (_checkingNextEpisode) return;
        _checkingNextEpisode = true;

        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/kakuyomu/next-episode/' + info.novel + '/' + info.episode);
        xhr.onload = function () {
            _checkingNextEpisode = false;
            try {
                var data = JSON.parse(xhr.responseText);
                if (data.next_episode_id) {
                    // 次話が見つかった → ナビゲーション情報を更新
                    _kakuyomuNav.next = data.next_episode_id;
                    callback(data.next_episode_id);
                } else {
                    // 次話なし → sessionStorage にキャッシュ
                    try {
                        sessionStorage.setItem(cacheKey, '1');
                    } catch (e) {
                        // ignore
                    }
                    callback(null);
                }
            } catch (e) {
                callback(null);
            }
        };
        xhr.onerror = function () {
            _checkingNextEpisode = false;
            callback(null);
        };
        xhr.send();
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
        var info = getEpisodeInfo();
        if (!info) return;

        var url = getEpisodeUrl(1);
        if (url) {
            window.location.href = url;
            return;
        }

        // カクヨムで next が null の場合、APIで最新話チェック
        if (info.site === 'kakuyomu' && _kakuyomuNav && !_kakuyomuNav.next) {
            checkKakuyomuNextEpisode(info, function (nextId) {
                if (nextId) {
                    window.location.href = '/read/kakuyomu/' + info.novel + '/' + nextId;
                }
            });
        }
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

    // ホイールイベントハンドラ
    function handleWheel(e) {
        if (!getEpisodeInfo()) return;

        var delta = e.deltaX || e.deltaY;

        // 最初のページで上スクロール → 前のエピソードへ
        if (isFirstSpread() && delta < 0) {
            goToPrevEpisode();
        }
        // 最後のページで下スクロール → 次のエピソードへ
        else if (isLastSpread() && delta > 0) {
            goToNextEpisode();
        }
    }

    // メインドキュメントにキーイベントを登録
    document.addEventListener('keydown', handleKeyDown, true);

    // メインドキュメントにホイールイベントを登録
    document.addEventListener('wheel', handleWheel, { passive: true });

    // 文字サイズ変更時に Biscuits に保存（リロード時も設定が維持される）
    E.bind('bibi:changed-font-size', function () {
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
        // 履歴キー: サイト + 小説ID
        var historyKey = (info.site || 'narou') + ':' + info.novel;
        var existingIndex = history.findIndex(function (item) {
            // 後方互換: site がない場合は narou として扱う
            var itemKey = (item.site || 'narou') + ':' + item.novel_id;
            return itemKey === historyKey;
        });
        var entry = {
            site: info.site || 'narou',
            novel_id: info.novel,
            novel_title: novelTitle || info.novel,
            last_episode: info.episode,
            last_accessed: new Date().toISOString()
        };
        if (existingIndex !== -1) {
            history.splice(existingIndex, 1);
        }
        history.unshift(entry);
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
    E.bind('bibi:opened', function () {
        var info = getEpisodeInfo();

        // edge=foot が指定されている場合、末尾へ移動
        if (window.location.hash.indexOf('edge=foot') !== -1) {
            setTimeout(navigateToFoot, 100);
        }

        // 各アイテムの contentDocument にイベントとスタイルを設定
        if (R && R.Items) {
            R.Items.forEach(function (item) {
                if (item.contentDocument) {
                    // デバウンスハンドラを先に登録（チャタリング対策）
                    item.contentDocument.addEventListener('keydown', debounceKeyHandler, true);
                    item.contentDocument.addEventListener('keydown', handleKeyDown, true);
                    item.contentDocument.addEventListener('wheel', handleWheel, { passive: true });
                    // ルビが右端で見切れないよう余白を確保
                    item.contentDocument.documentElement.style.paddingRight = '0.25em';
                }
            });
        }

        // 境界ページでのクリックによるエピソード遷移
        if (info && R && R.Items) {
            var handleEpisodeClick = function (e) {
                var mainRect = R.Main.getBoundingClientRect();
                var width = mainRect.width;
                var flipperWidth = width * 0.25;

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

            R.Items.forEach(function (item) {
                if (item.contentDocument) {
                    item.contentDocument.addEventListener('click', handleEpisodeClick, true);
                }
            });
        }

        // 読書履歴を保存
        if (info) {
            var novelTitle = getNovelTitle();
            saveReadingHistory(info, novelTitle);
        }

        // メニューバーにトップページへ戻るボタンを追加
        addHomeButton();
    });

    // トップページへ戻るボタンを追加
    function addHomeButton() {
        var menuL = document.getElementById('bibi-menu-l');
        if (!menuL || document.getElementById('bibi-buttongroup-home')) return;

        var style = document.createElement('style');
        style.textContent = '\
            #bibi-buttongroup-home .bibi-icon-home { display: flex; align-items: center; justify-content: center; padding: 4px; height: 31px; box-sizing: border-box; }\
            #bibi-buttongroup-home .bibi-icon-home svg { display: block; }\
            #bibi-buttongroup-home .bibi-button:hover .bibi-icon-home, \
            #bibi-buttongroup-home .bibi-button.hover .bibi-icon-home { border-color: #c0c0c1; background-color: #f7f8fa; }\
            #bibi-buttongroup-home .bibi-button:hover .bibi-icon-home svg path, \
            #bibi-buttongroup-home .bibi-button.hover .bibi-icon-home svg path { fill: #404040; }';
        document.head.appendChild(style);

        var html = '<ul id="bibi-buttongroup-home" class="bibi-buttongroup"><li class="bibi-buttonbox">' +
            '<a href="/" class="bibi-button bibi-button-home" title="トップページへ戻る"><span class="bibi-button-iconbox"><span class="bibi-icon bibi-icon-home">' +
            '<svg viewBox="0 0 24 24" width="23" height="23"><path fill="#909091" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>' +
            '</span></span></a></li></ul>';
        menuL.insertAdjacentHTML('afterbegin', html);
    }
});
