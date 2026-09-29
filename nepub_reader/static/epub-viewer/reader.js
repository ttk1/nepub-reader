import { openBook } from './book.js';
import { EpubViewer, fonts, themes } from './viewer.js';
const DEFAULT_SETTINGS = {
    theme: 'system',
    font: 'mincho',
    fontSize: 45, // large enough to read comfortably at a distance
    maxWidth: 0,
    writingMode: 'auto',
};
const TOOLBAR = `
  <select class="toc" aria-label="目次" disabled><option>目次</option></select>
  <span class="title"></span>
  <span class="progress"></span>
  <button class="font-down" title="文字を小さく">A−</button>
  <button class="font-up" title="文字を大きく">A＋</button>
  <select data-setting="font" title="フォント">
    <option value="mincho">明朝</option>
    <option value="gothic">ゴシック</option>
    <option value="book">本の指定</option>
  </select>
  <select data-setting="maxWidth" title="表示幅">
    <option value="0">幅: 全幅</option>
    <option value="1400">幅: 1400px</option>
    <option value="1200">幅: 1200px</option>
    <option value="1000">幅: 1000px</option>
    <option value="800">幅: 800px</option>
    <option value="600">幅: 600px</option>
  </select>
  <select data-setting="writingMode" title="表示方向">
    <option value="auto">自動</option>
    <option value="vertical">縦書き</option>
    <option value="horizontal">横書き</option>
  </select>
  <select data-setting="theme" title="テーマ">
    <option value="system">システム</option>
    <option value="light">ライト</option>
    <option value="dark">ダーク</option>
  </select>`;
// Scoped to .epub-reader so that it can live inside another app's page.
const STYLE = `
  .epub-reader {
    --bg: #f3f3f3; --fg: #1a1a1a; --border: #d0d0d0;
    color-scheme: light;
    display: flex; flex-direction: column; height: 100%;
    background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif;
  }
  .epub-reader[data-theme='dark'] { --bg: #161616; --fg: #acacac; --border: #333; color-scheme: dark; }
  .epub-reader .toolbar {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    padding: 6px 12px; border-bottom: 1px solid var(--border); font-size: 14px;
  }
  .epub-reader .toolbar :is(button, select, a, label) {
    box-sizing: border-box; padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px;
    background: transparent; color: inherit; font: inherit; text-decoration: none; cursor: pointer;
  }
  .epub-reader .toc { max-width: 14em; }
  .epub-reader .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: bold; }
  .epub-reader .viewer { flex: 1; min-height: 0; }`;
/**
 * A ready-made reader UI: toolbar (table of contents, progress, font size, font, width, writing
 * mode, theme) + EpubViewer, with settings and reading positions saved in localStorage.
 * Add your own controls to `toolbar`, and use `viewer` for events and navigation.
 */
export class EpubReader {
    /** The toolbar element; add your own buttons or links to it. */
    toolbar;
    viewer;
    book;
    #root;
    #storageKey;
    #systemDark = matchMedia('(prefers-color-scheme: dark)');
    #settings;
    #positionKey = '';
    /** `root` must have a height; the reader fills it. */
    constructor(root, { storageKey = 'epub-viewer', settings = {}, viewer = {} } = {}) {
        const doc = root.ownerDocument;
        if (!doc.getElementById('epub-reader-style')) {
            doc.head.append(Object.assign(doc.createElement('style'), { id: 'epub-reader-style', textContent: STYLE }));
        }
        root.classList.add('epub-reader');
        root.innerHTML = `<header class="toolbar">${TOOLBAR}</header><div class="viewer"></div>`;
        this.#root = root;
        this.#storageKey = storageKey;
        this.toolbar = root.querySelector('.toolbar');
        this.viewer = new EpubViewer(root.querySelector('.viewer'), viewer);
        this.#settings = { ...DEFAULT_SETTINGS, ...settings, ...this.#load('settings') };
        this.viewer.addEventListener('relocate', (e) => {
            const { page, pages, fraction } = e.detail;
            this.#part('progress').textContent = `${page + 1} / ${pages}（${Math.round(fraction * 100)}%）`;
            this.#save(`position:${this.#positionKey}`, this.viewer.location);
        });
        this.toolbar.addEventListener('click', this.#onToolbarClick);
        this.toolbar.addEventListener('change', this.#onToolbarChange);
        this.#systemDark.addEventListener('change', this.#apply); // follow the OS while theme is "system"
        this.#apply();
    }
    get settings() {
        return this.#settings;
    }
    /** Opens a book at `options.location`, the saved position, or the beginning. */
    async open(source, { key, location } = {}) {
        const book = await openBook(source);
        this.book?.destroy();
        this.book = book;
        this.#positionKey =
            key ??
                (book.metadata.identifier ||
                    (typeof source === 'string' || source instanceof URL ? String(source) : source instanceof File ? source.name : book.metadata.title));
        this.#part('title').textContent = book.metadata.title;
        this.#renderToc(book.toc);
        await this.viewer.open(book, location ?? this.#load(`position:${this.#positionKey}`));
        return book;
    }
    /** Removes the reader from `root` and releases the book. */
    destroy() {
        this.#systemDark.removeEventListener('change', this.#apply);
        this.viewer.destroy();
        this.book?.destroy();
        this.#root.replaceChildren();
        this.#root.classList.remove('epub-reader');
    }
    #part(name) {
        return this.#root.querySelector(`.${name}`);
    }
    #apply = () => {
        const settings = this.#settings;
        this.#save('settings', settings);
        const theme = settings.theme === 'system' ? (this.#systemDark.matches ? 'dark' : 'light') : settings.theme;
        this.#root.dataset.theme = theme;
        for (const select of this.toolbar.querySelectorAll('select[data-setting]')) {
            select.value = String(settings[select.dataset.setting]);
        }
        this.viewer.setOptions({
            theme: themes[theme],
            fontFamily: settings.font === 'book' ? '' : fonts[settings.font],
            fontSize: settings.fontSize,
            maxWidth: settings.maxWidth,
            writingMode: settings.writingMode,
        });
    };
    #onToolbarClick = (e) => {
        const button = e.target.closest('button');
        if (!button)
            return;
        if (button.matches('.font-up, .font-down')) {
            const ratio = button.matches('.font-up') ? 1.2 : 1 / 1.2; // equal-looking steps at any size
            const fontSize = Math.min(120, Math.max(12, Math.round(this.#settings.fontSize * ratio)));
            this.#settings = { ...this.#settings, fontSize };
            this.#apply();
        }
        button.blur(); // so that Space turns pages instead of pressing the button again
    };
    #onToolbarChange = (e) => {
        const select = e.target;
        if (!(select instanceof HTMLSelectElement))
            return; // e.g. controls added by the embedding app
        const key = select.dataset.setting;
        if (key) {
            const value = typeof DEFAULT_SETTINGS[key] === 'number' ? Number(select.value) : select.value;
            this.#settings = { ...this.#settings, [key]: value };
            this.#apply();
        }
        else if (select.classList.contains('toc') && select.value) {
            void this.viewer.goTo(select.value);
            select.value = '';
        }
        select.blur(); // give arrow keys back to page turning
    };
    #renderToc(items) {
        const options = [new Option('目次', '')];
        const add = (items, depth) => {
            for (const item of items) {
                options.push(new Option('　'.repeat(depth) + item.label, item.href));
                add(item.children, depth + 1);
            }
        };
        add(items, 0);
        const select = this.#part('toc');
        select.replaceChildren(...options);
        select.disabled = items.length === 0;
    }
    // localStorage may be unavailable (private mode etc.); the reader still works without it.
    #load(name) {
        if (!this.#storageKey)
            return undefined;
        try {
            return JSON.parse(localStorage.getItem(`${this.#storageKey}:${name}`) ?? 'null') ?? undefined;
        }
        catch {
            return undefined;
        }
    }
    #save(name, value) {
        if (!this.#storageKey)
            return;
        try {
            localStorage.setItem(`${this.#storageKey}:${name}`, JSON.stringify(value));
        }
        catch { }
    }
}
//# sourceMappingURL=reader.js.map