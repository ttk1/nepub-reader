import { type Book } from './book.ts';
export interface Theme {
    background: string;
    color: string;
    link: string;
}
export declare const themes: {
    light: {
        background: string;
        color: string;
        link: string;
    };
    dark: {
        background: string;
        color: string;
        link: string;
    };
    sepia: {
        background: string;
        color: string;
        link: string;
    };
};
/**
 * Font stacks for Japanese text, covering macOS / iOS, Windows, Android and Linux.
 * Meiryo comes after Yu Gothic: its tall line metrics push ruby away from vertical text.
 */
export declare const fonts: {
    mincho: string;
    gothic: string;
};
export interface ViewerOptions {
    theme: Theme;
    /** CSS font-family that overrides the book's fonts, e.g. `fonts.mincho`. "" keeps the book's fonts. */
    fontFamily: string;
    /** Base font size in CSS px. Text sized relatively (em, %) by the book scales with it. */
    fontSize: number;
    /** "auto" follows the book's CSS. */
    writingMode: 'auto' | 'vertical' | 'horizontal';
    /** Page margin in CSS px. */
    margin: number;
    /** Maximum page width in CSS px, centered in the container (0 = full width). Wide lines of text tire the eyes. */
    maxWidth: number;
    /** Turn pages with ←/→, ↑/↓, PageUp/PageDown and Space pressed anywhere in the host window. */
    keyboard: boolean;
    /**
     * Page-turn keys and clicks within this many ms of the previous accepted one are ignored, so that
     * chattering (e.g. remote controls) does not skip pages. Keep it short so fast deliberate presses still work.
     */
    cooldown: number;
}
/** A position that survives re-layout (font size / window size changes). */
export interface Location {
    /** Index into `book.sections`. Negative counts from the end, as in `Array.at()` (-1 = last section). */
    index: number;
    /** Position within the section, 0 (first page) to 1 (last page). */
    progress: number;
}
export interface RelocateDetail extends Location {
    /** 0-based page number within the section. */
    page: number;
    /** Number of pages in the section. */
    pages: number;
    /** Estimated progress through the whole book, (0, 1]; 1 on the last page. */
    fraction: number;
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
    /** A page turn by key or click failed (e.g. a broken section). Calls from code reject instead. */
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
 * Paginated EPUB renderer. Each section is shown in an iframe (scripts disabled) and split into
 * pages with CSS multi-column layout. For vertical text the columns stack downwards, so a page
 * turn is a vertical scroll; for horizontal text it is a horizontal scroll.
 */
export declare class EpubViewer extends EventTarget {
    #private;
    book?: Book;
    /** `container` must have a size (e.g. width/height set by CSS); the viewer fills it. */
    constructor(container: HTMLElement, options?: Partial<ViewerOptions>);
    get options(): Readonly<ViewerOptions>;
    /** Current position, to be saved and passed to `open()` / `goTo()` later. */
    get location(): Location | undefined;
    /** Shows `book` at `location` (a Location or a TocItem href), or at the beginning. */
    open(book: Book, location?: Location | string): Promise<void>;
    goTo(target: Location | string): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    /** Page turn towards the left: next page for right-to-left (vertical) books, previous otherwise. */
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    setOptions(options: Partial<ViewerOptions>): void;
    destroy(): void;
}
