import type { ViewerOptions } from './options.ts';
/** How a document is split into pages. */
export interface Pagination {
    /** The writing mode used: the book's, or the one given by the options. */
    writingMode: string;
    /** Pages follow each other downwards (vertical text) instead of to the right. */
    vertical: boolean;
    /** The distance in px from one page to the next. */
    pageSize: number;
    pages: number;
}
/**
 * Changes what, in the way that some books are made, would not come out well in pages. Once for a
 * document, before it is laid out.
 */
export declare function prepare(doc: Document): void;
/**
 * Lays out `doc` in pages of `width` × `height`, by the rules written into `style` (a style
 * element in `doc`). `bookWritingMode` is the writing mode that the book itself declares.
 */
export declare function paginate(doc: Document, style: HTMLStyleElement, width: number, height: number, bookWritingMode: string, options: ViewerOptions): Pagination;
/** Scrolls to a page (0-based). */
export declare function scrollToPage(doc: Document, { vertical, pageSize }: Pagination, page: number): void;
/** The page nearest to where the document is scrolled to: the browser may scroll it to a place between pages. */
export declare function scrolledPage(doc: Document, { vertical, pageSize }: Pagination): number;
/** The page that an element or a piece of text is on. */
export declare function pageOf(doc: Document, { vertical, pageSize }: Pagination, target: Element | Range): number;
/** The first character of the page shown: what the reader is at, to be found again after a re-layout. */
export declare function firstText(doc: Document, { vertical, pageSize }: Pagination): Range | undefined;
