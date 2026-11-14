import { openBook } from './book.js';
import { fonts, themes } from './options.js';
import { EpubViewer } from './viewer.js';
const DEFAULT_SETTINGS = {
    theme: 'system',
    font: 'mincho',
    fontSize: 45,
    lineHeight: 0,
    maxWidth: 0,
    margin: 32,
    writingMode: 'auto',
    spread: 'auto',
    direction: 'auto',
};
const DEFAULT_CHOICES = {
    lineHeight: [[0, '本の指定'], [1.3, '狭い'], [1.6, '標準'], [1.9, '広い'], [2.2, 'とても広い']],
    maxWidth: [[0, '全幅'], [1400, '1400'], [1200, '1200'], [1000, '1000'], [800, '800'], [600, '600']],
    margin: [[16, '狭い'], [32, '標準'], [64, '広い'], [96, 'とても広い']],
};
const DEFAULT_FONT_SIZE_STEPS = { min: 12, max: 120, step: 1.2 };
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const SEEK_KEYS = {
    ArrowLeft: 'goLeft',
    ArrowRight: 'goRight',
    ArrowUp: 'prev',
    ArrowDown: 'next',
    PageUp: 'prev',
    PageDown: 'next',
};
const choices = (name, label, options) => !options.length ? '' : `
  <div class="row">
    <span>${label}</span>
    <span class="choices" role="radiogroup" aria-label="${label}">
      ${options.map(([value, text, style = '']) => `<label><input type="radio" name="${name}" value="${escapeHtml(value)}"><span style="${style}">${escapeHtml(text)}</span></label>`).join('')}
    </span>
  </div>`;
const swatch = ({ background, color }) => `background:${background};color:${color}`;
const toolbar = (offered) => `
  <details class="toc" hidden>
    <summary>目次</summary>
    <div class="panel toc-list"></div>
  </details>
  <span class="title"></span>
  <span class="progress"><span class="pages"></span><span class="percent"></span></span>
  <input type="range" class="seek" min="0" max="1" step="any" value="0" title="本の中の位置" aria-label="本の中の位置" hidden>
  <details class="settings">
    <summary title="表示設定" aria-label="表示設定">Aa</summary>
    <form class="panel">
      <div class="only-reflowable">
        <div class="row">
          <span>文字サイズ</span>
          <span class="choices">
            <button type="button" class="font-down" title="文字を小さく" aria-label="文字を小さく">A−</button>
            <output class="font-size"></output>
            <button type="button" class="font-up" title="文字を大きく" aria-label="文字を大きく">A＋</button>
          </span>
        </div>
        ${choices('font', 'フォント', [['mincho', '明朝'], ['gothic', 'ゴシック'], ['book', '本の指定']])}
        ${choices('lineHeight', '行間', offered.lineHeight)}
        ${choices('maxWidth', '表示幅', offered.maxWidth)}
        ${choices('margin', '余白', offered.margin)}
        ${choices('writingMode', '表示方向', [['auto', '自動'], ['vertical', '縦書き'], ['horizontal', '横書き']])}
      </div>
      <div class="not-vertical">
        ${choices('spread', '見開き', [['auto', '自動'], ['always', 'する'], ['never', 'しない']])}
      </div>
      <div class="only-pre-paginated">
        ${choices('direction', '開き方向', [['auto', '本の指定'], ['rtl', '右開き'], ['ltr', '左開き']])}
      </div>
      ${choices('theme', 'テーマ', [
    ['system', '自動'],
    ['light', 'ライト', swatch(themes.light)],
    ['sepia', 'セピア', swatch(themes.sepia)],
    ['dark', 'ダーク', swatch(themes.dark)],
])}
    </form>
  </details>`;
const STYLE = `
  .epub-reader {
    --line: rgb(128 128 128 / 0.35);
    --hover: rgb(128 128 128 / 0.16);
    container-type: size; /* for the container query and the cqh unit below */
    display: flex; flex-direction: column; height: 100%;
    background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif;
  }
  .epub-reader .toolbar {
    position: relative; z-index: 1; display: flex; gap: 4px; align-items: center;
    padding: 6px 10px; border-bottom: 1px solid var(--line);
  }
  .epub-reader .toolbar[hidden] { display: none; } /* the app may hide it, e.g. on a tap */
  /* Progress through the book, drawn over the border: a slider, to go to another place in it.
     The line is filled up to the place (from the right, where the pages go to the left).
     Only its thumb takes the pointer. A touch is given to a control near it: with the whole line
     taking it, a swipe that began at the top of the page moved the slider, and the place was lost. */
  .epub-reader .seek {
    --fill: linear-gradient(to right, var(--fg) calc(var(--progress, 0) * 100%), transparent 0);
    --thumb: 28px; /* a dot of 12px, with room around it for a finger */
    position: absolute; left: 0; bottom: calc(var(--thumb) / -2); box-sizing: border-box;
    width: 100%; height: var(--thumb); margin: 0; padding: 0;
    -webkit-appearance: none; appearance: none; background: none; pointer-events: none;
  }
  .epub-reader .seek[dir='rtl'] { --fill: linear-gradient(to left, var(--fg) calc(var(--progress, 0) * 100%), transparent 0); }
  .epub-reader .seek::-webkit-slider-runnable-track { height: 2px; background: var(--fill); }
  .epub-reader .seek::-moz-range-track { height: 2px; background: var(--fill); }
  .epub-reader .seek::-webkit-slider-thumb {
    -webkit-appearance: none; box-sizing: border-box; width: var(--thumb); height: var(--thumb); margin-top: calc(1px - var(--thumb) / 2);
    border: 8px solid transparent; border-radius: 50%; background: var(--fg) padding-box; cursor: pointer; pointer-events: auto;
  }
  .epub-reader .seek::-moz-range-thumb {
    box-sizing: border-box; width: var(--thumb); height: var(--thumb);
    border: 8px solid transparent; border-radius: 50%; background: var(--fg) padding-box; cursor: pointer; pointer-events: auto;
  }
  /* The focus is shown on the thumb: the box of the slider is as wide as the toolbar. */
  .epub-reader .toolbar .seek:focus-visible { outline: none; }
  .epub-reader .seek:focus-visible::-webkit-slider-thumb { border-color: var(--hover); }
  .epub-reader .seek:focus-visible::-moz-range-thumb { border-color: var(--hover); }
  .epub-reader :is(.toolbar > :is(button, select, a, label), summary, .panel button) {
    box-sizing: border-box; padding: 6px 10px; border: 0; border-radius: 8px;
    background: none; color: inherit; font: inherit; text-decoration: none; white-space: nowrap; cursor: pointer;
    transition: background-color 0.15s;
  }
  .epub-reader :is(.toolbar > :is(button, select, a, label), summary, .panel button):hover,
  .epub-reader .choices label:hover > span,
  .epub-reader details[open] > summary { background: var(--hover); }
  .epub-reader .toolbar :focus-visible,
  .epub-reader .choices :focus-visible + span { outline: 2px solid var(--fg); outline-offset: -2px; }
  .epub-reader summary { list-style: none; user-select: none; }
  .epub-reader summary::-webkit-details-marker { display: none; }
  /* Text in the toolbar: the title, the progress, and what the app adds (e.g. a status). */
  .epub-reader .toolbar > span { padding: 0 8px; white-space: nowrap; }
  .epub-reader .toolbar > span:empty { padding: 0; }
  .epub-reader .title {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
    text-align: center; font-weight: 600; letter-spacing: 0.02em;
  }
  .epub-reader .progress { opacity: 0.7; font-variant-numeric: tabular-nums; }
  /* On a narrow screen the room goes to the title; the bar under the toolbar shows the same. */
  @container (max-width: 480px) { .epub-reader .percent { display: none; } }
  .epub-reader .panel {
    position: absolute; top: calc(100% + 6px); z-index: 1; /* over the thumb of the slider, which reaches as far down */
    box-sizing: border-box; width: min(26em, 100% - 16px); max-height: 70vh; max-height: calc(100cqh - 100% - 14px); overflow: auto;
    padding: 6px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--bg); box-shadow: 0 2px 6px rgb(0 0 0 / 0.12), 0 12px 32px rgb(0 0 0 / 0.18);
  }
  /* A menu comes in with a small move, unless the reader has asked for less motion. */
  @keyframes epub-reader-menu { from { opacity: 0; transform: translateY(-4px); } }
  .epub-reader details[open] > .panel { animation: epub-reader-menu 0.12s ease-out; }
  @media (prefers-reduced-motion: reduce) { .epub-reader details[open] > .panel { animation: none; } }
  .epub-reader .toc .panel { left: 8px; }
  .epub-reader .settings .panel { right: 8px; display: grid; gap: 14px; width: min(34em, 100% - 16px); padding: 16px; }
  .epub-reader .toc-list button {
    display: block; width: 100%; padding-left: calc(10px + var(--depth) * 1em); text-align: start; white-space: normal;
  }
  .epub-reader .toc-list button:disabled { opacity: 0.6; cursor: default; background: none; } /* a heading that leads nowhere */
  /* The chapter being read: marked by a bar at its side as well. */
  .epub-reader .toc-list [aria-current] { background: var(--hover); font-weight: 600; box-shadow: inset 3px 0 var(--fg); }
  /* The groups of rows for one kind of book do not make a box of their own. */
  .epub-reader :is(.only-reflowable, .only-pre-paginated, .not-vertical) { display: contents; }
  .epub-reader[data-layout='pre-paginated'] .only-reflowable,
  .epub-reader[data-layout='reflowable'] .only-pre-paginated,
  .epub-reader[data-writing='vertical'] .not-vertical { display: none; }
  .epub-reader .row { display: grid; grid-template-columns: 5.5em 1fr; align-items: center; }
  .epub-reader .row > :first-child { opacity: 0.7; }
  .epub-reader .choices { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .epub-reader .choices label { position: relative; display: flex; }
  .epub-reader .choices :is(label > span, button) {
    padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px;
    transition: background-color 0.15s, border-color 0.15s, color 0.15s;
  }
  /* The choice made: in the colors of the page, the other way round. */
  .epub-reader .choices input:checked + span { border-color: var(--fg); background-color: var(--fg); color: var(--bg); }
  /* A theme is shown in its own colors, so the one chosen has a ring around it instead. */
  .epub-reader .choices input:checked + span[style*='background'] { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--fg); }
  /* The radio button itself is invisible and covers its label. */
  .epub-reader .choices input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
  .epub-reader .font-size { min-width: 2.5em; text-align: center; font-variant-numeric: tabular-nums; }
  .epub-reader .viewer { position: relative; flex: 1; min-height: 0; }
  /* While a menu is open, a cover over the page takes the click that closes it: clicks on the page
     itself stay inside its iframe, and would also turn the page. */
  .epub-reader.menu-open .viewer::after { content: ''; position: absolute; inset: 0; }`;
export class EpubReader {
    toolbar;
    viewer;
    #book;
    #root;
    #storage;
    #storageKey;
    #fontSizeSteps;
    #systemDark = matchMedia('(prefers-color-scheme: dark)');
    #settings;
    #positionKey = '';
    #opening;
    #page;
    #shown;
    #marked = -1;
    #menuObserver = new MutationObserver(() => {
        this.#root.classList.toggle('menu-open', !!this.toolbar.querySelector('details[open]'));
    });
    constructor(root, { storage = defaultStorage(), storageKey = 'epub-viewer', settings = {}, viewer = {}, choices: offered = {}, fontSizeSteps = {} } = {}) {
        const doc = root.ownerDocument;
        if (!doc.getElementById('epub-reader-style')) {
            doc.head.append(Object.assign(doc.createElement('style'), { id: 'epub-reader-style', textContent: STYLE }));
        }
        root.classList.add('epub-reader');
        root.innerHTML = `<header class="toolbar">${toolbar({ ...DEFAULT_CHOICES, ...offered })}</header><div class="viewer"></div>`;
        this.#root = root;
        this.#storage = storage;
        this.#storageKey = storageKey;
        this.#fontSizeSteps = { ...DEFAULT_FONT_SIZE_STEPS, ...fontSizeSteps };
        this.toolbar = root.querySelector('.toolbar');
        this.viewer = new EpubViewer(root.querySelector('.viewer'), viewer);
        const usable = ([key, value]) => Object.hasOwn(DEFAULT_SETTINGS, key) && typeof value === typeof DEFAULT_SETTINGS[key] && value === value;
        const saved = Object.fromEntries(Object.entries(this.#load('settings') ?? {}).filter(usable));
        this.#settings = { ...DEFAULT_SETTINGS, ...settings, ...saved };
        this.viewer.addEventListener('relocate', (e) => {
            const { index, page, pages, fraction, rtl } = e.detail;
            const book = this.#book;
            const fixed = book.metadata.layout === 'pre-paginated';
            this.#shown = [fraction, fixed ? `${index + 1} / ${book.sections.length}` : `${page + 1} / ${pages}`];
            this.#showProgress(...this.#shown);
            Object.assign(this.#part('seek'), { value: String(fraction), dir: rtl ? 'rtl' : 'ltr', hidden: false });
            this.#markCurrent(index);
            this.#save(`position:${this.#positionKey}`, this.viewer.location);
            const vertical = !fixed && this.#page?.defaultView?.getComputedStyle(this.#page.documentElement).writingMode.startsWith('vertical');
            root.dataset.writing = vertical ? 'vertical' : 'horizontal';
        });
        this.viewer.addEventListener('sectionload', (e) => (this.#page = e.detail.doc));
        this.toolbar.addEventListener('click', this.#onClick);
        this.toolbar.addEventListener('change', this.#onChange);
        this.toolbar.addEventListener('input', this.#onInput);
        doc.addEventListener('keydown', this.#onKeydown);
        this.toolbar.addEventListener('toggle', this.#onToggle, true);
        this.toolbar.addEventListener('submit', (e) => e.preventDefault());
        doc.addEventListener('click', this.#dismiss);
        this.#menuObserver.observe(this.toolbar, { attributeFilter: ['open'], subtree: true });
        this.#systemDark.addEventListener('change', this.#apply);
        this.#apply();
    }
    get book() {
        return this.#book;
    }
    get settings() {
        return this.#settings;
    }
    setSettings(changes) {
        this.#settings = { ...this.#settings, ...changes };
        this.#save('settings', { ...this.#load('settings'), ...changes });
        this.#apply();
    }
    open(source, options = {}) {
        const opening = this.#open(source, options, () => opening === this.#opening);
        return (this.#opening = opening);
    }
    async #open(source, { key, location }, isLatest) {
        const book = await openBook(source);
        if (!isLatest()) {
            book.destroy();
            return this.#opening ?? book;
        }
        const before = { book: this.#book, key: this.#positionKey };
        this.#book = book;
        const name = typeof source === 'string' || source instanceof URL ? String(source) : source.name;
        this.#positionKey = key ?? (book.metadata.identifier || name || book.metadata.title).slice(0, 200);
        const saved = this.#load(`position:${this.#positionKey}`);
        try {
            await this.viewer.open(book, location ?? (typeof saved?.index === 'number' && typeof saved.progress === 'number' ? saved : undefined));
        }
        catch (error) {
            book.destroy();
            if (this.#book === book)
                [this.#book, this.#positionKey] = [before.book, before.key];
            throw error;
        }
        before.book?.destroy();
        if (!isLatest())
            return this.#opening ?? book;
        this.#part('title').textContent = book.metadata.title;
        this.#root.dataset.layout = book.metadata.layout;
        this.#renderToc(book);
        if (this.viewer.location)
            this.#markCurrent(this.viewer.location.index);
        return book;
    }
    destroy() {
        this.#root.ownerDocument.removeEventListener('click', this.#dismiss);
        this.#root.ownerDocument.removeEventListener('keydown', this.#onKeydown);
        this.#systemDark.removeEventListener('change', this.#apply);
        this.#menuObserver.disconnect();
        this.#opening = undefined;
        this.viewer.destroy();
        this.#book?.destroy();
        this.#root.replaceChildren();
        this.#root.classList.remove('epub-reader', 'menu-open');
        for (const property of ['--bg', '--fg', '--progress', 'color-scheme'])
            this.#root.style.removeProperty(property);
        delete this.#root.dataset.layout;
        delete this.#root.dataset.writing;
    }
    #part(name) {
        return this.#root.querySelector(`.${name}`);
    }
    #apply = () => {
        const settings = this.#settings;
        const name = settings.theme === 'system' ? (this.#systemDark.matches ? 'dark' : 'light') : settings.theme;
        const theme = Object.hasOwn(themes, name) ? themes[name] : themes.light;
        const { style } = this.#root;
        style.setProperty('--bg', theme.background);
        style.setProperty('--fg', theme.color);
        style.colorScheme = name === 'dark' ? 'dark' : 'light';
        for (const input of this.toolbar.querySelectorAll('.settings input')) {
            input.checked = input.value === String(settings[input.name]);
        }
        this.#part('font-size').textContent = String(settings.fontSize);
        this.viewer.setOptions({
            theme,
            fontFamily: settings.font === 'book' ? '' : fonts[settings.font],
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight,
            maxWidth: settings.maxWidth,
            margin: settings.margin,
            writingMode: settings.writingMode,
            spread: settings.spread,
            direction: settings.direction,
        });
    };
    #onClick = (e) => {
        const control = e.target.closest('button, summary, .settings input, .seek');
        if (control?.matches('.font-up, .font-down')) {
            const { min, max, step } = this.#fontSizeSteps;
            const size = this.#settings.fontSize;
            const next = control.matches('.font-up') ? Math.max(size + 1, Math.round(size * step)) : Math.min(size - 1, Math.round(size / step));
            this.setSettings({ fontSize: Math.min(max, Math.max(min, next)) });
        }
        else if (control?.matches('.toc-list button')) {
            this.#closeMenus();
            this.#goTo(control.value);
        }
        else if (control?.matches('.seek') && this.#shown && Number(control.value) === this.#shown[0]) {
            this.#showProgress(...this.#shown);
        }
        if (e.detail)
            control?.blur();
    };
    #showProgress(fraction, pages) {
        const percent = `${Math.round(fraction * 100)}%`;
        this.#part('pages').textContent = pages ?? percent;
        this.#part('percent').textContent = pages ? `（${percent}）` : '';
        this.#root.style.setProperty('--progress', String(fraction));
    }
    #onInput = (e) => {
        const book = this.#book;
        if (e.target !== this.#part('seek') || !book)
            return;
        const fraction = Number(e.target.value);
        const count = book.sections.length;
        this.#showProgress(fraction, book.metadata.layout === 'pre-paginated' ? `${Math.max(1, Math.ceil(fraction * count - 1e-6))} / ${count}` : undefined);
    };
    #goTo(target) {
        this.viewer.goTo(target).catch(this.#report);
    }
    #report = (error) => {
        this.viewer.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    };
    #onChange = (e) => {
        const input = e.target;
        if (input === this.#part('seek'))
            return this.#goTo({ fraction: Number(input.value) });
        if (!(input instanceof HTMLInputElement) || !input.closest('.settings'))
            return;
        const key = input.name;
        this.setSettings({ [key]: typeof DEFAULT_SETTINGS[key] === 'number' ? Number(input.value) : input.value });
    };
    #onKeydown = (e) => {
        const turn = e.target === this.#part('seek') && !(e.altKey || e.ctrlKey || e.metaKey) && Object.hasOwn(SEEK_KEYS, e.key) && SEEK_KEYS[e.key];
        if (turn) {
            e.preventDefault();
            this.viewer[turn]().catch(this.#report);
            return;
        }
        const menu = this.toolbar.querySelector('details[open]');
        if (!menu)
            return;
        const target = e.target;
        if (e.key === 'Escape') {
            e.preventDefault();
            this.#closeMenus();
            menu.querySelector('summary').focus();
        }
        else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && target.matches('.toc-list button')) {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling';
            let entry = target[step];
            while (entry?.disabled)
                entry = entry[step];
            entry?.focus();
        }
        else if (/^(Arrow|Page)/.test(e.key) ? !target.matches('input') : e.key === ' ' && !target.closest('button, summary, input')) {
            e.preventDefault();
        }
    };
    #onToggle = (e) => {
        const menu = e.target;
        if (!menu.open)
            return;
        this.#closeMenus(menu);
        const current = menu.querySelector('[aria-current]');
        if (!current)
            return;
        const list = current.parentElement;
        list.scrollTop = current.offsetTop - (list.clientHeight - current.offsetHeight) / 2;
        if (menu.contains(menu.ownerDocument.activeElement))
            current.focus({ preventScroll: true });
    };
    #dismiss = (e) => {
        this.#closeMenus(e.target.closest?.('details'));
    };
    #closeMenus(except) {
        for (const menu of this.toolbar.querySelectorAll('details[open]')) {
            if (menu !== except)
                menu.open = false;
        }
    }
    #renderToc(book) {
        const sectionIndex = new Map(book.sections.map((section, index) => [section.href, index]));
        const buttons = this.#root.ownerDocument.createDocumentFragment();
        const add = (items, depth) => {
            for (const item of items) {
                const button = this.#root.ownerDocument.createElement('button');
                Object.assign(button, { type: 'button', textContent: item.label, value: item.href, disabled: !item.href });
                button.style.setProperty('--depth', String(depth));
                button.dataset.index = String(sectionIndex.get(item.href.split('#')[0]) ?? -1);
                buttons.append(button);
                add(item.children, depth + 1);
            }
        };
        add(book.toc, 0);
        this.#part('toc').hidden = buttons.childElementCount < 2;
        this.#part('toc-list').replaceChildren(buttons);
        this.#marked = -1;
    }
    #markCurrent(index) {
        if (index === this.#marked)
            return;
        this.#marked = index;
        let current;
        let best = -1;
        for (const button of this.#part('toc-list').children) {
            button.removeAttribute('aria-current');
            const i = Number(button.dataset.index);
            if (i >= 0 && i <= index && (i > best || (i === best && !button.value.includes('#'))))
                [current, best] = [button, i];
        }
        current?.setAttribute('aria-current', 'true');
    }
    #load(name) {
        try {
            return JSON.parse(this.#storage?.getItem(`${this.#storageKey}:${name}`) ?? 'null') ?? undefined;
        }
        catch {
            return undefined;
        }
    }
    #save(name, value) {
        try {
            this.#storage?.setItem(`${this.#storageKey}:${name}`, JSON.stringify(value));
        }
        catch { }
    }
}
function defaultStorage() {
    try {
        return localStorage;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=reader.js.map