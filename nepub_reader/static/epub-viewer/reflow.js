import { darkPageRules, lookRules } from './look.js';
export function prepare(doc) {
    const above = [];
    let first = doc.body;
    while (first && !first.matches('img, svg')) {
        above.push(first);
        const content = [...first.childNodes].find((node) => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim());
        first = content?.nodeType === Node.ELEMENT_NODE ? content : null;
    }
    if (first)
        for (const el of above.slice(1))
            el.style.setProperty('margin-block-start', '0', 'important');
    for (const svg of doc.querySelectorAll('svg[preserveAspectRatio="none"]'))
        svg.removeAttribute('preserveAspectRatio');
}
export function paginate(doc, style, width, height, bookWritingMode, options) {
    const { fontSize, lineHeight, margin: m, spread } = options;
    const [w, h] = [Math.floor(width), Math.floor(height)];
    const writingMode = options.writingMode === 'auto' ? bookWritingMode : options.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb';
    const vertical = writingMode.startsWith('vertical');
    const pageSize = vertical ? h : w;
    const double = spread === 'auto' ? w - 4 * m >= 40 * fontSize : spread === 'always';
    const columns = !vertical && double ? 2 : 1;
    const columnWidth = (pageSize - 2 * m * columns) / columns;
    style.textContent = `
    /* Defaults only; the book's own CSS wins. A line longer than a page would run into the
       next page, so break runs without break opportunities (e.g. "……" × 100) where they
       overflow, and wrap preformatted text. */
    html { line-height: 1.6; overflow-wrap: break-word; }
    pre { white-space: pre-wrap; }
    /* On the blocks of text only: the book's line heights of smaller parts stay (e.g. of upright
       numbers in a vertical line, which would otherwise push the lines apart). */
    ${lineHeight ? `html, body, p, div, li, dd, dt, blockquote, td, th { line-height: ${lineHeight} !important; }` : ''}
    html {
      writing-mode: ${writingMode} !important;
      box-sizing: border-box !important;
      width: ${w}px !important;
      height: ${h}px !important;
      margin: 0 !important;
      padding: ${m}px !important;
      column-width: ${columnWidth}px !important;
      column-gap: ${2 * m}px !important;
      column-fill: auto !important;
      overflow: hidden !important;
      scroll-behavior: auto !important; /* page turns are jumps; a smooth one would be read as many */
      /* Quick taps on the side of the page turn pages; they must not zoom in as double taps.
         Panning and pinch zoom stay as they are. */
      touch-action: manipulation !important;
      font-size: ${fontSize}px !important;
    }
    body {
      writing-mode: ${writingMode} !important;
      margin: 0 !important;
    }
    ${lookRules(options)}
    img, svg, video {
      /* No larger than a page, nor than the room that is left by what they are in (e.g. a <figure>, which has margins). */
      max-width: ${vertical ? `${w - 2 * m}px` : `min(100%, ${columnWidth}px)`} !important;
      max-height: ${vertical ? `min(100%, ${h - 2 * m}px)` : `${h - 2 * m}px`} !important;
      object-fit: contain;
      break-inside: avoid;
    }`;
    const scroller = doc.scrollingElement;
    const scrollSize = vertical ? scroller.scrollHeight : scroller.scrollWidth;
    const range = doc.createRange();
    range.selectNodeContents(doc.body ?? doc.documentElement);
    const rect = range.getBoundingClientRect();
    const end = vertical ? rect.bottom + scroller.scrollTop : rect.right + scroller.scrollLeft;
    const pages = Math.max(1, Math.ceil((Math.min(scrollSize, end) - m) / pageSize));
    const [along, across] = vertical ? ['top', 'left'] : ['left', 'top'];
    style.textContent += `${darkPageRules(doc)}
    html::after {
      content: '' !important; display: block !important; position: absolute !important;
      ${along}: ${pages * pageSize - 1}px !important; ${across}: 0 !important;
      width: 1px !important; height: 1px !important;
    }`;
    return { writingMode, vertical, pageSize, pages };
}
export function scrollToPage(doc, { vertical, pageSize }, page) {
    doc.scrollingElement.scrollTo({ left: vertical ? 0 : page * pageSize, top: vertical ? page * pageSize : 0, behavior: 'instant' });
}
export function scrolledPage(doc, { vertical, pageSize }) {
    const scroller = doc.scrollingElement;
    return Math.round((vertical ? scroller.scrollTop : scroller.scrollLeft) / pageSize);
}
export function pageOf(doc, { vertical, pageSize }, target) {
    const rect = target.getBoundingClientRect();
    const scroller = doc.scrollingElement;
    return Math.floor((vertical ? rect.top + scroller.scrollTop : rect.left + scroller.scrollLeft) / pageSize);
}
export function firstText(doc, { vertical, pageSize }) {
    const range = doc.createRange();
    const reaches = (node, end) => {
        range.setStart(node, 0);
        range.setEnd(node, end);
        const rect = range.getBoundingClientRect();
        return (rect.width > 0 || rect.height > 0) && (vertical ? rect.bottom : rect.right) > 0;
    };
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
        if (!reaches(node, node.length))
            continue;
        let [low, high] = [0, node.length - 1];
        while (low < high) {
            const middle = (low + high) >> 1;
            if (reaches(node, middle + 1))
                high = middle;
            else
                low = middle + 1;
        }
        range.setStart(node, low);
        range.setEnd(node, low + 1);
        const rect = range.getBoundingClientRect();
        return (vertical ? rect.top : rect.left) < pageSize ? range : undefined;
    }
    return undefined;
}
//# sourceMappingURL=reflow.js.map