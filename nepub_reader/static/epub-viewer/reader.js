import { openBook } from './book.js';
import { fonts, themes } from './options.js';
import { EpubViewer } from './viewer.js';
const DEFAULT_SETTINGS = {
    theme: 'system',
    font: 'mincho',
    fontSize: 45, // large enough to read comfortably at a distance
    lineHeight: 0,
    maxWidth: 0,
    writingMode: 'auto',
    spread: 'auto',
    direction: 'auto',
};
/** A row of the settings panel: radio buttons named after the setting, one per value. */
const choices = (name, label, options) => `
  <div class="row">
    <span>${label}</span>
    <span class="choices" role="radiogroup" aria-label="${label}">
      ${options.map(([value, text, style = '']) => `<label><input type="radio" name="${name}" value="${value}"><span style="${style}">${text}</span></label>`).join('')}
    </span>
  </div>`;
const swatch = ({ background, color }) => `background:${background};color:${color}`;
// The two menus are <details>, so they open and close without any code. The settings are in a
// <form> to keep the radio button groups of several readers on one page apart. Settings that only
// work for one kind of book (reflowable text, or fixed-layout pages) are shown for that kind only,
// and the spread not for vertical text.
const TOOLBAR = `
  <details class="toc" hidden>
    <summary>目次</summary>
    <div class="panel toc-list"></div>
  </details>
  <span class="title"></span>
  <span class="progress"><span class="pages"></span><span class="percent"></span></span>
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
        ${choices('lineHeight', '行間', [[0, '本の指定'], [1.3, '狭い'], [1.6, '標準'], [1.9, '広い'], [2.2, 'とても広い']])}
        ${choices('maxWidth', '表示幅', [[0, '全幅'], [1400, '1400'], [1200, '1200'], [1000, '1000'], [800, '800'], [600, '600']])}
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
// Scoped to .epub-reader so that it can live inside another app's page. The toolbar takes the
// colors of the page (--bg / --fg, set from the theme) so that it stays out of the way of the text.
// Lines and highlights are a translucent grey, which works on any theme. The CSS keeps to what the
// browsers that can run the library at all support (no :has(), no color-mix()); the container query
// and its unit are extras with fallbacks.
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
  /* Progress through the book, drawn over the border. */
  .epub-reader .toolbar::after {
    content: ''; position: absolute; left: 0; bottom: -1px; width: calc(var(--progress, 0) * 100%); height: 2px;
    background: var(--fg); opacity: 0.5; transition: width 0.2s;
  }
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
    position: absolute; top: calc(100% + 6px); box-sizing: border-box;
    width: min(26em, 100% - 16px); max-height: 70vh; max-height: calc(100cqh - 100% - 14px); overflow: auto;
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
/**
 * A ready-made reader UI: toolbar (table of contents, progress, and a settings menu for font size,
 * font, width, writing mode and theme) + EpubViewer, with settings and reading positions saved in
 * a storage. Add your own controls to `toolbar`, and use `viewer` for events and navigation.
 */
export class EpubReader {
    /** The toolbar element; add your own buttons or links to it. */
    toolbar;
    viewer;
    #book;
    #root;
    #storage;
    #storageKey;
    #systemDark = matchMedia('(prefers-color-scheme: dark)');
    #settings;
    #positionKey = '';
    /** The latest call of open(). */
    #opening;
    /** The document of the section shown (of a fixed-layout book: of one of its pages). */
    #page;
    /** The section whose entry is marked in the table of contents. */
    #marked = -1;
    /**
     * Marks the root while a menu is open, for the cover over the page. From the `open` attribute
     * itself: the toggle event comes too late for a click that follows right after the menu opens.
     */
    #menuObserver = new MutationObserver(() => {
        this.#root.classList.toggle('menu-open', !!this.toolbar.querySelector('details[open]'));
    });
    /** `root` must have a height; the reader fills it. */
    constructor(root, { storage = defaultStorage(), storageKey = 'epub-viewer', settings = {}, viewer = {} } = {}) {
        const doc = root.ownerDocument;
        if (!doc.getElementById('epub-reader-style')) {
            doc.head.append(Object.assign(doc.createElement('style'), { id: 'epub-reader-style', textContent: STYLE }));
        }
        root.classList.add('epub-reader');
        root.innerHTML = `<header class="toolbar">${TOOLBAR}</header><div class="viewer"></div>`;
        this.#root = root;
        this.#storage = storage;
        this.#storageKey = storageKey;
        this.toolbar = root.querySelector('.toolbar');
        this.viewer = new EpubViewer(root.querySelector('.viewer'), viewer);
        // Of what is saved, only settings of the right kind: a font size that is not a number could not be changed any more.
        const usable = ([key, value]) => Object.hasOwn(DEFAULT_SETTINGS, key) && typeof value === typeof DEFAULT_SETTINGS[key] && value === value;
        const saved = Object.fromEntries(Object.entries(this.#load('settings') ?? {}).filter(usable));
        this.#settings = { ...DEFAULT_SETTINGS, ...settings, ...saved };
        this.viewer.addEventListener('relocate', (e) => {
            const { index, page, pages, fraction } = e.detail;
            // The pages of the section. A fixed-layout book has one page to a section, so there the sections are counted.
            const book = this.#book;
            const fixed = book.metadata.layout === 'pre-paginated';
            this.#part('pages').textContent = fixed ? `${index + 1} / ${book.sections.length}` : `${page + 1} / ${pages}`;
            this.#part('percent').textContent = `（${Math.round(fraction * 100)}%）`;
            root.style.setProperty('--progress', String(fraction));
            this.#markCurrent(index);
            this.#save(`position:${this.#positionKey}`, this.viewer.location);
            // For the settings shown: a spread does nothing for vertical text, whose page is as wide as the screen already.
            const vertical = !fixed && this.#page?.defaultView?.getComputedStyle(this.#page.documentElement).writingMode.startsWith('vertical');
            root.dataset.writing = vertical ? 'vertical' : 'horizontal';
        });
        this.viewer.addEventListener('sectionload', (e) => (this.#page = e.detail.doc));
        this.toolbar.addEventListener('click', this.#onClick);
        this.toolbar.addEventListener('change', this.#onChange);
        // On the document: after a click that opens a menu, the focus is not in the toolbar. The
        // document gets a key before the window, where the viewer listens.
        doc.addEventListener('keydown', this.#onKeydown);
        this.toolbar.addEventListener('toggle', this.#onToggle, true); // toggle does not bubble
        this.toolbar.addEventListener('submit', (e) => e.preventDefault()); // Enter in the settings form
        doc.addEventListener('click', this.#dismiss);
        this.#menuObserver.observe(this.toolbar, { attributeFilter: ['open'], subtree: true });
        this.#systemDark.addEventListener('change', this.#apply); // follow the OS while theme is "system"
        this.#apply();
    }
    /** The book being shown. */
    get book() {
        return this.#book;
    }
    get settings() {
        return this.#settings;
    }
    /**
     * Changes settings, as the toolbar does: for controls of your own. The changes are saved; only
     * changed settings are, so that the rest keeps following the initial settings given by the app.
     */
    setSettings(changes) {
        this.#settings = { ...this.#settings, ...changes };
        this.#save('settings', { ...this.#load('settings'), ...changes });
        this.#apply();
    }
    /**
     * Opens a book at `options.location`, the saved position, or the beginning. When called again
     * before the book is ready, the later call wins, and both give the book of the later call.
     */
    open(source, options = {}) {
        const opening = this.#open(source, options, () => opening === this.#opening);
        return (this.#opening = opening);
    }
    async #open(source, { key, location }, isLatest) {
        const book = await openBook(source);
        // Not the latest call any more (or the reader has been destroyed): the book of the latest one is given instead.
        if (!isLatest()) {
            book.destroy();
            return this.#opening ?? book;
        }
        // The book before is kept until this one is on the screen: if it cannot be shown, that one stays.
        const before = { book: this.#book, key: this.#positionKey };
        this.#book = book;
        // A File is told by its name, not by `instanceof`: one dropped on the page comes from the iframe's realm.
        const name = typeof source === 'string' || source instanceof URL ? String(source) : source.name;
        // Not all of a name of any length: it is the book's to choose, and the storage is not the reader's alone to fill.
        this.#positionKey = key ?? (book.metadata.identifier || name || book.metadata.title).slice(0, 200);
        // What is saved may not be a position (it is not ours alone to write): such a thing is not used.
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
        this.#root.dataset.layout = book.metadata.layout; // for the settings shown
        this.#renderToc(book);
        if (this.viewer.location)
            this.#markCurrent(this.viewer.location.index);
        return book;
    }
    /** Removes the reader from `root` and releases the book. */
    destroy() {
        this.#root.ownerDocument.removeEventListener('click', this.#dismiss);
        this.#root.ownerDocument.removeEventListener('keydown', this.#onKeydown);
        this.#systemDark.removeEventListener('change', this.#apply);
        this.#menuObserver.disconnect();
        this.#opening = undefined; // a book that is still being opened is not shown
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
        // A saved setting may be a name that is not known (any more), or one that every object has ("constructor").
        const theme = Object.hasOwn(themes, name) ? themes[name] : themes.light;
        const { style } = this.#root;
        style.setProperty('--bg', theme.background);
        style.setProperty('--fg', theme.color);
        style.colorScheme = name === 'dark' ? 'dark' : 'light'; // scroll bars etc.
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
            writingMode: settings.writingMode,
            spread: settings.spread,
            direction: settings.direction,
        });
    };
    #onClick = (e) => {
        // The controls of the reader, and buttons added by the app; not other things that it adds (e.g. a text field).
        const control = e.target.closest('button, summary, .settings input');
        if (control?.matches('.font-up, .font-down')) {
            const ratio = control.matches('.font-up') ? 1.2 : 1 / 1.2; // equal-looking steps at any size
            this.setSettings({ fontSize: Math.min(120, Math.max(12, Math.round(this.#settings.fontSize * ratio))) });
        }
        else if (control?.matches('.toc-list button')) {
            this.#closeMenus();
            // Reported like a failed page turn, for the app to show.
            this.viewer.goTo(control.value).catch((error) => {
                this.viewer.dispatchEvent(new CustomEvent('error', { detail: { error } }));
            });
        }
        // After a click with the mouse (detail > 0), keys go back to turning pages instead of operating
        // the control again. Keyboard and remote control users keep their place in the toolbar.
        if (e.detail)
            control?.blur();
    };
    #onChange = (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement) || !input.closest('.settings'))
            return; // e.g. controls added by the app
        const key = input.name;
        this.setSettings({ [key]: typeof DEFAULT_SETTINGS[key] === 'number' ? Number(input.value) : input.value });
    };
    /**
     * Keys while a menu is open, wherever the focus is. The keys that turn pages are marked with
     * preventDefault(), so that the viewer leaves them alone: the page behind a menu does not turn.
     */
    #onKeydown = (e) => {
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
            // Headings that lead nowhere (disabled) cannot take the focus: on to the entry after them.
            const step = e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling';
            let entry = target[step];
            while (entry?.disabled)
                entry = entry[step];
            entry?.focus();
        }
        else if (/^(Arrow|Page)/.test(e.key) ? !target.matches('input') : e.key === ' ' && !target.closest('button, summary, input')) {
            e.preventDefault(); // not the arrow keys of the radio buttons, nor Space on a control
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
        // Center the current chapter in the list. Not scrollIntoView(), which may scroll the host page as well.
        const list = current.parentElement;
        list.scrollTop = current.offsetTop - (list.clientHeight - current.offsetHeight) / 2;
        // Opened from the keyboard (a mouse click does not leave the focus on the menu): start at the current chapter.
        if (menu.contains(menu.ownerDocument.activeElement))
            current.focus({ preventScroll: true });
    };
    /**
     * A click outside of a menu closes it. Not earlier, when the pointer is pressed: with a touch, the
     * click comes after the finger is lifted, and would go to the page that the closed menu's cover has left.
     */
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
        // Not a list of arguments (replaceChildren(...buttons)): their number has a limit, which a book can go past.
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
        // A single entry leads nowhere but to the section already shown (e.g. a book of one episode).
        this.#part('toc').hidden = buttons.childElementCount < 2;
        this.#part('toc-list').replaceChildren(buttons);
        this.#marked = -1;
    }
    /** Marks the table of contents entry that the section at `index` belongs to: the last one at or before it. */
    #markCurrent(index) {
        if (index === this.#marked)
            return; // called at every page turn; the entry only changes with the section
        this.#marked = index;
        let current;
        let best = -1;
        for (const button of this.#part('toc-list').children) {
            button.removeAttribute('aria-current');
            const i = Number(button.dataset.index);
            // Of several entries for one section, the last one that is for the whole section: where a
            // chapter is followed by its episodes, the chapter links to the first episode. Entries for a
            // place inside the section (#...) are not taken: where in the section the page is is not known.
            if (i >= 0 && i <= index && (i > best || (i === best && !button.value.includes('#'))))
                [current, best] = [button, i];
        }
        current?.setAttribute('aria-current', 'true');
    }
    // The storage may fail (it is full, or its content is not ours); the reader still works without it.
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
/** localStorage, where the browser lets the page use it (not in some private modes or sandboxed frames). */
function defaultStorage() {
    try {
        return localStorage;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=reader.js.map