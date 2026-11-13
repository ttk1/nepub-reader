import { ZipReader } from './zip.js';
const BASE = 'https://epub.invalid/';
const XHTML = 'http://www.w3.org/1999/xhtml';
const HTML_TYPES = ['application/xhtml+xml', 'text/html'];
const CSP = "default-src blob: data:; style-src blob: data: 'unsafe-inline'; script-src 'none'; frame-src 'none'; object-src 'none'";
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
        return path;
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
            type: (el.getAttribute('media-type') ?? '').split(';')[0].trim().toLowerCase(),
            properties: (el.getAttribute('properties') ?? '').split(/\s+/),
        },
    ]));
    const itemList = [...items.values()];
    const sections = all(opf, 'itemref').flatMap((el) => {
        const item = items.get(el.getAttribute('idref') ?? '');
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
    const nav = itemList.find((item) => item.properties.includes('nav'));
    const ncx = items.get(first(opf, 'spine')?.getAttribute('toc') ?? '') ?? itemList.find((item) => item.type === 'application/x-dtbncx+xml');
    const readToc = async () => (nav ? parseNav(await readXml(nav.href), nav.href) : ncx ? parseNcx(await readXml(ncx.href), ncx.href) : []);
    const toc = await readToc().catch(() => []);
    const coverId = metas.find((el) => el.getAttribute('name') === 'cover')?.getAttribute('content');
    const cover = itemList.find((item) => item.properties.includes('cover-image')) ?? items.get(coverId ?? '');
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
    #documents;
    #destroyed = false;
    #references = new Map();
    #dataUrlSizes = new Map();
    constructor(zip, types, metadata, sections, toc, cover) {
        this.metadata = metadata;
        this.sections = sections;
        this.toc = toc;
        this.#zip = zip;
        this.#types = types;
        this.#cover = cover;
        this.#documents = new Set(sections.map((section) => section.href));
    }
    async loadCover() {
        const type = this.#types.get(this.#cover ?? '') ?? '';
        if (!this.#cover || !(type === 'image/svg+xml' || (type.startsWith('image/') && INERT_TYPES.test(type))))
            return undefined;
        return this.#zip.read(this.#cover, type);
    }
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
            blob = await this.#rewriteHtml(await blob.text(), path, HTML_TYPES.includes(type) ? type : HTML_TYPES[0]);
        }
        else if (type === 'text/css') {
            blob = textBlob(await this.#rewriteCss(await blob.text(), path), type);
        }
        else if (!INERT_TYPES.test(type)) {
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
        if (doc.querySelector('parsererror') || !(doc.documentElement instanceof HTMLHtmlElement)) {
            type = 'text/html';
            doc = parse(type, source.replace(/<([a-z][\w:.-]*)(\s[^<>]*)?\/>/gi, (tag, name, attrs = '') => (VOID_ELEMENTS.test(name) ? tag : `<${name}${attrs}></${name}>`)));
        }
        protect(doc);
        for (const el of doc.querySelectorAll('[srcset]'))
            el.removeAttribute('srcset');
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
            ...[...doc.querySelectorAll('[style]')].map(async (el) => {
                el.setAttribute('style', await this.#rewriteCss(el.getAttribute('style'), path));
            }),
        ]);
        if (type !== 'text/html')
            return textBlob(new XMLSerializer().serializeToString(doc), type);
        const html = `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
        const safe = BEGINS_WITH_CSP.test(html) && unwanted(parse(type, html)).length === 0;
        return textBlob(safe ? html : `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${CSP}">`, type);
    }
    async #rewriteCss(css, path) {
        css = css
            .replace(/-(?:epub|webkit)-text-combine\s*:\s*horizontal/g, 'text-combine-upright: all')
            .replace(/-webkit-writing-mode/g, 'writing-mode')
            .replace(/-epub-(writing-mode|text-orientation|text-emphasis|word-break|line-break|hyphens)/g, '$1');
        const pattern = /url\(\s*(?:(['"])([^'"()]{1,4000})\1|([^'"()\s]{1,4000}))\s*\)|@import\s+(['"])([^'"]{1,4000})\4/g;
        const urls = await Promise.all([...css.matchAll(pattern)].map((m) => this.#resolveUrl((m[2] ?? m[3] ?? m[5]).trim(), path)));
        let i = 0;
        return css.replace(pattern, (match) => (match.startsWith('@') ? `@import ${cssString(urls[i++])}` : `url(${cssString(urls[i++])})`));
    }
    async #resolveUrl(href, base) {
        const [path, fragment] = resolvePath(href, base)?.split('#') ?? [];
        if (!path || !this.#zip.has(path) || this.#refersTo(path, base))
            return href;
        if (this.#documents.has(path) || HTML_TYPES.includes(this.#types.get(path) ?? ''))
            return href;
        let references = this.#references.get(base);
        if (!references)
            this.#references.set(base, (references = new Set()));
        references.add(path);
        const url = await this.getUrl(path).catch(() => undefined);
        if (!url)
            return href;
        if (url.startsWith('data:')) {
            const size = (this.#dataUrlSizes.get(base) ?? 0) + url.length;
            if (size > MAX_DATA_URLS)
                return href;
            this.#dataUrlSizes.set(base, size);
        }
        return url + (fragment ? `#${fragment}` : '');
    }
    #refersTo(from, target, seen = new Set(), steps = { left: 1000 }) {
        if (from === target)
            return true;
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
function protect(doc) {
    for (const [selector, attribute] of [
        [NAMED_BY_NAME, 'name'],
        ['object', 'id'],
        ['[autofocus]', 'autofocus'],
        ['[contenteditable]', 'contenteditable'],
    ]) {
        for (const el of Document.prototype.querySelectorAll.call(doc, selector))
            Element.prototype.removeAttribute.call(el, attribute);
    }
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
    let head = doc.documentElement.firstElementChild;
    if (!(head instanceof HTMLHeadElement)) {
        head = doc.createElementNS(XHTML, 'head');
        doc.documentElement.prepend(head);
    }
    head.prepend(meta('Content-Security-Policy', CSP), meta('x-dns-prefetch-control', 'off'));
    for (const node of [...doc.childNodes]) {
        if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE)
            node.remove();
    }
    for (const link of doc.querySelectorAll('link')) {
        const rel = relOf(link).filter((kind) => STYLESHEET_RELS.includes(kind));
        if (rel.includes('stylesheet'))
            link.setAttribute('rel', rel.join(' '));
    }
    for (const el of unwanted(doc))
        el.remove();
}
const unwanted = (doc) => [
    ...doc.querySelectorAll('noscript, template'),
    ...[...doc.querySelectorAll('meta[http-equiv]')].filter(isRefresh),
    ...[...doc.querySelectorAll('link')].filter((link) => !isStylesheet(link)),
    ...doc.querySelectorAll(NAMED),
];
const NAMED_BY_NAME = 'embed, form, iframe, img, object';
const NAMED = 'embed[name], form[name], iframe[name], img[name], object[name], object[id]';
const MAX_DATA_URLS = 32 * 2 ** 20;
const cssString = (text) => `"${text.replace(/["\\<\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
const BEGINS_WITH_CSP = /^<!DOCTYPE html><html(?: [^\s"=>]+="[^"]*")*><head><meta http-equiv="Content-Security-Policy" /;
const VOID_ELEMENTS = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
const INERT_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|(font|audio|video)\/[a-z0-9.-]+|application\/(font-[a-z0-9.-]+|x-font-[a-z0-9.-]+|vnd\.ms-opentype))$/;
const STYLESHEET_RELS = ['stylesheet', 'alternate'];
const relOf = (link) => (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const isStylesheet = (link) => relOf(link).includes('stylesheet') && relOf(link).every((kind) => STYLESHEET_RELS.includes(kind));
const isRefresh = (meta) => meta.getAttribute('http-equiv').trim().toLowerCase() === 'refresh';
const textBlob = (text, type) => new Blob(['\uFEFF', text], { type: `${type};charset=utf-8` });
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
        label: text(children(children(point, 'navLabel')[0] ?? point, 'text')[0]),
        href: resolvePath(children(point, 'content')[0]?.getAttribute('src') ?? '', base) ?? '',
        children: points(point),
    }));
    const navMap = first(doc, 'navMap');
    return navMap ? points(navMap) : [];
}
//# sourceMappingURL=book.js.map