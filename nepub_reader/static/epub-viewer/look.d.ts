/**
 * The colors and the font of reflowable text. The viewer gives the text those of the theme and of
 * the reader's choice; a book is made for a white page, and for fonts of its own. Here is where
 * the two meet: what of the book is kept as it is, and what of it is changed to be seen.
 */
import type { ViewerOptions } from './options.ts';
/**
 * Finds what the viewer must not give its own colors and font, as it does to the rest of the text.
 * Once for a document, while the rules of the viewer are not in it: what is read is what the book says.
 *
 * - Text on a background that the book gives it. The background stays as it is, and the color of
 *   the theme can be unreadable on it: a heading in white on black became black on black, and
 *   code on light grey could not be read in a dark theme. A mere tint is not such a background.
 * - Code. The font of the reader's choice is for the text; in it, code is not told from the text.
 *
 * And what is drawn for a white page, and lost on a dark one: rules and frames in black (not those
 * on a background of the book, which are seen on it).
 */
export declare function keepBookStyles(doc: Document): void;
/** The rules that give the text the colors of the theme and the font chosen, but for what keepBookStyles() has marked. */
export declare function lookRules({ theme, fontFamily }: ViewerOptions): string;
/**
 * More rules for a page that is dark, once lookRules() are in the document. What the book draws in
 * black for a white page is lost on it: borders take the color of the text, and images of
 * characters are turned to white on black, of which only the white shows.
 */
export declare function darkPageRules(doc: Document): string;
