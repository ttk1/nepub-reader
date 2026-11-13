import { resolvePath } from './book.js';
import { fitScale, pageSize, pairPages, twoPages } from './fixed.js';
import { Input } from './input.js';
import { DEFAULT_OPTIONS } from './options.js';
import { firstText, pageOf, paginate, prepare, scrolledPage, scrollToPage } from './reflow.js';
/** A frame, or its slot, that fills the room it is given. */
const FILL = 'width:100%;height:100%';
/** The pagination of a fixed-layout page: it is a page as it is. */
const ONE_PAGE = { writingMode: '', vertical: false, pageSize: 0, pages: 1 };
/**
 * Shows a book page by page, in iframes (scripts disabled). The text of a reflowable book is
 * split into pages (see reflow.ts); the pages of a fixed-layout book are shown as they are, scaled
 * to fit, one or two at a time (see fixed.ts). User input is handled in input.ts.
 *
 * This class keeps what is shown: the frames, the position, and the navigations between them.
 */
export class EpubViewer extends EventTarget {
    #book;
    #container;
    /** Holds the frame(s), centered. */
    #stage;
    /** The frame of the section shown; in a fixed-layout book, one for each page of the spread. */
    #frames;
    /** The sections in the frames. */
    #shown = [];
    #options = { ...DEFAULT_OPTIONS };
    #input;
    #resizeObserver = new ResizeObserver(() => this.#relayout());
    // Reflowable text: the rules that split the document shown into pages are written into #style.
    #style;
    /** The writing mode that the book declares for the section. */
    #bookWritingMode = 'horizontal-tb';
    #pagination = ONE_PAGE;
    /** The first section shown, or -1 while there is none (a book has just been opened and is loading). */
    #index = -1;
    #page = 0;
    /** The text that the page began with before the re-layouts since the last navigation. */
    #anchor;
    /** Where in the section to go once the container, which is hidden, is shown: there are no pages before (see #place). */
    #pending;
    // Navigations (see #display) overlap, as they wait for files to load.
    /** The number of the navigation started last. */
    #navigation = 0;
    /** The number of the navigation that changed the page last, or is doing so: those started before it give up. */
    #committed = 0;
    /** The latest navigation is under way: page turns by the user are ignored meanwhile. */
    #busy = false;
    /** The frame shown has been emptied, as the book took it elsewhere (see #loadFrame): there is nothing to lay out. */
    #emptied = false;
    /** Settled by destroy(), for those who wait for frames that will not load any more. */
    #end;
    #destroyed = new Promise((resolve) => (this.#end = resolve));
    /** `container` must have a size (e.g. width/height set by CSS); the viewer fills it. */
    constructor(container, options = {}) {
        super();
        this.#container = container;
        this.#stage = container.ownerDocument.createElement('div');
        this.#stage.style.cssText = `position:relative;display:flex;justify-content:center;align-items:center;${FILL}`;
        this.#frames = [this.#createFrame()];
        this.#styleFrame(this.#frame, FILL, FILL);
        container.style.touchAction = 'manipulation'; // as for the page: see reflow.ts
        container.append(this.#stage);
        this.#input = new Input(container, this.#stage, {
            options: this.#options,
            next: () => this.next(),
            prev: () => this.prev(),
            goLeft: () => this.goLeft(),
            goRight: () => this.goRight(),
            shown: () => this.#index >= 0,
            pagesRect: () => this.#pagesRect(),
            followLink: (href, doc) => this.#followLink(href, doc),
            dispatchEvent: (event) => this.dispatchEvent(event),
        });
        this.setOptions(options);
        this.#resizeObserver.observe(container);
    }
    /** The book being shown. */
    get book() {
        return this.#book;
    }
    get options() {
        return this.#options;
    }
    /** Current position, to be saved and passed to `open()` / `goTo()` later. */
    get location() {
        return this.#index < 0 ? undefined : { index: this.#index, progress: this.#page / this.#pagination.pages };
    }
    /** Shows `book` at `target`, or at the beginning. The Book shown before is not destroyed. */
    async open(book, target) {
        // e.g. a book of SVG documents only, which are not shown. The book shown before stays.
        if (!book.sections.length)
            throw new Error('The book has nothing to show: no XHTML or HTML documents in its spine');
        const before = { book: this.#book, index: this.#index, shown: this.#shown, pending: this.#pending };
        this.#book = book;
        this.#index = -1;
        this.#shown = [];
        this.#pending = undefined;
        this.#committed = ++this.#navigation; // navigations of the book before give up
        this.#busy = false; // they do not reset it themselves any more, not being the latest
        const start = { index: Math.max(0, book.sections.findIndex((s) => s.linear)), progress: 0 };
        try {
            await this.goTo(target ?? start);
            // A target that is not in this book, e.g. one saved for an older edition: don't leave the page
            // empty. (Unless another book has been opened meanwhile: that one is not ours to move.)
            // Nor while another move in this book is under way: that is where the caller wants to be.
            if (this.#book === book && this.#index < 0 && !this.#busy)
                await this.goTo(start);
        }
        catch (error) {
            // Nothing of this book has come to the screen (e.g. its first section cannot be read): the
            // page of the book before is still there, and that book goes on. Left as it is, no page
            // could be turned any more.
            if (this.#book === book && this.#index < 0) {
                ;
                [this.#book, this.#index, this.#shown, this.#pending] = [before.book, before.index, before.shown, before.pending];
            }
            throw error;
        }
    }
    /** Moves to `target`. Does nothing if that is not in the book. */
    async goTo(target) {
        if (typeof target === 'string') {
            const [path, fragment] = target.split('#');
            const index = this.#book?.sections.findIndex((s) => s.href === path) ?? -1;
            if (index >= 0)
                await this.#display(index, { fragment });
        }
        else if ('fraction' in target) {
            await this.#seek(target.fraction);
        }
        else {
            const index = target.index < 0 ? (this.#book?.sections.length ?? 0) + target.index : target.index;
            await this.#display(index, { progress: target.progress });
        }
    }
    next() {
        return this.#turn(1);
    }
    prev() {
        return this.#turn(-1);
    }
    /** Page turn towards the left: the next page for a book read from right to left (vertical text, manga), the previous one otherwise. */
    goLeft() {
        return this.#turn(this.#rtl ? 1 : -1);
    }
    goRight() {
        return this.#turn(this.#rtl ? -1 : 1);
    }
    setOptions(options) {
        Object.assign(this.#options, options);
        this.#container.style.background = this.#options.theme.background;
        this.#relayout();
    }
    destroy() {
        // Stops navigations under way, and makes later calls (setOptions, next, ...) do nothing.
        this.#committed = ++this.#navigation;
        this.#book = undefined;
        this.#index = -1;
        this.#resizeObserver.disconnect();
        this.#input.destroy();
        this.#stage.remove();
        for (const property of ['touch-action', 'background'])
            this.#container.style.removeProperty(property); // set by the viewer
        this.#end();
    }
    // ---- What kind of book, and which way it goes
    /** The book is a fixed-layout one: every section is a page. */
    get #fixed() {
        return this.#book?.metadata.layout === 'pre-paginated';
    }
    /** Pages progress to the left. */
    get #rtl() {
        const { direction, writingMode } = this.#options;
        const book = this.#book?.metadata.direction;
        if (this.#fixed)
            return (direction === 'auto' ? book : direction) === 'rtl';
        // Vertical lines go to the left. So do the horizontal pages of a book that goes to the left (a
        // cover or a colophon among vertical text), unless horizontal text is what the reader asked for.
        return this.#pagination.writingMode === 'vertical-rl' || (writingMode === 'auto' && book === 'rtl');
    }
    /** Fixed layout: the pages (as indices of sections) shown together, in reading order. */
    #spreads() {
        const { width, height } = this.#stage.getBoundingClientRect();
        return pairPages(this.#book.sections, this.#rtl ? 'rtl' : 'ltr', twoPages(width, height, this.#options.spread));
    }
    /** The sections shown together with the one at `index`: in a fixed-layout book, the pages of its spread. */
    #shownWith(index) {
        return (this.#fixed && this.#spreads().find((spread) => spread.includes(index))) || [index];
    }
    /** The section that a page turn past what is shown leads to, if there is one. */
    #neighbor(step) {
        const { sections } = this.#book;
        if (this.#fixed) {
            const spreads = this.#spreads();
            const [from, to] = [this.#index, this.#shown[this.#shown.length - 1]];
            return (step > 0 ? spreads.find((s) => s[0] > to) : spreads.findLast((s) => s[s.length - 1] < from))?.[0];
        }
        let index = this.#index + step;
        while (sections[index] && !sections[index].linear)
            index += step;
        return sections[index] ? index : undefined;
    }
    // ---- Frames
    /** The frame of the section; in a fixed-layout book, of the first page. */
    get #frame() {
        return this.#frames[0];
    }
    /**
     * A frame in its slot: the slot takes the room in the layout, so that the frame can be scaled
     * inside it. Out of sight until it is styled: a document is loaded there while the page before
     * it stays on the screen.
     */
    #createFrame() {
        const iframe = this.#container.ownerDocument.createElement('iframe');
        iframe.title = this.#book?.metadata.title ?? ''; // names the frame for screen readers
        // allow-same-origin: the viewer styles the document and listens to its events.
        // allow-scripts: WebKit does not fire our event listeners without it. The book's own
        // scripts are still blocked by the CSP that Book inserts into every document.
        iframe.sandbox.add('allow-same-origin', 'allow-scripts');
        const slot = this.#container.ownerDocument.createElement('div');
        slot.append(iframe);
        this.#stage.append(slot);
        this.#styleFrame(iframe, 'position:absolute;inset:0;visibility:hidden', FILL);
        return iframe;
    }
    #styleFrame(iframe, slot, frame) {
        iframe.parentElement.style.cssText = `flex:none;overflow:hidden;${slot}`;
        iframe.style.cssText = `display:block;border:0;${frame}`;
    }
    #loadFrame(iframe, url) {
        return new Promise((resolve) => {
            let [loaded, left] = [false, false];
            const leave = () => {
                if (left)
                    return;
                left = true;
                iframe.src = 'about:blank';
                if (this.#frames.includes(iframe))
                    this.#emptied = true;
                this.dispatchEvent(new CustomEvent('error', { detail: { error: new Error('The book tried to leave its page') } }));
            };
            iframe.addEventListener('load', async () => {
                const doc = iframe.contentDocument;
                if (loaded) {
                    // A frame is loaded once. If it loads again, the book has taken it to another page by a
                    // way that is not known (the known ones are closed in book.ts and input.ts): that page is not shown.
                    if (doc?.URL !== 'about:blank')
                        leave();
                }
                else if (doc && doc.URL !== 'about:blank') {
                    loaded = true;
                    // Also when that page does not finish loading (and so does not fire "load"): the document
                    // of the book is left as soon as the other one comes. (Not when the frame is taken out of the
                    // page, nor when the host page goes into the back/forward cache.)
                    doc.defaultView.addEventListener('pagehide', (e) => e.persisted || setTimeout(() => iframe.isConnected && leave()));
                    await doc.fonts.ready;
                    resolve(doc);
                }
            });
            iframe.src = url;
        });
    }
    /** The area of the page(s), without the empty sides. */
    #pagesRect() {
        const rects = this.#frames.map((frame) => frame.parentElement.getBoundingClientRect());
        return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
    }
    // ---- Navigation
    async #turn(step) {
        if (!this.#book || this.#busy || this.#index < 0 || this.#pending)
            return;
        const page = this.#page + step;
        if (page >= 0 && page < this.#pagination.pages)
            return this.#showPage(page);
        const index = this.#neighbor(step);
        if (index !== undefined)
            return this.#display(index, { progress: step > 0 ? 0 : 1 });
        this.dispatchEvent(new Event(step > 0 ? 'bookend' : 'bookstart'));
    }
    /** Shows the page that `fraction` of the whole book falls on: the reverse of the fraction of the relocate event. */
    async #seek(fraction) {
        const sizes = this.#sizes();
        const part = Math.min(Math.max(fraction, 0), 1);
        // A page ends at (page + 1) / pages; the small amounts make up for rounding errors, which
        // would lead to the page after the one that reported the fraction.
        if (this.#fixed)
            return this.#display(Math.max(0, Math.ceil(part * sizes.length - 1e-6) - 1), {});
        // The section that this much of the book (in bytes) ends in, and how far into it.
        const total = sizes.reduce((a, b) => a + b, 0);
        let rest = part * total;
        let index = 0;
        // (Sections that count for nothing are passed over: the start of the book is its first page in the reading order.)
        while (index < sizes.length - 1 && (rest > sizes[index] + total * 1e-9 || !sizes[index]))
            rest -= sizes[index++];
        await this.#display(index, { reach: sizes[index] ? rest / sizes[index] : 0 });
    }
    /** The sizes of the sections as they count for the progress through the book: nothing for those outside of the reading order (linear="no"). */
    #sizes() {
        return (this.#book?.sections ?? []).map((section) => (section.linear || this.#fixed ? section.size : 0));
    }
    /** Shows a section, at a place in it. */
    async #display(index, place) {
        const book = this.#book;
        if (!book?.sections[index])
            return;
        const navigation = ++this.#navigation;
        this.#busy = true;
        try {
            // First, while nothing has changed yet: if this throws, the current page, or another
            // navigation that is under way, stays as it is.
            const indices = this.#shownWith(index);
            const shown = !this.#emptied && indices.join() === this.#shown.join(); // an emptied frame is loaded anew
            const urls = shown ? [] : await Promise.all(indices.map((i) => book.getUrl(book.sections[i].href))).catch((error) => error);
            // A navigation started after this one has changed the page already (or another book was
            // opened, or the viewer destroyed): the one asked for last wins, not the one ready last.
            if (navigation < this.#committed)
                return;
            if (urls instanceof Error)
                throw urls;
            this.#committed = navigation;
            if (!shown) {
                // Loaded in frames of their own, out of sight, and put in the place of the page shown only
                // when ready: the screen does not go blank in between (in manga, at every page turn).
                const frames = urls.map(() => this.#createFrame());
                // Frames taken out of the page by destroy() never load: the wait ends with it.
                const docs = await Promise.race([Promise.all(frames.map((frame, i) => this.#loadFrame(frame, urls[i]))), this.#destroyed]);
                const superseded = this.#committed !== navigation; // by a newer navigation, or by destroy()
                for (const frame of superseded ? frames : this.#frames)
                    frame.parentElement.remove();
                if (superseded || !docs)
                    return;
                this.#frames = frames;
                this.#emptied = false;
                this.#index = indices[0];
                this.#shown = indices;
                docs.forEach((doc, i) => this.#setup(doc, indices[i]));
            }
            this.#place(place);
            // What the next page turn leads to is made ready ahead of time (its files are unpacked).
            const next = this.#neighbor(1);
            for (const i of next === undefined ? [] : this.#shownWith(next))
                book.getUrl(book.sections[i].href).catch(() => { });
        }
        finally {
            // Only the latest one: a navigation that never finishes (a file that cannot be read to its
            // end) must not block page turns for good, once a later navigation has shown a page.
            if (navigation === this.#navigation)
                this.#busy = false;
        }
    }
    /**
     * Lays out the section shown, and shows the page of it that `place` is on. Text in a hidden
     * container (it has no size) cannot be split into pages: the place is kept until it is shown.
     */
    #place(place) {
        const { width, height } = this.#stage.getBoundingClientRect();
        this.#layout();
        this.#pending = this.#fixed || (width && height) ? undefined : place;
        if (this.#pending)
            return;
        const { progress = 0, reach, fragment } = place;
        const target = !this.#fixed && fragment ? this.#frame.contentDocument.getElementById(fragment) : null;
        const { pages } = this.#pagination;
        // A page ends at (page + 1) / pages of the section; the small amount is for rounding errors.
        const page = reach === undefined ? Math.round(progress * pages) : Math.ceil(reach * pages - 1e-6) - 1;
        this.#showPage(target ? pageOf(this.#frame.contentDocument, this.#pagination, target) : page);
    }
    /** Prepares a document that has been loaded into a frame. */
    #setup(doc, index) {
        const style = doc.createElement('style');
        (doc.head ?? doc.documentElement).append(style);
        if (this.#fixed) {
            // A fixed-layout page is shown as it is. Only what a page larger than its declared size, and
            // double taps, would do is stopped (see reflow.ts for touch-action).
            style.textContent = 'html { overflow: hidden !important; touch-action: manipulation !important; }';
        }
        else {
            this.#style = style;
            this.#bookWritingMode = ''; // read at the first layout (see #layout)
            doc.addEventListener('scroll', this.#onScroll);
            prepare(doc);
        }
        this.#input.attach(doc);
        this.dispatchEvent(new CustomEvent('sectionload', { detail: { index, doc } }));
    }
    #followLink(link, doc) {
        const href = link.trim(); // as browsers read it: white space around a URL is not part of it
        // Relative to the section that the link is in: of a spread, that may be the second page.
        const from = this.#shown[this.#frames.findIndex((frame) => frame.contentDocument === doc)] ?? this.#index;
        const target = resolvePath(href, this.#book.sections[from].href);
        if (target) {
            this.goTo(target).catch((error) => this.dispatchEvent(new CustomEvent('error', { detail: { error } })));
            return;
        }
        // As the browser reads it ("http:\\host", "HTTP://", line breaks inside): what the app is given
        // to check is where the link leads. A URL that is not one leads nowhere.
        // (Not URL.canParse(), which Safari 16.4 does not have.)
        let url;
        try {
            url = new URL(href);
        }
        catch { }
        // Only web and mail links: a javascript: URL would run with the host page's origin.
        if (url && ['http:', 'https:', 'mailto:'].includes(url.protocol) && this.dispatchEvent(new CustomEvent('link', { detail: { href: url.href }, cancelable: true }))) {
            this.#container.ownerDocument.defaultView.open(url.href, '_blank', 'noopener');
        }
    }
    // ---- Layout and pages
    /** Fits what is shown to the container and the options. */
    #layout() {
        if (this.#fixed) {
            // A frame keeps the size of its page, which is what the page is laid out for, and is scaled as a whole.
            const sizes = this.#frames.map((frame) => pageSize(frame.contentDocument));
            const { width, height } = this.#stage.getBoundingClientRect();
            const scale = fitScale(sizes, width, height);
            this.#frames.forEach((frame, i) => {
                const [w, h] = sizes[i];
                this.#styleFrame(frame, `width:${w * scale}px;height:${h * scale}px`, `width:${w}px;height:${h}px;transform:scale(${scale});transform-origin:0 0`);
            });
            this.#stage.style.flexDirection = this.#rtl ? 'row-reverse' : 'row'; // the first page on the right for "rtl"
            this.#pagination = ONE_PAGE;
            return;
        }
        const doc = this.#frame.contentDocument;
        if (!doc || !this.#style)
            return;
        if (!this.#bookWritingMode) {
            // What the book says, without our rules. Firefox has no computed style for a document in a
            // hidden frame, and gives "": it is read again at the next layout, when the frame is shown.
            this.#style.textContent = '';
            this.#bookWritingMode = doc.defaultView.getComputedStyle(doc.body ?? doc.documentElement).writingMode;
        }
        const { maxWidth } = this.#options;
        this.#styleFrame(this.#frame, `${FILL};max-width:${maxWidth > 0 ? `${maxWidth}px` : 'none'}`, FILL);
        this.#stage.style.flexDirection = '';
        const { width, height } = this.#frame.getBoundingClientRect();
        this.#pagination = paginate(doc, this.#style, width, height, this.#bookWritingMode, this.#options);
    }
    /** The container or the options have changed. */
    #relayout() {
        const { width, height } = this.#stage.getBoundingClientRect();
        // Nothing is shown yet. Or the container is hidden (it has no size): there is nothing to lay
        // out, and the position must not be lost; this is called again when it is shown.
        // Nor is there after the book has taken the frame elsewhere: the position is kept as well.
        if (this.#index < 0 || !width || !height || this.#emptied)
            return;
        if (this.#pending)
            return this.#place(this.#pending); // shown while the container was hidden: laid out only now
        if (this.#fixed) {
            if (this.#shownWith(this.#index).join() === this.#shown.join()) {
                this.#layout(); // scaled anew
                this.#setPage(0);
            }
            else {
                // The room for a spread has changed: the same page again, with or without its neighbor.
                this.#display(this.#index, {}).catch((error) => this.dispatchEvent(new CustomEvent('error', { detail: { error } })));
            }
            return;
        }
        // The text at the start of the page is found again after the layout: the same share of the
        // section would be a different place. Kept through a series of re-layouts (font size up, up,
        // down, ...), so that they don't drift.
        const doc = this.#frame.contentDocument;
        // Back to the page first: while the container was hidden, the browser may have scrolled the document to its start.
        scrollToPage(doc, this.#pagination, this.#page);
        const anchor = this.#anchor ?? firstText(doc, this.#pagination);
        const progress = this.#page / this.#pagination.pages;
        this.#layout();
        this.#showPage(anchor ? pageOf(doc, this.#pagination, anchor) : Math.round(progress * this.#pagination.pages));
        this.#anchor = anchor;
    }
    #showPage(page) {
        // `|| 0`: a page that is not a number (from a position that is not one) is the first page.
        const shown = Math.min(Math.max(page || 0, 0), this.#pagination.pages - 1);
        if (!this.#fixed)
            scrollToPage(this.#frame.contentDocument, this.#pagination, shown);
        this.#setPage(shown);
    }
    /**
     * The browser scrolls the page by itself for find in page, for the focus moving to a link, and
     * for a selection dragged over the edge. Its position is left alone, as what it shows must stay
     * visible; the page number follows, so that the next page turn continues from there.
     */
    #onScroll = (e) => {
        const doc = e.currentTarget;
        // Not while the container is hidden: the browser then scrolls the document to its start, which is not a move.
        if (this.#index < 0 || doc !== this.#frame.contentDocument || !this.#stage.offsetWidth)
            return;
        const page = scrolledPage(doc, this.#pagination);
        // Not a page that is not there: in a document with dir="rtl", the browser scrolls it to the left of its start.
        if (page !== this.#page && page >= 0 && page < this.#pagination.pages)
            this.#setPage(page);
    };
    #setPage(page) {
        this.#anchor = undefined;
        this.#page = page;
        const sizes = this.#sizes();
        const { pages } = this.#pagination;
        // In a fixed-layout book every section counts as one page; otherwise by the size of the sections.
        const total = sizes.reduce((a, b) => a + b, 0) || 1;
        const before = sizes.slice(0, this.#index).reduce((a, b) => a + b, 0);
        const fraction = this.#fixed
            ? (this.#shown[this.#shown.length - 1] + 1) / sizes.length
            : (before + (sizes[this.#index] * (page + 1)) / pages) / total;
        const detail = { ...this.location, page, pages, fraction, rtl: this.#rtl, indices: [...this.#shown] };
        this.dispatchEvent(new CustomEvent('relocate', { detail }));
    }
}
//# sourceMappingURL=viewer.js.map