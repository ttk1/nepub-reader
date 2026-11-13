/**
 * User input: keys, clicks, the mouse wheel and touches are turned into page turns here. Each kind
 * can be turned off by an option of the viewer, for apps that handle it themselves.
 */
import type { ViewerOptions } from './options.ts';
/** What the input needs of the viewer. */
export interface InputHost {
    /** The options of the viewer: the same object for its whole life, changed in place. */
    readonly options: Readonly<ViewerOptions>;
    next(): Promise<void>;
    prev(): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    /** Whether a page of the book is shown: not while the first page of a book just opened is loading. */
    shown(): boolean;
    /** The area of the page(s) on the screen, without the empty sides. */
    pagesRect(): {
        left: number;
        right: number;
    };
    /** A link in the document `doc` of the book was clicked. */
    followLink(href: string, doc: Document): void;
    dispatchEvent(event: Event): boolean;
}
export declare class Input {
    #private;
    constructor(container: HTMLElement, stage: HTMLElement, host: InputHost);
    /**
     * Listens in a document of the book as well: what happens over the page stays in its iframe,
     * and does not reach the container or the host window.
     */
    attach(doc: Document): void;
    destroy(): void;
}
