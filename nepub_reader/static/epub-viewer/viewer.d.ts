import { type Book } from './book.ts';
import { type ViewerOptions } from './options.ts';
/** A position in a book that survives re-layout (font size / window size changes). */
export interface BookLocation {
    /** Index into `book.sections`. Negative counts from the end, as in `Array.at()` (-1 = last section). */
    index: number;
    /**
     * Position within the section: the share of it that comes before the page. 0 is the first page;
     * the last page of n is (n - 1) / n when read, and 1 is also taken for it when given.
     */
    progress: number;
}
/** Where to go: a BookLocation, a TocItem href, or a position in the whole book (the `fraction` of the relocate event, 0 to 1). */
export type BookTarget = BookLocation | string | {
    fraction: number;
};
export interface RelocateDetail extends BookLocation {
    /** 0-based page number within the section. */
    page: number;
    /** Number of pages in the section. A page of a fixed-layout book is a section of its own, of one page. */
    pages: number;
    /** Estimated progress through the whole book, up to the end of the page: 1 on the last page. `goTo({ fraction })` leads back here. */
    fraction: number;
    /** Pages progress to the left (vertical text, and books opened from the right such as manga): goLeft() is next(). For the direction of a slider or of buttons. */
    rtl: boolean;
    /** The sections on the screen: one, or the two pages of a spread of a fixed-layout book (`index` is the first). */
    indices: number[];
}
export interface EpubViewerEventMap {
    /** The displayed page changed. */
    relocate: CustomEvent<RelocateDetail>;
    /** next() was called on the last page of the book. */
    bookend: Event;
    /** prev() was called on the first page of the book. */
    bookstart: Event;
    /** A section document was loaded, before layout. Use it to inject styles or listeners. */
    sectionload: CustomEvent<{
        index: number;
        doc: Document;
    }>;
    /** An external http(s): / mailto: link was clicked. Call preventDefault() to stop it from opening in a new tab. */
    link: CustomEvent<{
        href: string;
    }>;
    /**
     * A click or tap on the page that neither follows a link nor turns the page: on the middle of the
     * page, or anywhere with the `click` option off. `x` is the position across the page(s), from
     * 0 (left edge) to 1. For showing and hiding controls, or page turns of your own.
     */
    tap: CustomEvent<{
        x: number;
    }>;
    /**
     * A page turn by key, click, wheel or swipe, or a link in the book, failed (e.g. a broken section).
     * Calls from code reject instead. Also when the book tried to take its page elsewhere: that page is not shown.
     */
    error: CustomEvent<{
        error: unknown;
    }>;
}
export interface EpubViewer {
    addEventListener<K extends keyof EpubViewerEventMap>(type: K, listener: (event: EpubViewerEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    removeEventListener<K extends keyof EpubViewerEventMap>(type: K, listener: (event: EpubViewerEventMap[K]) => void, options?: boolean | EventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}
/**
 * Shows a book page by page, in iframes (scripts disabled). The text of a reflowable book is
 * split into pages (see reflow.ts); the pages of a fixed-layout book are shown as they are, scaled
 * to fit, one or two at a time (see fixed.ts). User input is handled in input.ts.
 *
 * This class keeps what is shown: the frames, the position, and the navigations between them.
 */
export declare class EpubViewer extends EventTarget {
    #private;
    /** `container` must have a size (e.g. width/height set by CSS); the viewer fills it. */
    constructor(container: HTMLElement, options?: Partial<ViewerOptions>);
    /** The book being shown. */
    get book(): Book | undefined;
    get options(): Readonly<ViewerOptions>;
    /** Current position, to be saved and passed to `open()` / `goTo()` later. */
    get location(): BookLocation | undefined;
    /** Shows `book` at `target`, or at the beginning. The Book shown before is not destroyed. */
    open(book: Book, target?: BookTarget): Promise<void>;
    /** Moves to `target`. Does nothing if that is not in the book. */
    goTo(target: BookTarget): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    /** Page turn towards the left: the next page for a book read from right to left (vertical text, manga), the previous one otherwise. */
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    setOptions(options: Partial<ViewerOptions>): void;
    destroy(): void;
}
