import { ZipReader } from './zip.ts';
/** Anything `openBook` can read: a File/Blob, raw bytes, or a URL to fetch. */
export type BookSource = Blob | ArrayBuffer | Uint8Array | string | URL;
export interface Metadata {
    /** dc:identifier (may be empty, e.g. for EPUBs made by nepub). */
    identifier: string;
    title: string;
    creator: string;
    language: string;
}
/** A spine item: one content document, in reading order. */
export interface Section {
    /** Path inside the archive, e.g. "OEBPS/text/ch1.xhtml". */
    href: string;
    /** false for spine items marked linear="no" (skipped by next/prev). */
    linear: boolean;
    /** Uncompressed size in bytes, used to estimate progress through the whole book. */
    size: number;
}
export interface TocItem {
    label: string;
    /** Archive path with optional fragment, e.g. "OEBPS/text/ch1.xhtml#sec2". Pass to `EpubViewer.goTo`. */
    href: string;
    children: TocItem[];
}
/**
 * Resolves `href` relative to the archive path `base`.
 * Returns "path#fragment" inside the archive, or undefined for external URLs (http:, mailto:, data:, ...).
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
    /** Cover image, if the book declares one. */
    loadCover(): Promise<Blob | undefined>;
    /**
     * Returns a blob: URL for a file in the archive. HTML and CSS are rewritten so that
     * their references (images, stylesheets, fonts) also point to blob: URLs.
     */
    getUrl(path: string): Promise<string>;
    /** Revokes all blob: URLs created by this book. */
    destroy(): void;
}
