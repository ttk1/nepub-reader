import { resolvePath } from './book.js';
import { fitScale, pageSize, pairPages, twoPages } from './fixed.js';
import { Input } from './input.js';
import { keepBookStyles } from './look.js';
import { DEFAULT_OPTIONS } from './options.js';
import { firstText, pageOf, paginate, prepare, scrolledPage, scrollToPage } from './reflow.js';
const FILL = 'width:100%;height:100%';
const BLOCKED = 'The page could not be loaded into its frame: the Content-Security-Policy of the host page has to allow frames of blob: URLs';
const ONE_PAGE = { writingMode: '', vertical: false, pageSize: 0, pages: 1 };
export class EpubViewer extends EventTarget {
    #book;
    #container;
    #stage;
    #frames;
    #shown = [];
    #options = { ...DEFAULT_OPTIONS };
    #input;
    #resizeObserver = new ResizeObserver(() => this.#relayout());
    #style;
    #bookWritingMode = 'horizontal-tb';
    #pagination = ONE_PAGE;
    #index = -1;
    #page = 0;
    #anchor;
    #pending;
    #navigation = 0;
    #committed = 0;
    #busy = false;
    #emptied = false;
    #end;
    #destroyed = new Promise((resolve) => (this.#end = resolve));
    constructor(container, options = {}) {
        super();
        this.#container = container;
        this.#stage = container.ownerDocument.createElement('div');
        this.#stage.style.cssText = `position:relative;display:flex;justify-content:center;align-items:center;${FILL}`;
        this.#frames = [this.#createFrame()];
        this.#styleFrame(this.#frame, FILL, FILL);
        container.style.touchAction = 'manipulation';
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
    get book() {
        return this.#book;
    }
    get options() {
        return this.#options;
    }
    get location() {
        return this.#index < 0 ? undefined : { index: this.#index, progress: this.#page / this.#pagination.pages };
    }
    async open(book, target) {
        if (!book.sections.length)
            throw new Error('The book has nothing to show: no XHTML or HTML documents in its spine');
        const before = { book: this.#book, index: this.#index, shown: this.#shown, pending: this.#pending };
        this.#book = book;
        this.#index = -1;
        this.#shown = [];
        this.#pending = undefined;
        this.#committed = ++this.#navigation;
        this.#busy = false;
        const start = { index: Math.max(0, book.sections.findIndex((s) => s.linear)), progress: 0 };
        try {
            await this.goTo(target ?? start);
            if (this.#book === book && this.#index < 0 && !this.#busy)
                await this.goTo(start);
        }
        catch (error) {
            if (this.#book === book && this.#index < 0) {
                ;
                [this.#book, this.#index, this.#shown, this.#pending] = [before.book, before.index, before.shown, before.pending];
            }
            throw error;
        }
    }
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
        this.#committed = ++this.#navigation;
        this.#book = undefined;
        this.#index = -1;
        this.#resizeObserver.disconnect();
        this.#input.destroy();
        this.#stage.remove();
        for (const property of ['touch-action', 'background'])
            this.#container.style.removeProperty(property);
        this.#end();
    }
    get #fixed() {
        return this.#book?.metadata.layout === 'pre-paginated';
    }
    get #rtl() {
        const { direction, writingMode } = this.#options;
        const book = this.#book?.metadata.direction;
        if (this.#fixed)
            return (direction === 'auto' ? book : direction) === 'rtl';
        return this.#pagination.writingMode === 'vertical-rl' || (writingMode === 'auto' && book === 'rtl');
    }
    #spreads() {
        const { width, height } = this.#stage.getBoundingClientRect();
        return pairPages(this.#book.sections, this.#rtl ? 'rtl' : 'ltr', twoPages(width, height, this.#options.spread));
    }
    #shownWith(index) {
        return (this.#fixed && this.#spreads().find((spread) => spread.includes(index))) || [index];
    }
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
    get #frame() {
        return this.#frames[0];
    }
    #createFrame() {
        const iframe = this.#container.ownerDocument.createElement('iframe');
        iframe.title = this.#book?.metadata.title ?? '';
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
        return new Promise((resolve, reject) => {
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
                let doc = null;
                try {
                    doc = iframe.contentDocument;
                }
                catch { }
                if (loaded) {
                    if (doc?.URL !== 'about:blank')
                        leave();
                }
                else if (!doc) {
                    reject(new Error(BLOCKED));
                }
                else if (doc.URL !== 'about:blank') {
                    loaded = true;
                    doc.defaultView.addEventListener('pagehide', (e) => e.persisted || setTimeout(() => iframe.isConnected && leave()));
                    await doc.fonts.ready;
                    resolve(doc);
                }
            });
            iframe.src = url;
        });
    }
    #blocked() {
        const host = this.#container.ownerDocument;
        let onViolation;
        const promise = new Promise((_, reject) => {
            onViolation = (e) => e.effectiveDirective === 'frame-src' && e.blockedURI.startsWith('blob') && reject(new Error(BLOCKED));
        });
        host.addEventListener('securitypolicyviolation', onViolation);
        return { promise, stop: () => host.removeEventListener('securitypolicyviolation', onViolation) };
    }
    #pagesRect() {
        const rects = this.#frames.map((frame) => frame.parentElement.getBoundingClientRect());
        return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
    }
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
    async #seek(fraction) {
        const sizes = this.#sizes();
        const part = Math.min(Math.max(fraction, 0), 1);
        if (this.#fixed)
            return this.#display(Math.max(0, Math.ceil(part * sizes.length - 1e-6) - 1), {});
        const total = sizes.reduce((a, b) => a + b, 0);
        let rest = part * total;
        let index = 0;
        while (index < sizes.length - 1 && (rest > sizes[index] + total * 1e-9 || !sizes[index]))
            rest -= sizes[index++];
        await this.#display(index, { reach: sizes[index] ? rest / sizes[index] : 0 });
    }
    #sizes() {
        return (this.#book?.sections ?? []).map((section) => (section.linear || this.#fixed ? section.size : 0));
    }
    async #display(index, place) {
        const book = this.#book;
        if (!book?.sections[index])
            return;
        const navigation = ++this.#navigation;
        this.#busy = true;
        try {
            const indices = this.#shownWith(index);
            const shown = !this.#emptied && indices.join() === this.#shown.join();
            const urls = shown ? [] : await Promise.all(indices.map((i) => book.getUrl(book.sections[i].href))).catch((error) => error);
            if (navigation < this.#committed)
                return;
            if (urls instanceof Error)
                throw urls;
            this.#committed = navigation;
            if (!shown) {
                const frames = urls.map(() => this.#createFrame());
                const blocked = this.#blocked();
                const docs = await Promise.race([Promise.all(frames.map((frame, i) => this.#loadFrame(frame, urls[i]))), this.#destroyed, blocked.promise])
                    .catch((error) => {
                    for (const frame of frames)
                        frame.parentElement.remove();
                    throw error;
                })
                    .finally(blocked.stop);
                const superseded = this.#committed !== navigation;
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
            const next = this.#neighbor(1);
            for (const i of next === undefined ? [] : this.#shownWith(next))
                book.getUrl(book.sections[i].href).catch(() => { });
        }
        finally {
            if (navigation === this.#navigation)
                this.#busy = false;
        }
    }
    #place(place) {
        const { width, height } = this.#stage.getBoundingClientRect();
        this.#layout();
        this.#pending = this.#fixed || (width && height) ? undefined : place;
        if (this.#pending)
            return;
        const { progress = 0, reach, fragment } = place;
        const target = !this.#fixed && fragment ? this.#frame.contentDocument.getElementById(fragment) : null;
        const { pages } = this.#pagination;
        const page = reach === undefined ? Math.round(progress * pages) : Math.ceil(reach * pages - 1e-6) - 1;
        this.#showPage(target ? pageOf(this.#frame.contentDocument, this.#pagination, target) : page);
    }
    #setup(doc, index) {
        const style = doc.createElement('style');
        (doc.head ?? doc.documentElement).append(style);
        if (this.#fixed) {
            style.textContent = 'html { overflow: hidden !important; touch-action: manipulation !important; }';
        }
        else {
            this.#style = style;
            this.#bookWritingMode = '';
            doc.addEventListener('scroll', this.#onScroll);
            prepare(doc);
        }
        this.#input.attach(doc);
        this.dispatchEvent(new CustomEvent('sectionload', { detail: { index, doc } }));
    }
    #followLink(link, doc) {
        const href = link.trim();
        const from = this.#shown[this.#frames.findIndex((frame) => frame.contentDocument === doc)] ?? this.#index;
        const target = resolvePath(href, this.#book.sections[from].href);
        if (target) {
            this.goTo(target).catch((error) => this.dispatchEvent(new CustomEvent('error', { detail: { error } })));
            return;
        }
        let url;
        try {
            url = new URL(href);
        }
        catch { }
        if (url && ['http:', 'https:', 'mailto:'].includes(url.protocol) && this.dispatchEvent(new CustomEvent('link', { detail: { href: url.href }, cancelable: true }))) {
            this.#container.ownerDocument.defaultView.open(url.href, '_blank', 'noopener');
        }
    }
    #layout() {
        if (this.#fixed) {
            const sizes = this.#frames.map((frame) => pageSize(frame.contentDocument));
            const { width, height } = this.#stage.getBoundingClientRect();
            const scale = fitScale(sizes, width, height);
            this.#frames.forEach((frame, i) => {
                const [w, h] = sizes[i];
                const overlap = i ? `;margin-${this.#rtl ? 'right' : 'left'}:-1px` : '';
                this.#styleFrame(frame, `width:${w * scale}px;height:${h * scale}px${overlap}`, `width:${w}px;height:${h}px;transform:scale(${scale});transform-origin:0 0`);
            });
            this.#stage.style.flexDirection = this.#rtl ? 'row-reverse' : 'row';
            this.#pagination = ONE_PAGE;
            return;
        }
        const doc = this.#frame.contentDocument;
        if (!doc || !this.#style)
            return;
        if (!this.#bookWritingMode) {
            this.#style.textContent = '';
            this.#bookWritingMode = doc.defaultView.getComputedStyle(doc.body ?? doc.documentElement).writingMode;
            if (this.#bookWritingMode)
                keepBookStyles(doc);
        }
        const { maxWidth } = this.#options;
        this.#styleFrame(this.#frame, `${FILL};max-width:${maxWidth > 0 ? `${maxWidth}px` : 'none'}`, FILL);
        this.#stage.style.flexDirection = '';
        const { width, height } = this.#frame.getBoundingClientRect();
        this.#pagination = paginate(doc, this.#style, width, height, this.#bookWritingMode, this.#options);
    }
    #relayout() {
        const { width, height } = this.#stage.getBoundingClientRect();
        if (this.#index < 0 || !width || !height || this.#emptied)
            return;
        if (this.#pending)
            return this.#place(this.#pending);
        if (this.#fixed) {
            if (this.#shownWith(this.#index).join() === this.#shown.join()) {
                this.#layout();
                this.#setPage(0);
            }
            else {
                this.#display(this.#index, {}).catch((error) => this.dispatchEvent(new CustomEvent('error', { detail: { error } })));
            }
            return;
        }
        const doc = this.#frame.contentDocument;
        scrollToPage(doc, this.#pagination, this.#page);
        const anchor = this.#anchor ?? firstText(doc, this.#pagination);
        const progress = this.#page / this.#pagination.pages;
        this.#layout();
        this.#showPage(anchor ? pageOf(doc, this.#pagination, anchor) : Math.round(progress * this.#pagination.pages));
        this.#anchor = anchor;
    }
    #showPage(page) {
        const shown = Math.min(Math.max(page || 0, 0), this.#pagination.pages - 1);
        if (!this.#fixed)
            scrollToPage(this.#frame.contentDocument, this.#pagination, shown);
        this.#setPage(shown);
    }
    #onScroll = (e) => {
        const doc = e.currentTarget;
        if (this.#index < 0 || doc !== this.#frame.contentDocument || !this.#stage.offsetWidth)
            return;
        const page = scrolledPage(doc, this.#pagination);
        if (page !== this.#page && page >= 0 && page < this.#pagination.pages)
            this.#setPage(page);
    };
    #setPage(page) {
        this.#anchor = undefined;
        this.#page = page;
        const sizes = this.#sizes();
        const { pages } = this.#pagination;
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