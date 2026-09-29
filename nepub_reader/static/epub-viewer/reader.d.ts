import { type Book, type BookSource } from './book.ts';
import { EpubViewer, type Location, type ViewerOptions } from './viewer.ts';
/** Settings the user changes from the toolbar. Saved in localStorage and shared by all books. */
export interface ReaderSettings {
    /** "system" follows the OS dark mode setting. */
    theme: 'system' | 'light' | 'dark';
    /** "book" keeps the book's own fonts. */
    font: 'mincho' | 'gothic' | 'book';
    fontSize: number;
    /** Page width in px, 0 = full width. */
    maxWidth: number;
    writingMode: ViewerOptions['writingMode'];
}
export interface ReaderOptions {
    /** Prefix of the localStorage keys for settings and reading positions. "" disables saving. */
    storageKey: string;
    /** Initial settings, used until the user changes them. */
    settings: Partial<ReaderSettings>;
    /** Other EpubViewer options (e.g. `keyboard`, `cooldown`). Look-related ones come from the settings. */
    viewer: Partial<ViewerOptions>;
}
export interface OpenOptions {
    /**
     * Key for the saved reading position. Defaults to dc:identifier, then the URL or file name.
     * Give one when books share an identifier, e.g. per-episode EPUBs of the same novel.
     */
    key?: string;
    /** Where to start (a Location or a TocItem href). Overrides the saved position. */
    location?: Location | string;
}
/**
 * A ready-made reader UI: toolbar (table of contents, progress, font size, font, width, writing
 * mode, theme) + EpubViewer, with settings and reading positions saved in localStorage.
 * Add your own controls to `toolbar`, and use `viewer` for events and navigation.
 */
export declare class EpubReader {
    #private;
    /** The toolbar element; add your own buttons or links to it. */
    readonly toolbar: HTMLElement;
    readonly viewer: EpubViewer;
    book?: Book;
    /** `root` must have a height; the reader fills it. */
    constructor(root: HTMLElement, { storageKey, settings, viewer }?: Partial<ReaderOptions>);
    get settings(): Readonly<ReaderSettings>;
    /** Opens a book at `options.location`, the saved position, or the beginning. */
    open(source: BookSource, { key, location }?: OpenOptions): Promise<Book>;
    /** Removes the reader from `root` and releases the book. */
    destroy(): void;
}
