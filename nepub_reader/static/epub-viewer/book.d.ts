import { ZipReader } from './zip.ts';
/** Anything `openBook` can read: a File/Blob, raw bytes, or a URL to fetch. */
export type BookSource = Blob | ArrayBuffer | Uint8Array | string | URL;
export interface Metadata {
    /** dc:identifier (may be empty, e.g. for EPUBs made by nepub). */
    identifier: string;
    title: string;
    creator: string;
    language: string;
    /** "pre-paginated": a fixed-layout book, where every section is one page of a fixed size (e.g. manga). */
    layout: 'reflowable' | 'pre-paginated';
    /** The side that pages progress towards: "rtl" for books opened from the right (vertical text, manga). */
    direction: 'ltr' | 'rtl';
}
/** A spine item: one content document, in reading order. */
export interface Section {
    /** Path inside the archive, e.g. "OEBPS/text/ch1.xhtml". */
    href: string;
    /** false for spine items marked linear="no" (skipped by next/prev). */
    linear: boolean;
    /** Uncompressed size in bytes, used to estimate progress through the whole book. */
    size: number;
    /** Fixed layout: the side of a two-page spread that the page belongs on, if the book says. */
    spread?: 'left' | 'right' | 'center';
}
export interface TocItem {
    label: string;
    /** Archive path with optional fragment, e.g. "OEBPS/text/ch1.xhtml#sec2". Pass to `EpubViewer.goTo`. */
    href: string;
    children: TocItem[];
}
/**
 * Resolves `href` relative to the archive path `base`.
 * Returns "path#fragment" inside the archive, or undefined for external URLs (http:, mailto:, data:, ...)
 * and malformed ones.
 */
export declare function resolvePath(href: string, base: string): string | undefined;
export declare function openBook(source: BookSource): Promise<Book>;
export declare class Book {
    #private;
    readonly metadata: Metadata;
    readonly sections: Section[];
    readonly toc: TocItem[];
    /** Use `openBook()` instead of calling this directly. */
    constructor(zip: ZipReader, types: Map<string, string>, metadata: Metadata, sections: Section[], toc: TocItem[], cover?: string);
    /**
     * Cover image, if the book declares one: a bitmap image, or an SVG image (type "image/svg+xml",
     * which can hold scripts: see the README before giving it a blob: URL).
     */
    loadCover(): Promise<Blob | undefined>;
    /**
     * Returns a URL (blob:) for a file in the archive, to use it as an image, a stylesheet or a font.
     * HTML and CSS are rewritten so that their references (images, stylesheets, fonts) also point to
     * such URLs.
     *
     * Files that can hold scripts (e.g. SVG images) get a data: URL instead: see #createUrl.
     */
    getUrl(path: string): Promise<string>;
    /** Revokes all blob: URLs created by this book, and those that are still being made. No more can be had after this. */
    destroy(): void;
}
