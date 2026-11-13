const DEFAULT_PAGE_SIZE = [1000, 1414];
export function pageSize(doc) {
    const viewport = doc.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '';
    const box = doc.querySelector('svg')?.viewBox?.baseVal;
    const image = doc.querySelector('img');
    const candidates = [
        ['width', 'height'].map((name) => Number(viewport.match(new RegExp(`${name}\\s*=\\s*([\\d.]+)`))?.[1])),
        [box?.width, box?.height],
        [image?.naturalWidth, image?.naturalHeight],
    ];
    return candidates.find(([w, h]) => w > 0 && h > 0) ?? DEFAULT_PAGE_SIZE;
}
export function twoPages(width, height, spread) {
    return spread === 'auto' ? width > height : spread === 'always';
}
export function pairPages(sections, direction, double) {
    const pages = sections.flatMap((section, index) => (section.linear ? [index] : []));
    if (!double)
        return pages.map((index) => [index]);
    const [first, second] = direction === 'rtl' ? ['right', 'left'] : ['left', 'right'];
    const spreads = [];
    let waiting;
    for (const index of pages) {
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
export function fitScale(sizes, width, height) {
    return Math.min(width / sizes.reduce((sum, [w]) => sum + w, 0), height / Math.max(...sizes.map(([, h]) => h)));
}
//# sourceMappingURL=fixed.js.map