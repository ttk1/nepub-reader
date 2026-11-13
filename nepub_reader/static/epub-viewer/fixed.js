/** Size in px of a page that does not say its size. */
const DEFAULT_PAGE_SIZE = [1000, 1414];
/** The size in px that a page is made for: from its viewport meta, or else its SVG or image. */
export function pageSize(doc) {
    const viewport = doc.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '';
    const box = doc.querySelector('svg')?.viewBox?.baseVal; // an "svg" outside of the SVG namespace has none
    const image = doc.querySelector('img');
    const candidates = [
        ['width', 'height'].map((name) => Number(viewport.match(new RegExp(`${name}\\s*=\\s*([\\d.]+)`))?.[1])),
        [box?.width, box?.height],
        [image?.naturalWidth, image?.naturalHeight],
    ];
    return candidates.find(([w, h]) => w > 0 && h > 0) ?? DEFAULT_PAGE_SIZE;
}
/** Whether two pages are shown side by side in a container of this size. */
export function twoPages(width, height, spread) {
    // Pages are mostly portrait, so two of them fit a landscape container.
    return spread === 'auto' ? width > height : spread === 'always';
}
/**
 * The pages (as indices into `sections`) that are shown together, in reading order: one by one,
 * or in pairs where `double` is set. Sections that are not linear are left out.
 */
export function pairPages(sections, direction, double) {
    const pages = sections.flatMap((section, index) => (section.linear ? [index] : []));
    if (!double)
        return pages.map((index) => [index]);
    // The side that the first page of a pair is on, and the side of the second.
    const [first, second] = direction === 'rtl' ? ['right', 'left'] : ['left', 'right'];
    const spreads = [];
    let waiting; // a page on the first side, to be joined by the next one
    for (const index of pages) {
        // Where the book does not say, the first page (the cover) stands alone and the rest go in pairs.
        const side = sections[index].spread ?? (waiting !== undefined ? second : spreads.length ? first : 'center');
        if (side === second && waiting !== undefined) {
            spreads.push([waiting, index]);
            waiting = undefined;
            continue;
        }
        if (waiting !== undefined)
            spreads.push([waiting]);
        waiting = side === first ? index : undefined;
        if (side !== first)
            spreads.push([index]);
    }
    if (waiting !== undefined)
        spreads.push([waiting]);
    return spreads;
}
/** The scale at which pages of these sizes, side by side, fit into `width` × `height`. */
export function fitScale(sizes, width, height) {
    return Math.min(width / sizes.reduce((sum, [w]) => sum + w, 0), height / Math.max(...sizes.map(([, h]) => h)));
}
//# sourceMappingURL=fixed.js.map