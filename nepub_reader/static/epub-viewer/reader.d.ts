import { type Book, type BookSource } from './book.ts';
import { type ViewerOptions } from './options.ts';
import { EpubViewer, type BookTarget } from './viewer.ts';
/** Settings the user changes from the toolbar. Saved (see ReaderOptions.storage) and shared by all books. */
export interface ReaderSettings {
    /** "system" follows the OS dark mode setting. */
    theme: 'system' | 'light' | 'sepia' | 'dark';
    /** "book" keeps the book's own fonts. */
    font: 'mincho' | 'gothic' | 'book';
    fontSize: number;
    /** Line height as a multiple of the font size; 0 keeps the book's own. */
    lineHeight: number;
    /** Page width in px, 0 = full width. */
    maxWidth: number;
    /** Page margin in px. */
    margin: number;
    writingMode: ViewerOptions['writingMode'];
    /** Two pages (fixed layout) or two columns (horizontal text) side by side. */
    spread: ViewerOptions['spread'];
    /** Fixed layout: the side that pages progress towards. */
    direction: ViewerOptions['direction'];
}
export interface ReaderOptions {
    /**
     * Where settings and reading positions are saved: anything with getItem / setItem like
     * localStorage, which is the default. Give an object of your own to keep them elsewhere (e.g. to
     * send them to a server as well), or null to save nothing.
     */
    storage: Pick<Storage, 'getItem' | 'setItem'> | null;
    /** Prefix of the keys in the storage: "<storageKey>:settings" and "<storageKey>:position:<key of the book>". */
    storageKey: string;
    /** Initial settings, used until the user changes them. */
    settings: Partial<ReaderSettings>;
    /** Other EpubViewer options (e.g. `keyboard`, `wheel`, `cooldown`). Look-related ones, the margin among them, come from the settings. */
    viewer: Partial<ViewerOptions>;
}
export interface OpenOptions {
    /**
     * Key for the saved reading position. Defaults to dc:identifier, then the URL or file name, then the title.
     * Give one when books share an identifier, e.g. per-episode EPUBs of the same novel.
     */
    key?: string;
    /** Where to start. Overrides the saved position. */
    location?: BookTarget;
}
/**
 * A ready-made reader UI: toolbar (table of contents, progress with a slider, and a settings menu for font size,
 * font, line height, width, margin, writing mode, spread, direction and theme) + EpubViewer, with settings
 * and reading positions saved in a storage. Add your own controls to `toolbar`, and use `viewer`
 * for events and navigation.
 */
export declare class EpubReader {
    #private;
    /** The toolbar element; add your own buttons or links to it. */
    readonly toolbar: HTMLElement;
    readonly viewer: EpubViewer;
    /** `root` must have a height; the reader fills it. */
    constructor(root: HTMLElement, { storage, storageKey, settings, viewer }?: Partial<ReaderOptions>);
    /** The book being shown. */
    get book(): Book | undefined;
    get settings(): Readonly<ReaderSettings>;
    /**
     * Changes settings, as the toolbar does: for controls of your own. The changes are saved; only
     * changed settings are, so that the rest keeps following the initial settings given by the app.
     */
    setSettings(changes: Partial<ReaderSettings>): void;
    /**
     * Opens a book at `options.location`, the saved position, or the beginning. When called again
     * before the book is ready, the later call wins, and both give the book of the later call.
     */
    open(source: BookSource, options?: OpenOptions): Promise<Book>;
    /** Removes the reader from `root` and releases the book. */
    destroy(): void;
}
