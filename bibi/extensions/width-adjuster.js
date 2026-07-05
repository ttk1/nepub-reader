/*!
 *  Width Adjuster Extension for Bibi
 *  - 表示幅を制限して読みやすくする（全画面だと行を追いにくいため）
 *  - body に max-width を掛けて中央寄せし、Bibi のリサイズ処理で再レイアウトさせる
 *  - 選択した幅は Biscuits (localStorage) に保存され全ブックで共有される
 *
 *  Bibi グローバル変数:
 *  - O: Operator（Biscuits=localStorage 管理など）
 *  - E: Events（イベントバインディング、E['resize'] はデバイス毎のリサイズイベント名）
 */
Bibi.x({
    id: "WidthAdjuster",
    description: "Adjust the width of the reading area.",
    author: "Custom",
    version: "1.0.1"
})(function () {

    // 0 は制限なし（全幅）
    var WIDTH_OPTIONS = [
        { value: 0, label: '全幅' },
        { value: 1400, label: '1400px' },
        { value: 1200, label: '1200px' },
        { value: 1000, label: '1000px' },
        { value: 800, label: '800px' },
        { value: 600, label: '600px' }
    ];

    function loadSavedWidth() {
        if (!O.Biscuits) return 0;
        var saved = O.Biscuits.remember('Bibi');
        if (saved && typeof saved.StageWidth === 'number') {
            var isValid = WIDTH_OPTIONS.some(function (opt) {
                return opt.value === saved.StageWidth;
            });
            if (isValid) return saved.StageWidth;
        }
        return 0;
    }

    function applyWidth(width) {
        // body は left:0; right:0; width:100% の絶対配置なので、
        // max-width + margin auto で中央寄せされる
        if (width > 0) {
            document.body.style.maxWidth = width + 'px';
            document.body.style.marginLeft = 'auto';
            document.body.style.marginRight = 'auto';
        } else {
            document.body.style.maxWidth = '';
            document.body.style.marginLeft = '';
            document.body.style.marginRight = '';
        }
    }

    function saveWidth(width) {
        if (O.Biscuits) O.Biscuits.memorize('Bibi', { StageWidth: width });
    }

    function addWidthSelector(currentWidth) {
        var menuR = document.getElementById('bibi-menu-r');
        if (!menuR || document.getElementById('bibi-buttongroup-width')) return;

        var style = document.createElement('style');
        style.textContent = '\
            /* dress が li を 31px（アイコン幅）に固定しているため、\
               このグループだけ内容に合わせて広げる */\
            #bibi-buttongroup-width li.bibi-buttonbox { width: auto; }\
            #bibi-buttongroup-width select {\
                display: block; box-sizing: border-box;\
                height: 31px; margin: 0; padding: 0 4px;\
                font-size: 12px; color: #404040;\
                background: #fff; border: 1px solid #c0c0c1; border-radius: 3px;\
                cursor: pointer;\
            }';
        document.head.appendChild(style);

        var group = document.createElement('ul');
        group.id = 'bibi-buttongroup-width';
        group.className = 'bibi-buttongroup';
        var box = document.createElement('li');
        box.className = 'bibi-buttonbox';

        var select = document.createElement('select');
        select.title = '表示幅を変更';
        WIDTH_OPTIONS.forEach(function (opt) {
            var option = document.createElement('option');
            option.value = String(opt.value);
            option.textContent = '幅: ' + opt.label;
            if (opt.value === currentWidth) option.selected = true;
            select.appendChild(option);
        });
        select.addEventListener('change', function () {
            var width = parseInt(select.value, 10) || 0;
            applyWidth(width);
            saveWidth(width);
            // フォーカスが残ると矢印キーが select に取られページ送りできなくなる
            select.blur();
            // Bibi 自身のリサイズ処理に再レイアウトさせる（表示中のページは維持される）
            window.dispatchEvent(new Event(E['resize'] || 'resize'));
        });

        box.appendChild(select);
        group.appendChild(box);
        menuR.insertAdjacentElement('afterbegin', group);
    }

    // 起動時: 保存された幅を初回レイアウト前に適用しておく
    // （この関数本体は bibi:readied で実行され、ブックのレイアウトはその後に走る）
    var savedWidth = loadSavedWidth();
    applyWidth(savedWidth);
    addWidthSelector(savedWidth);
});
