/**
 * Fixed-layout books (e.g. manga): every section is one page of a fixed size. The viewer shows a
 * page in a frame of that size, scaled to fit, and two of them side by side as a spread.
 */
import type { Section } from './book.ts';
import type { ViewerOptions } from './options.ts';
/** The size in px that a page is made for: from its viewport meta, or else its SVG or image. */
export declare function pageSize(doc: Document): number[];
/** Whether two pages are shown side by side in a container of this size. */
export declare function twoPages(width: number, height: number, spread: ViewerOptions['spread']): boolean;
/**
 * The pages (as indices into `sections`) that are shown together, in reading order: one by one,
 * or in pairs where `double` is set. Sections that are not linear are left out.
 */
export declare function pairPages(sections: Section[], direction: 'ltr' | 'rtl', double: boolean): number[][];
/** The scale at which pages of these sizes, side by side, fit into `width` × `height`. */
export declare function fitScale(sizes: number[][], width: number, height: number): number;
