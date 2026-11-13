import { ZipReader } from './zip.js';
const BASE = 'https://epub.invalid/';
const XHTML = 'http://www.w3.org/1999/xhtml';
const HTML_TYPES = ['application/xhtml+xml', 'text/html'];
// frame-src / object-src: an SVG from the archive embedded with <iframe>/<object>/<embed> is a
// document of its own, same-origin with the host page, and WebKit does not pass this CSP down to it.
const CSP = "default-src blob: data:; style-src blob: data: 'unsafe-inline'; script-src 'none'; frame-src 'none'; object-src 'none'";
/**
 * Resolves `href` relative to the archive path `base`.
 * Returns "path#fragment" inside the archive, or undefined for external URLs (http:, mailto:, data:, ...)
 * and malformed ones.
 */
export function resolvePath(href, base) {
    let url;
    try {
        url = new URL(href, BASE + base.split('/').map(encodeURIComponent).join('/'));
    }
    catch {
        return undefined;
    }
    if (!url.href.startsWith(BASE))
        return undefined;
    const path = url.pathname.slice(1) + url.hash;
    try {
        return decodeURIComponent(path);
    }
    catch {
        return path; // malformed escape such as a literal "%" in a file name
    }
}
export async function openBook(source) {
    const zip = await ZipReader.open(await toBlob(source));
    const readXml = async (path) => parseXml(await (await zip.read(path)).text());
    const container = await readXml('META-INF/container.xml');
    const opfPath = first(container, 'rootfile')?.getAttribute('full-path');
    if (!opfPath)
        throw new Error('rootfile not found in META-INF/container.xml');
    const opf = await readXml(opfPath);
    const items = new Map(all(opf, 'item').map((el) => [
        el.getAttribute('id') ?? '',
        {
            href: resolvePath(el.getAttribute('href') ?? '', opfPath) ?? '',
            // Without parameters ("; charset=..."), so that the kinds of files are told apart reliably.
            type: (el.getAttribute('media-type') ?? '').split(';')[0].trim().toLowerCase(),
            properties: (el.getAttribute('properties') ?? '').split(/\s+/),
        },
    ]));
    const itemList = [...items.values()];
    const sections = all(opf, 'itemref').flatMap((el) => {
        const item = items.get(el.getAttribute('idref') ?? '');
        // Only (X)HTML: other documents (e.g. SVG) cannot carry the CSP that blocks their scripts.
        if (!item || !HTML_TYPES.includes(item.type))
            return [];
        const spread = el.getAttribute('properties')?.match(/page-spread-(left|right|center)/)?.[1];
        return [{ href: item.href, linear: el.getAttribute('linear') !== 'no', size: zip.size(item.href), spread }];
    });
    const metas = all(opf, 'meta');
    const uid = first(opf, 'package')?.getAttribute('unique-identifier');
    const identifiers = all(opf, 'identifier');
    const metadata = {
        identifier: text(identifiers.find((el) => el.getAttribute('id') === uid) ?? identifiers[0]),
        title: text(first(opf, 'title')),
        creator: text(first(opf, 'creator')),
        language: text(first(opf, 'language')),
        layout: metas.some((el) => el.getAttribute('property') === 'rendition:layout' && text(el) === 'pre-paginated')
            ? 'pre-paginated'
            : 'reflowable',
        direction: first(opf, 'spine')?.getAttribute('page-progression-direction') === 'rtl' ? 'rtl' : 'ltr',
    };
    // EPUB 3 navigation document, falling back to the EPUB 2 NCX.
    const nav = itemList.find((item) => item.properties.includes('nav'));
    // Where the spine does not name the NCX (it should), the one in the manifest.
    const ncx = items.get(first(opf, 'spine')?.getAttribute('toc') ?? '') ?? itemList.find((item) => item.type === 'application/x-dtbncx+xml');
    const readToc = async () => (nav ? parseNav(await readXml(nav.href), nav.href) : ncx ? parseNcx(await readXml(ncx.href), ncx.href) : []);
    // A book whose table of contents cannot be read (e.g. its file is missing) can still be read.
    const toc = await readToc().catch(() => []);
    const coverId = metas.find((el) => el.getAttribute('name') === 'cover')?.getAttribute('content');
    const cover = itemList.find((item) => item.properties.includes('cover-image')) ?? items.get(coverId ?? '');
    // A file listed more than once keeps the type of its first item.
    const types = new Map(itemList.reverse().map((item) => [item.href, item.type]));
    return new Book(zip, types, metadata, sections, toc, cover?.href);
}
export class Book {
    metadata;
    sections;
    toc;
    #zip;
    #types;
    #cover;
    #urls = new Map();
    /** The files shown as documents (the sections). */
    #documents;
    #destroyed = false;
    /** For each file being rewritten, the files that it refers to: their URLs go into its own. */
    #references = new Map();
    /** For each file being rewritten, the length of the data: URLs put into it so far. */
    #dataUrlSizes = new Map();
    /** Use `openBook()` instead of calling this directly. */
    constructor(zip, types, metadata, sections, toc, cover) {
        this.metadata = metadata;
        this.sections = sections;
        this.toc = toc;
        this.#zip = zip;
        this.#types = types;
        this.#cover = cover;
        this.#documents = new Set(sections.map((section) => section.href));
    }
    /**
     * Cover image, if the book declares one: a bitmap image, or an SVG image (type "image/svg+xml",
     * which can hold scripts: see the README before giving it a blob: URL).
     */
    async loadCover() {
        const type = this.#types.get(this.#cover ?? '') ?? '';
        // Images only. A "cover" of another type, or of none, can be an HTML document: with the blob:
        // URL that an app would give it, it runs as the app when the reader opens it in a tab of its own.
        if (!this.#cover || !(type === 'image/svg+xml' || (type.startsWith('image/') && INERT_TYPES.test(type))))
            return undefined;
        return this.#zip.read(this.#cover, type);
    }
    /**
     * Returns a URL (blob:) for a file in the archive, to use it as an image, a style sheet or a font. HTML and CSS are rewritten so that
     * their references (images, stylesheets, fonts) also point to blob: URLs.
     *
     * Files that can hold scripts (e.g. SVG images) get a data: URL instead: see #createUrl.
     */
    getUrl(path) {
        if (this.#destroyed)
            return Promise.reject(new Error('The book has been closed'));
        let url = this.#urls.get(path);
        if (!url) {
            url = this.#createUrl(path);
            this.#urls.set(path, url);
        }
        return url;
    }
    /** Revokes all blob: URLs created by this book, and those that are still being made. No more can be had after this. */
    destroy() {
        this.#destroyed = true;
        for (const url of this.#urls.values())
            url.then((u) => URL.revokeObjectURL(u), () => { });
        this.#urls.clear();
    }
    async #createUrl(path) {
        const type = this.#types.get(path) ?? '';
        let blob = await this.#zip.read(path, type);
        if (this.#documents.has(path) || HTML_TYPES.includes(type)) {
            // A section is rewritten whatever the manifest calls it elsewhere: a file can be listed
            // twice, as a document and as something else. Shown as it is, its scripts would run.
            blob = await this.#rewriteHtml(await blob.text(), path, HTML_TYPES.includes(type) ? type : HTML_TYPES[0]);
        }
        else if (type === 'text/css') {
            blob = textBlob(await this.#rewriteCss(await blob.text(), path), type);
        }
        else if (!INERT_TYPES.test(type)) {
            // A blob: URL has the origin of the page. The reader can open any file of the book as a page
            // of its own (e.g. "open image in new tab"), where the scripts of an SVG would run with that
            // origin. So only rewritten files and those that cannot hold scripts get one, and the rest
            // a data: URL, which has an origin of its own.
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            await new Promise((resolve, reject) => Object.assign(reader, { onload: resolve, onerror: reject }));
            return reader.result;
        }
        const url = URL.createObjectURL(blob);
        if (this.#destroyed)
            URL.revokeObjectURL(url);
        return url;
    }
    async #rewriteHtml(source, path, type) {
        const parse = (t, text = source) => new DOMParser().parseFromString(text, t);
        let doc = parse(type);
        // Broken XHTML is common in the wild; fall back to the forgiving HTML parser. Likewise for a root
        // other than <html> (e.g. <svg>), where the CSP below would have no effect: the HTML parser puts it in a body.
        if (doc.querySelector('parsererror') || !(doc.documentElement instanceof HTMLHtmlElement)) {
            type = 'text/html';
            // Empty elements written the XML way, e.g. <title/>, are not closed in HTML: the rest of the
            // document would be their content, and nothing of it shown.
            doc = parse(type, source.replace(/<([a-z][\w:.-]*)(\s[^<>]*)?\/>/gi, (tag, name, attrs = '') => (VOID_ELEMENTS.test(name) ? tag : `<${name}${attrs}></${name}>`)));
        }
        protect(doc);
        // References to other files of the book are replaced by the URLs of those files.
        // The images in srcset would not be found (they are relative to a blob: URL now), and browsers
        // do not fall back to src then. So only src, which is rewritten below, is kept.
        for (const el of doc.querySelectorAll('[srcset]'))
            el.removeAttribute('srcset');
        const targets = [
            ['[src]', 'src'],
            ['[poster]', 'poster'],
            ['link[href]', 'href'], // stylesheets only (see protect): not rel="next" and the like, which would pull in the whole book
            ['image', 'href'],
            ['image', 'xlink:href'],
        ];
        await Promise.all([
            ...targets.flatMap(([selector, attr]) => [...doc.querySelectorAll(selector)].map(async (el) => {
                const value = el.getAttribute(attr);
                if (value)
                    el.setAttribute(attr, await this.#resolveUrl(value, path));
            })),
            ...[...doc.querySelectorAll('style')].map(async (el) => {
                el.textContent = await this.#rewriteCss(el.textContent ?? '', path);
            }),
            ...[...doc.querySelectorAll('[style]')].map(async (el) => {
                el.setAttribute('style', await this.#rewriteCss(el.getAttribute('style'), path));
            }),
        ]);
        if (type !== 'text/html')
            return textBlob(new XMLSerializer().serializeToString(doc), type);
        const html = `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
        // HTML does not always read back as it was written: text or a comment can come back as an
        // element (e.g. a <meta> that takes the page elsewhere). Nothing is shown of a document in
        // which something that protect() removed is there again. Nor of one that does not begin with
        // the CSP, which is all that stops its scripts: looked for in the text itself, as the browser
        // will read it, and not in a document, whose properties a book can replace (see NAMED).
        const safe = BEGINS_WITH_CSP.test(html) && unwanted(parse(type, html)).length === 0;
        return textBlob(safe ? html : `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${CSP}">`, type);
    }
    async #rewriteCss(css, path) {
        // Old EPUBs often use only the -epub- prefixed properties, which browsers ignore; others only
        // the -webkit- ones, which Firefox does not know for vertical text.
        css = css
            .replace(/-(?:epub|webkit)-text-combine\s*:\s*horizontal/g, 'text-combine-upright: all')
            .replace(/-webkit-writing-mode/g, 'writing-mode')
            .replace(/-epub-(writing-mode|text-orientation|text-emphasis|word-break|line-break|hyphens)/g, '$1');
        // No "(" in a URL, and a limit on its length: without them, a long run of "url(" without
        // an end takes this a time that grows with the square of its length.
        // Nor white space in a URL without quotes (there is none in CSS): a run of spaces could be
        // matched both as the URL and as the space around it, in as many ways as it is long.
        const pattern = /url\(\s*(?:(['"])([^'"()]{1,4000})\1|([^'"()\s]{1,4000}))\s*\)|@import\s+(['"])([^'"]{1,4000})\4/g;
        const urls = await Promise.all([...css.matchAll(pattern)].map((m) => this.#resolveUrl((m[2] ?? m[3] ?? m[5]).trim(), path)));
        let i = 0;
        return css.replace(pattern, (match) => (match.startsWith('@') ? `@import ${cssString(urls[i++])}` : `url(${cssString(urls[i++])})`));
    }
    /** Converts a reference found in the file at `base` into a blob: URL (external URLs are kept as-is). */
    async #resolveUrl(href, base) {
        const [path, fragment] = resolvePath(href, base)?.split('#') ?? [];
        // A reference back to the file itself is kept as it is, be it direct, e.g. url(#gradient), or
        // through other files, e.g. stylesheets that import each other: the URL of this file would have
        // to be known before it can be made, and waiting for it would never end.
        if (!path || !this.#zip.has(path) || this.#refersTo(path, base))
            return href;
        // Nor a document (e.g. <img src="chapter2.xhtml">): it is not shown there (the CSP closes
        // frames), and documents that refer to each other in a chain were all rewritten for the first.
        if (this.#documents.has(path) || HTML_TYPES.includes(this.#types.get(path) ?? ''))
            return href;
        let references = this.#references.get(base);
        if (!references)
            this.#references.set(base, (references = new Set()));
        references.add(path);
        // A file that cannot be read is left out (e.g. an image shows as broken); the rest is still shown.
        const url = await this.getUrl(path).catch(() => undefined);
        if (!url)
            return href;
        // A data: URL is the whole file, again for every reference to it: a book of a few kilobytes
        // that refers to an SVG a thousand times made a document of hundreds of megabytes. Past a
        // size, such references are left out as well.
        if (url.startsWith('data:')) {
            const size = (this.#dataUrlSizes.get(base) ?? 0) + url.length;
            if (size > MAX_DATA_URLS)
                return href;
            this.#dataUrlSizes.set(base, size);
        }
        return url + (fragment ? `#${fragment}` : '');
    }
    /** Whether `from` is `target`, or refers to it through the references found so far. */
    #refersTo(from, target, seen = new Set(), steps = { left: 1000 }) {
        if (from === target)
            return true;
        // A search can go through all the references found so far, and there is one for every
        // reference: hundreds of stylesheets that each import all the others (no book has that,
        // unless made to) took many seconds. A search that does not end within a number of steps,
        // far more than a book needs, is taken as having found a reference back (it is not loaded).
        if (--steps.left < 0)
            return true;
        if (seen.has(from))
            return false;
        seen.add(from);
        for (const path of this.#references.get(from) ?? [])
            if (this.#refersTo(path, target, seen, steps))
                return true;
        return false;
    }
}
async function toBlob(source) {
    if (source instanceof Blob)
        return source;
    if (typeof source === 'string' || source instanceof URL) {
        const res = await fetch(source);
        if (!res.ok)
            throw new Error(`Failed to fetch ${source}: ${res.status}`);
        return res.blob();
    }
    return new Blob([source]);
}
function parseXml(source) {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    return doc.querySelector('parsererror') ? new DOMParser().parseFromString(source, 'text/html') : doc;
}
/**
 * Makes a document of the book safe to show in a frame that has the origin of the host page: its
 * scripts must never run, it must not take the frame elsewhere, and it must not reach other servers.
 */
function protect(doc) {
    // First of all, and without the properties of the document, which may be elements until then (see NAMED).
    for (const [selector, attribute] of [
        [NAMED_BY_NAME, 'name'],
        ['object', 'id'],
        // Takes the focus from the host page, and scrolls it, whenever the section is shown (WebKit).
        ['[autofocus]', 'autofocus'],
        // Keys in the page would edit it instead of turning the page.
        ['[contenteditable]', 'contenteditable'],
    ]) {
        for (const el of Document.prototype.querySelectorAll.call(doc, selector))
            Element.prototype.removeAttribute.call(el, attribute);
    }
    // A CSP of the book's own would apply as well as ours: one without 'unsafe-inline' for styles
    // stops those of the viewer, and the text is not split into pages.
    for (const el of doc.querySelectorAll('meta[http-equiv]')) {
        if (el.getAttribute('http-equiv').trim().toLowerCase() === 'content-security-policy')
            el.remove();
    }
    const meta = (name, content) => {
        const el = doc.createElementNS(XHTML, 'meta');
        el.setAttribute('http-equiv', name);
        el.setAttribute('content', content);
        return el;
    };
    // The CSP only works inside <head>, and only on what comes after it: XHTML may have no <head>,
    // or a <script> before it.
    let head = doc.documentElement.firstElementChild;
    if (!(head instanceof HTMLHeadElement)) {
        head = doc.createElementNS(XHTML, 'head');
        doc.documentElement.prepend(head);
    }
    head.prepend(
    // The viewer's frame needs "allow-scripts" (see viewer.ts), so scripts are blocked by CSP.
    // Only resources from the archive (blob: / data:) are loaded.
    meta('Content-Security-Policy', CSP), 
    // Firefox looks up the host names of the links in a page ahead of time, also in a blob:
    // document of an https: page (where it would not for the page itself). With names made up for
    // it, a book could learn who reads it, and when. Once off, the book cannot turn this on again.
    meta('x-dns-prefetch-control', 'off'));
    // <?xml-stylesheet?>: an XSLT stylesheet would replace the document with one that has no CSP.
    for (const node of [...doc.childNodes]) {
        if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE)
            node.remove();
    }
    // A stylesheet is nothing else as well (rel="stylesheet preconnect"): see unwanted().
    for (const link of doc.querySelectorAll('link')) {
        const rel = relOf(link).filter((kind) => STYLESHEET_RELS.includes(kind));
        if (rel.includes('stylesheet'))
            link.setAttribute('rel', rel.join(' '));
    }
    for (const el of unwanted(doc))
        el.remove();
}
/** The elements that must not be in a document that is shown. */
const unwanted = (doc) => [
    // Not the same when a document is rewritten (scripts are off) and when it is shown (scripts are
    // "on", only blocked), so that what is inside them escapes the rewriting: <noscript> is text
    // when shown, and a <template> can become a shadow root.
    ...doc.querySelectorAll('noscript, template'),
    // Not covered by the CSP: takes the page anywhere.
    ...[...doc.querySelectorAll('meta[http-equiv]')].filter(isRefresh),
    // A <link> is a stylesheet and nothing else: other kinds have no use in a book, but can name a
    // server for the browser to connect to ahead of time (rel="preconnect"), which the CSP does not
    // stop in WebKit.
    ...[...doc.querySelectorAll('link')].filter((link) => !isStylesheet(link)),
    // Named after a property of the document (see NAMED): protect() takes their names off.
    ...doc.querySelectorAll(NAMED),
];
/**
 * In an HTML document (and in Firefox, also in XHTML), these elements are properties of the
 * document by their names, over those of the document itself: with <img name="documentElement">,
 * `doc.documentElement` is the image. The rewriting here, and the viewer, rely on those properties.
 */
const NAMED_BY_NAME = 'embed, form, iframe, img, object';
const NAMED = 'embed[name], form[name], iframe[name], img[name], object[name], object[id]';
/** The most of data: URLs (in characters) that one file is given: far more than books have (e.g. an SVG icon of 50 KB, 200 times: 14 MB). */
const MAX_DATA_URLS = 32 * 2 ** 20;
/**
 * `text` as a CSS string. What would end the string, or the <style> element that it is in, is
 * escaped: a URL can hold anything, as its fragment is decoded ("#%3C/style%3E"), and so can the
 * media type of a data: URL.
 */
const cssString = (text) => `"${text.replace(/["\\<\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
/** An HTML document as it is written out by #rewriteHtml: <html> (with attributes), <head>, and the CSP first in it. */
const BEGINS_WITH_CSP = /^<!DOCTYPE html><html(?: [^\s"=>]+="[^"]*")*><head><meta http-equiv="Content-Security-Policy" /;
/** The elements that have no end tag in HTML. */
const VOID_ELEMENTS = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
/** Types of files that cannot hold scripts, whatever is in them: bitmap images, fonts, audio and video. */
// The whole type must match: of "image/png,text/html", browsers take the part after the comma.
const INERT_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|(font|audio|video)\/[a-z0-9.-]+|application\/(font-[a-z0-9.-]+|x-font-[a-z0-9.-]+|vnd\.ms-opentype))$/;
/** What the rel of a <link> may hold. */
const STYLESHEET_RELS = ['stylesheet', 'alternate'];
const relOf = (link) => (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const isStylesheet = (link) => relOf(link).includes('stylesheet') && relOf(link).every((kind) => STYLESHEET_RELS.includes(kind));
const isRefresh = (meta) => meta.getAttribute('http-equiv').trim().toLowerCase() === 'refresh';
/**
 * A file of rewritten text. Marked as UTF-8 by a byte order mark, which browsers take over what
 * the text says about itself: a document that declares another encoding (e.g. <meta charset>)
 * would otherwise be read in that one, and not be the document that was rewritten. In ISO-2022-JP,
 * for one, escape sequences can make the CSP <meta> part of an attribute, and so remove it.
 */
const textBlob = (text, type) => new Blob(['\uFEFF', text], { type: `${type};charset=utf-8` });
// Namespace-agnostic helpers (OPF/NCX/XHTML use various prefixes).
const all = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const first = (node, name) => all(node, name)[0];
const children = (el, name) => [...el.children].filter((c) => c.localName === name);
const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
function parseNav(doc, base) {
    const navs = all(doc, 'nav');
    const type = (el) => el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? el.getAttribute('epub:type');
    const nav = navs.find((el) => type(el)?.split(/\s+/).includes('toc')) ?? navs[0];
    const list = (ol) => children(ol, 'li').map((li) => {
        const label = children(li, 'a')[0] ?? children(li, 'span')[0];
        const href = label?.getAttribute('href');
        const sub = children(li, 'ol')[0];
        return {
            label: text(label),
            href: href ? (resolvePath(href, base) ?? '') : '',
            children: sub ? list(sub) : [],
        };
    });
    const ol = nav && children(nav, 'ol')[0];
    return ol ? list(ol) : [];
}
function parseNcx(doc, base) {
    const points = (parent) => children(parent, 'navPoint').map((point) => ({
        // Children only: a search through all that is under the entry would go through the entries
        // under it as well, again for each of them (a deep table of contents took many seconds).
        label: text(children(children(point, 'navLabel')[0] ?? point, 'text')[0]),
        href: resolvePath(children(point, 'content')[0]?.getAttribute('src') ?? '', base) ?? '',
        children: points(point),
    }));
    const navMap = first(doc, 'navMap');
    return navMap ? points(navMap) : [];
}
//# sourceMappingURL=book.js.map