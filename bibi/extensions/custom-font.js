/*!
 *  Custom Font Extension for Bibi
 *  Applies custom font-family to EPUB content and handles dark mode
 */
Bibi.x({
    id: "CustomFont",
    description: "Apply custom font-family to EPUB content.",
    author: "Custom",
    version: "1.1.0"
})(function() {
    var darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    var processedItems = [];

    // ダークモード用のCSS（画像を二重反転して元の色を維持）
    var darkModeCSS = ' img, svg, video, picture, canvas, svg image { filter: invert(1) hue-rotate(180deg) !important; }';

    function updateDarkModeStyles(isDark) {
        processedItems.forEach(function(item) {
            if (item.styleElement && item.contentDocument) {
                try {
                    var darkStyle = item.contentDocument.getElementById('custom-font-dark-mode');
                    if (isDark && !darkStyle) {
                        // ダークモード: スタイルを追加
                        darkStyle = item.contentDocument.createElement("style");
                        darkStyle.id = 'custom-font-dark-mode';
                        darkStyle.textContent = darkModeCSS;
                        var head = item.contentDocument.head || item.contentDocument.querySelector("head");
                        if (head) {
                            head.appendChild(darkStyle);
                        }
                    } else if (!isDark && darkStyle) {
                        // ライトモード: スタイルを削除
                        darkStyle.remove();
                    }
                } catch (e) {
                    // iframe がアクセス不能な場合は無視
                }
            }
        });
    }

    // テーマ変更を監視
    darkModeQuery.addEventListener('change', function(e) {
        updateDarkModeStyles(e.matches);
    });

    E.bind("bibi:postprocessed-item", function(Item) {
        if (Item && Item.contentDocument) {
            var style = Item.contentDocument.createElement("style");
            style.id = 'custom-font-base';
            var css = '* { font-family: "游明朝", "Yu Mincho", "ヒラギノ明朝 ProN", "Hiragino Mincho ProN", "MS 明朝", "MS Mincho", serif !important; }';
            style.textContent = css;
            var head = Item.contentDocument.head || Item.contentDocument.querySelector("head");
            if (head) {
                head.appendChild(style);
            }

            // アイテムを記録
            processedItems.push({
                item: Item,
                contentDocument: Item.contentDocument,
                styleElement: style
            });

            // 現在ダークモードなら画像反転スタイルを追加
            if (darkModeQuery.matches) {
                var darkStyle = Item.contentDocument.createElement("style");
                darkStyle.id = 'custom-font-dark-mode';
                darkStyle.textContent = darkModeCSS;
                head.appendChild(darkStyle);
            }
        }
    });
});
