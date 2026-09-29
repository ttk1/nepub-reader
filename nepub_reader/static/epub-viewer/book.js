import { ZipReader } from './zip.js';
const BASE = 'https://epub.invalid/';
const HTML_TYPES = ['application/xhtml+xml', 'text/html'];
// frame-src / object-src: an SVG from the archive embedded with <iframe>/<object>/<embed> is a
// document of its own, same-origin with the host page, and WebKit does not pass this CSP down to it.
const CSP = "default-src blob: data:; style-src blob: data: 'unsafe-inline'; script-src 'none'; frame-src 'none'; object-src 'none'";
/**
 * Resolves `href` relative to the archive path `base`.
 * Returns "path#fragment" inside the archive, or undefined for external URLs (http:, mailto:, data:, ...).
 */
export function resolvePath(href, base) {
    const url = new URL(href, BASE + base.split('/').map(encodeURIComponent).join('/'));
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
            type: el.getAttribute('media-type') ?? '',
            properties: (el.getAttribute('properties') ?? '').split(/\s+/),
        },
    ]));
    const itemList = [...items.values()];
    const sections = all(opf, 'itemref').flatMap((el) => {
        const item = items.get(el.getAttribute('idref') ?? '');
        if (!item)
            return [];
        return [{ href: item.href, linear: el.getAttribute('linear') !== 'no', size: zip.size(item.href) }];
    });
    const uid = first(opf, 'package')?.getAttribute('unique-identifier');
    const identifiers = all(opf, 'identifier');
    const metadata = {
        identifier: text(identifiers.find((el) => el.getAttribute('id') === uid) ?? identifiers[0]),
        title: text(first(opf, 'title')),
        creator: text(first(opf, 'creator')),
        language: text(first(opf, 'language')),
    };
    // EPUB 3 navigation document, falling back to the EPUB 2 NCX.
    const nav = itemList.find((item) => item.properties.includes('nav'));
    const ncx = items.get(first(opf, 'spine')?.getAttribute('toc') ?? '');
    const toc = nav
        ? parseNav(await readXml(nav.href), nav.href)
        : ncx
            ? parseNcx(await readXml(ncx.href), ncx.href)
            : [];
    const coverId = all(opf, 'meta').find((el) => el.getAttribute('name') === 'cover')?.getAttribute('content');
    const cover = itemList.find((item) => item.properties.includes('cover-image')) ?? items.get(coverId ?? '');
    const types = new Map(itemList.map((item) => [item.href, item.type]));
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
    /** Use `openBook()` instead of calling this directly. */
    constructor(zip, types, metadata, sections, toc, cover) {
        this.metadata = metadata;
        this.sections = sections;
        this.toc = toc;
        this.#zip = zip;
        this.#types = types;
        this.#cover = cover;
    }
    /** Cover image, if the book declares one. */
    async loadCover() {
        return this.#cover ? this.#zip.read(this.#cover, this.#types.get(this.#cover)) : undefined;
    }
    /**
     * Returns a blob: URL for a file in the archive. HTML and CSS are rewritten so that
     * their references (images, stylesheets, fonts) also point to blob: URLs.
     */
    getUrl(path) {
        let url = this.#urls.get(path);
        if (!url) {
            url = this.#createUrl(path);
            this.#urls.set(path, url);
        }
        return url;
    }
    /** Revokes all blob: URLs created by this book. */
    destroy() {
        for (const url of this.#urls.values())
            url.then((u) => URL.revokeObjectURL(u), () => { });
        this.#urls.clear();
    }
    async #createUrl(path) {
        const type = this.#types.get(path) ?? '';
        let blob = await this.#zip.read(path, type);
        if (type === 'text/css') {
            blob = new Blob([await this.#rewriteCss(await blob.text(), path)], { type });
        }
        else if (HTML_TYPES.includes(type)) {
            blob = await this.#rewriteHtml(await blob.text(), path, type);
        }
        return URL.createObjectURL(blob);
    }
    async #rewriteHtml(source, path, type) {
        const parse = (t) => new DOMParser().parseFromString(source, t);
        let doc = parse(type);
        if (doc.querySelector('parsererror')) {
            // Broken XHTML is common in the wild; fall back to the forgiving HTML parser.
            type = 'text/html';
            doc = parse(type);
        }
        // Scripts in the book must never run: the viewer iframe needs "allow-scripts" (see viewer.ts),
        // so they are blocked here by CSP. Only resources from the archive (blob:/data:) are loaded.
        const csp = doc.createElementNS('http://www.w3.org/1999/xhtml', 'meta');
        csp.setAttribute('http-equiv', 'Content-Security-Policy');
        csp.setAttribute('content', CSP);
        (doc.head ?? doc.documentElement).prepend(csp);
        // CSP does not cover <meta http-equiv="refresh">, which could navigate the page anywhere.
        for (const el of doc.querySelectorAll('meta[http-equiv]')) {
            if (el.getAttribute('http-equiv').toLowerCase() === 'refresh')
                el.remove();
        }
        const targets = [
            ['[src]', 'src'],
            ['[poster]', 'poster'],
            ['link[href]', 'href'],
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
        ]);
        const html = type === 'text/html'
            ? `<!DOCTYPE html>${doc.documentElement.outerHTML}`
            : new XMLSerializer().serializeToString(doc);
        return new Blob([html], { type });
    }
    async #rewriteCss(css, path) {
        // Old EPUBs often use only the -epub- prefixed properties, which browsers ignore.
        css = css
            .replace(/-epub-text-combine\s*:\s*horizontal/g, 'text-combine-upright: all')
            .replace(/-epub-(writing-mode|text-orientation|text-emphasis|word-break|line-break|hyphens)/g, '$1');
        const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g;
        const urls = await Promise.all([...css.matchAll(pattern)].map((m) => this.#resolveUrl((m[2] ?? m[4]).trim(), path)));
        let i = 0;
        return css.replace(pattern, (_, quote) => (quote === undefined ? `@import "${urls[i++]}"` : `url("${urls[i++]}")`));
    }
    /** Converts a reference found in the file at `base` into a blob: URL (external URLs are kept as-is). */
    async #resolveUrl(href, base) {
        const path = resolvePath(href, base)?.split('#')[0];
        return path && this.#zip.has(path) ? this.getUrl(path) : href;
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
        label: text(first(point, 'text')),
        href: resolvePath(first(point, 'content')?.getAttribute('src') ?? '', base) ?? '',
        children: points(point),
    }));
    const navMap = first(doc, 'navMap');
    return navMap ? points(navMap) : [];
}
//# sourceMappingURL=book.js.map