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
    /** Line height of the text as a multiple of the font size, overriding the book's. 0 keeps the book's (1.6 where it sets none). */
    lineHeight: number;
    /** "auto" follows the book's CSS. */
    writingMode: 'auto' | 'vertical' | 'horizontal';
    /** Page margin in CSS px. */
    margin: number;
    /** Maximum page width in CSS px, centered in the container (0 = full width). Wide lines of text tire the eyes. */
    maxWidth: number;
    /**
     * Two pages side by side: for fixed-layout books (e.g. manga) two pages, for horizontal text two
     * columns. "auto" does so when there is room: a container wider than tall, or wide enough for
     * two columns of text. Vertical text is not affected: its page already uses the whole width.
     */
    spread: 'auto' | 'always' | 'never';
    /**
     * Fixed layout: the side that pages progress towards, "rtl" for a book opened from the right
     * (manga). "auto" follows the book; give it for books that are made without saying.
     */
    direction: 'auto' | 'ltr' | 'rtl';
    /** Turn pages with ←/→, ↑/↓, PageUp/PageDown and Space pressed anywhere in the host window. */
    keyboard: boolean;
    /** Turn pages with clicks / taps on the left and right thirds of the page. Links in the book work either way. */
    click: boolean;
    /** Turn pages with the mouse wheel / trackpad over the viewer: one page per wheel gesture. */
    wheel: boolean;
    /** Turn pages with sideways swipes on touch screens. */
    swipe: boolean;
    /**
     * Page turns by any of these within this many ms of the one before are ignored, so that
     * chattering (e.g. of remote controls) does not skip pages. Keep it short, for fast deliberate presses.
     */
    cooldown: number;
}
export declare const DEFAULT_OPTIONS: ViewerOptions;
