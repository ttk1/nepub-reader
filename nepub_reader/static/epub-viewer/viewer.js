import { resolvePath } from './book.js';
export const themes = {
    light: { background: '#ffffff', color: '#1a1a1a', link: '#1a5fb4' },
    // Grey rather than white text: full white is glaring on a black page.
    dark: { background: '#000000', color: '#acacac', link: '#7fa3d9' },
    sepia: { background: '#f4ecd8', color: '#5b4636', link: '#8a4b08' },
};
/**
 * Font stacks for Japanese text, covering macOS / iOS, Windows, Android and Linux.
 * Meiryo comes after Yu Gothic: its tall line metrics push ruby away from vertical text.
 */
export const fonts = {
    mincho: '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "BIZ UDMincho", "Noto Serif JP", "Noto Serif CJK JP", "IPAexMincho", "IPAMincho", serif',
    gothic: '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic Medium", "Yu Gothic", YuGothic, Meiryo, "Noto Sans JP", "Noto Sans CJK JP", "IPAexGothic", "IPAGothic", sans-serif',
};
const DEFAULTS = {
    theme: themes.light,
    fontFamily: '',
    fontSize: 16,
    writingMode: 'auto',
    margin: 32,
    maxWidth: 0,
    keyboard: true,
    cooldown: 100,
};
/**
 * Paginated EPUB renderer. Each section is shown in an iframe (scripts disabled) and split into
 * pages with CSS multi-column layout. For vertical text the columns stack downwards, so a page
 * turn is a vertical scroll; for horizontal text it is a horizontal scroll.
 */
export class EpubViewer extends EventTarget {
    book;
    #container;
    #iframe;
    #options = { ...DEFAULTS };
    #resizeObserver = new ResizeObserver(() => this.#relayout());
    #style;
    /** writing-mode declared by the book for the current section. */
    #bookWritingMode = 'horizontal-tb';
    /** writing-mode actually used for layout. */
    #writingMode = 'horizontal-tb';
    #index = -1;
    #page = 0;
    #pages = 1;
    /** Page size along the scroll axis, in px. */
    #pageSize = 0;
    /** Incremented on every navigation, so that stale async loads can be discarded. */
    #token = 0;
    #busy = false;
    #pressedKeys = new Set();
    #lastInputTurn = -Infinity;
    /** `container` must have a size (e.g. width/height set by CSS); the viewer fills it. */
    constructor(container, options = {}) {
        super();
        this.#container = container;
        this.#iframe = container.ownerDocument.createElement('iframe');
        // allow-same-origin: the viewer styles the document and listens to its events.
        // allow-scripts: WebKit does not fire our event listeners without it. The book's own
        // scripts are still blocked by the CSP that Book inserts into every document.
        this.#iframe.sandbox.add('allow-same-origin', 'allow-scripts');
        this.#iframe.style.cssText = 'display:block;width:100%;height:100%;margin:0 auto;border:0';
        container.append(this.#iframe);
        container.addEventListener('click', this.#onSideClick);
        this.setOptions(options);
        this.#resizeObserver.observe(container);
        this.#listenKeys(this.#window, 'addEventListener');
    }
    get options() {
        return this.#options;
    }
    /** Current position, to be saved and passed to `open()` / `goTo()` later. */
    get location() {
        return this.#index < 0 ? undefined : { index: this.#index, progress: this.#page / this.#pages };
    }
    /** Shows `book` at `location` (a Location or a TocItem href), or at the beginning. */
    async open(book, location) {
        this.book = book;
        this.#index = -1;
        await this.goTo(location ?? { index: Math.max(0, book.sections.findIndex((s) => s.linear)), progress: 0 });
    }
    async goTo(target) {
        if (typeof target !== 'string') {
            const index = target.index < 0 ? (this.book?.sections.length ?? 0) + target.index : target.index;
            return this.#display(index, { progress: target.progress });
        }
        const [path, fragment] = target.split('#');
        const index = this.book?.sections.findIndex((s) => s.href === path) ?? -1;
        if (index >= 0)
            await this.#display(index, { fragment });
    }
    next() {
        return this.#turn(1);
    }
    prev() {
        return this.#turn(-1);
    }
    /** Page turn towards the left: next page for right-to-left (vertical) books, previous otherwise. */
    goLeft() {
        return this.#turn(this.#rtl ? 1 : -1);
    }
    goRight() {
        return this.#turn(this.#rtl ? -1 : 1);
    }
    setOptions(options) {
        Object.assign(this.#options, options);
        const { theme, maxWidth } = this.#options;
        this.#container.style.background = theme.background;
        this.#iframe.style.maxWidth = maxWidth > 0 ? `${maxWidth}px` : '';
        this.#relayout();
    }
    destroy() {
        this.#token++;
        this.#resizeObserver.disconnect();
        this.#listenKeys(this.#window, 'removeEventListener');
        this.#container.removeEventListener('click', this.#onSideClick);
        this.#iframe.remove();
    }
    /** Key handling for a window: the host page's, or a section document's (keys there don't reach the host). */
    #listenKeys(target, method) {
        target[method]('keydown', this.#onKeydown);
        target[method]('keyup', this.#onKeyup);
        target[method]('blur', this.#onBlur);
    }
    get #window() {
        return this.#container.ownerDocument.defaultView;
    }
    get #vertical() {
        return this.#writingMode.startsWith('vertical');
    }
    get #rtl() {
        return this.#writingMode === 'vertical-rl';
    }
    async #turn(step) {
        const sections = this.book?.sections;
        if (!sections || this.#busy || this.#index < 0)
            return;
        const page = this.#page + step;
        if (page >= 0 && page < this.#pages)
            return this.#showPage(page);
        let index = this.#index + step;
        while (sections[index] && !sections[index].linear)
            index += step;
        if (sections[index])
            return this.#display(index, { progress: step > 0 ? 0 : 1 });
        this.dispatchEvent(new Event(step > 0 ? 'bookend' : 'bookstart'));
    }
    async #display(index, { progress = 0, fragment }) {
        const section = this.book?.sections[index];
        if (!section)
            return;
        const token = ++this.#token;
        this.#busy = true;
        try {
            if (index !== this.#index) {
                const url = await this.book.getUrl(section.href); // may throw; the current page stays usable
                if (token !== this.#token)
                    return; // superseded by a newer navigation
                this.#index = -1;
                const doc = await this.#load(url);
                if (token !== this.#token)
                    return;
                this.#index = index;
                this.#setup(doc);
            }
            this.#layout();
            this.#showPage(fragment ? this.#pageOf(fragment) : Math.round(progress * this.#pages));
            this.#iframe.style.visibility = '';
        }
        finally {
            if (token === this.#token)
                this.#busy = false;
        }
    }
    #load(url) {
        const iframe = this.#iframe;
        iframe.style.visibility = 'hidden';
        return new Promise((resolve) => {
            const onLoad = async () => {
                const doc = iframe.contentDocument;
                if (!doc || doc.URL === 'about:blank')
                    return;
                iframe.removeEventListener('load', onLoad);
                await doc.fonts.ready;
                resolve(doc);
            };
            iframe.addEventListener('load', onLoad);
            iframe.src = url;
        });
    }
    #setup(doc) {
        this.#bookWritingMode = doc.defaultView.getComputedStyle(doc.body ?? doc.documentElement).writingMode;
        this.#style = doc.createElement('style');
        (doc.head ?? doc.documentElement).append(this.#style);
        this.#listenKeys(doc.defaultView, 'addEventListener');
        doc.addEventListener('click', this.#onClick);
        this.dispatchEvent(new CustomEvent('sectionload', { detail: { index: this.#index, doc } }));
    }
    /** Applies options to the current document and recomputes the page count. */
    #layout() {
        const doc = this.#iframe.contentDocument;
        if (!doc || !this.#style)
            return;
        const { theme, fontFamily, fontSize, writingMode, margin: m } = this.#options;
        const { width, height } = this.#iframe.getBoundingClientRect();
        const [w, h] = [Math.floor(width), Math.floor(height)];
        this.#writingMode =
            writingMode === 'auto' ? this.#bookWritingMode : writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb';
        this.#pageSize = this.#vertical ? h : w;
        // The html element is the multi-column container. Padding m + column gap 2m makes every
        // column (= page) start exactly at a multiple of the page size.
        this.#style.textContent = `
      html { line-height: 1.6; } /* default only; the book's own CSS wins */
      html {
        writing-mode: ${this.#writingMode} !important;
        box-sizing: border-box !important;
        width: ${w}px !important;
        height: ${h}px !important;
        margin: 0 !important;
        padding: ${m}px !important;
        column-width: ${this.#pageSize - 2 * m}px !important;
        column-gap: ${2 * m}px !important;
        column-fill: auto !important;
        overflow: hidden !important;
        font-size: ${fontSize}px !important;
        color: ${theme.color} !important;
        /* Not transparent: browsers paint an opaque (white) backdrop behind an iframe whose
           color-scheme differs from the host page's, e.g. a dark host page. */
        background: ${theme.background} !important;
      }
      body {
        writing-mode: ${this.#writingMode} !important;
        margin: 0 !important;
        background: transparent !important;
      }
      ${fontFamily ? `body, body * { font-family: ${fontFamily} !important; }` : ''}
      body :not(a) { color: inherit !important; }
      a:link, a:visited { color: ${theme.link} !important; }
      img, svg, video {
        max-width: ${w - 2 * m}px !important;
        max-height: ${h - 2 * m}px !important;
        object-fit: contain;
        break-inside: avoid;
      }`;
        const scroller = doc.scrollingElement;
        const scrollSize = this.#vertical ? scroller.scrollHeight : scroller.scrollWidth;
        this.#pages = Math.max(1, Math.ceil((scrollSize - m) / this.#pageSize));
    }
    #relayout() {
        if (this.#busy || this.#index < 0)
            return;
        const progress = this.#page / this.#pages;
        this.#layout();
        this.#showPage(Math.round(progress * this.#pages));
    }
    #showPage(page) {
        const doc = this.#iframe.contentDocument;
        this.#page = Math.min(Math.max(page, 0), this.#pages - 1);
        const offset = this.#page * this.#pageSize;
        doc.scrollingElement.scrollTo(this.#vertical ? 0 : offset, this.#vertical ? offset : 0);
        const sizes = this.book.sections.map((s) => s.size);
        const total = sizes.reduce((a, b) => a + b, 0) || 1;
        const before = sizes.slice(0, this.#index).reduce((a, b) => a + b, 0);
        const detail = {
            ...this.location,
            page: this.#page,
            pages: this.#pages,
            fraction: (before + (sizes[this.#index] * (this.#page + 1)) / this.#pages) / total,
        };
        this.dispatchEvent(new CustomEvent('relocate', { detail }));
    }
    #pageOf(id) {
        const doc = this.#iframe.contentDocument;
        const el = doc.getElementById(id);
        if (!el)
            return 0;
        const rect = el.getBoundingClientRect();
        const scroller = doc.scrollingElement;
        const offset = this.#vertical ? rect.top + scroller.scrollTop : rect.left + scroller.scrollLeft;
        return Math.floor(offset / this.#pageSize);
    }
    #onKeydown = (e) => {
        if (!this.#options.keyboard || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey)
            return;
        if (e.target.closest?.('input, textarea, select, [contenteditable]'))
            return;
        const actions = {
            ArrowLeft: this.goLeft,
            ArrowRight: this.goRight,
            ArrowUp: this.prev, // e.g. the up / down buttons of a remote control
            ArrowDown: this.next,
            PageUp: this.prev,
            PageDown: this.next,
            ' ': e.shiftKey ? this.prev : this.next,
        };
        const action = actions[e.key];
        if (!action)
            return;
        e.preventDefault();
        // One press, one page: ignore auto-repeat while the key is held. Tracked here instead of
        // `e.repeat` because some remote controls send repeats without setting it.
        if (this.#pressedKeys.has(e.key))
            return;
        this.#pressedKeys.add(e.key);
        this.#inputTurn(action);
    };
    #onKeyup = (e) => {
        this.#pressedKeys.delete(e.key);
    };
    /** A keyup may be missed while focus is elsewhere; forget held keys so the next press works. */
    #onBlur = () => {
        this.#pressedKeys.clear();
    };
    /** Page turn by user input, dropped as chattering if it comes within `cooldown` ms of the last one. */
    #inputTurn(action) {
        const now = performance.now();
        if (now - this.#lastInputTurn < this.#options.cooldown)
            return;
        this.#lastInputTurn = now;
        action.call(this).catch((error) => this.dispatchEvent(new CustomEvent('error', { detail: { error } })));
    }
    /** Clicks inside the page: follow links, or turn pages when the left/right third is clicked. */
    #onClick = (e) => {
        const link = e.target.closest?.('a[href]');
        if (link) {
            e.preventDefault();
            this.#followLink(link.getAttribute('href'));
            return;
        }
        if (!this.#iframe.contentDocument?.getSelection()?.isCollapsed)
            return;
        const x = e.clientX / this.#iframe.clientWidth;
        if (x < 1 / 3)
            this.#inputTurn(this.goLeft);
        else if (x > 2 / 3)
            this.#inputTurn(this.goRight);
    };
    /** Clicks on the empty sides of a width-limited page turn pages too. */
    #onSideClick = (e) => {
        if (e.target !== this.#container)
            return;
        const { left, right } = this.#iframe.getBoundingClientRect();
        if (e.clientX < left)
            this.#inputTurn(this.goLeft);
        else if (e.clientX > right)
            this.#inputTurn(this.goRight);
    };
    #followLink(href) {
        const target = resolvePath(href, this.book.sections[this.#index].href);
        if (target) {
            void this.goTo(target);
        }
        else if (
        // Only web and mail links: a javascript: URL would run with the host page's origin.
        /^(https?|mailto):/i.test(href) &&
            this.dispatchEvent(new CustomEvent('link', { detail: { href }, cancelable: true }))) {
            this.#window.open(href, '_blank', 'noopener');
        }
    }
}
//# sourceMappingURL=viewer.js.map