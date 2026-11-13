/**
 * Changes what, in the way that some books are made, would not come out well in pages. Once for a
 * document, before it is laid out.
 */
export function prepare(doc) {
    // A section that begins with an image, e.g. <p><img/></p>: the margins above it, which are not
    // dropped at the start of a section, would push an image as high as the page to the next page,
    // and leave the first one empty.
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
    // An SVG that is told to stretch to its box (the cover page that calibre makes): the box is
    // fitted to the page here, and does not have the shape of the image.
    for (const svg of doc.querySelectorAll('svg[preserveAspectRatio="none"]'))
        svg.removeAttribute('preserveAspectRatio');
}
/**
 * Lays out `doc` in pages of `width` × `height`, by the rules written into `style` (a style
 * element in `doc`). `bookWritingMode` is the writing mode that the book itself declares.
 */
export function paginate(doc, style, width, height, bookWritingMode, options) {
    const { theme, fontFamily, fontSize, lineHeight, margin: m, spread } = options;
    const [w, h] = [Math.floor(width), Math.floor(height)];
    const writingMode = options.writingMode === 'auto' ? bookWritingMode : options.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb';
    const vertical = writingMode.startsWith('vertical');
    const pageSize = vertical ? h : w;
    // Columns per page: two for a spread of horizontal text, when asked for or when there is room
    // for 20em each. With n columns of width c, a page is n × (c + 2m) wide, so that pages still
    // start at multiples of the page size.
    const double = spread === 'auto' ? w - 4 * m >= 40 * fontSize : spread === 'always';
    const columns = !vertical && double ? 2 : 1;
    const columnWidth = (pageSize - 2 * m * columns) / columns;
    // Padding m + column gap 2m makes every page start exactly at a multiple of the page size.
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
      color: ${theme.color} !important;
      /* Not transparent: browsers paint an opaque (white) backdrop behind an iframe whose
         color-scheme differs from the host page's, e.g. a dark host page. */
      background: ${theme.background} !important;
    }
    body {
      writing-mode: ${writingMode} !important;
      margin: 0 !important;
      background: transparent !important;
    }
    ${fontFamily ? `body, body * { font-family: ${fontFamily} !important; }` : ''}
    body :not(a) { color: inherit !important; }
    a:link, a:visited { color: ${theme.link} !important; }
    img, svg, video {
      /* No larger than a page, nor than the room that is left by what they are in (e.g. a <figure>, which has margins). */
      max-width: ${vertical ? `${w - 2 * m}px` : `min(100%, ${columnWidth}px)`} !important;
      max-height: ${vertical ? `min(100%, ${h - 2 * m}px)` : `${h - 2 * m}px`} !important;
      object-fit: contain;
      break-inside: avoid;
    }`;
    const scroller = doc.scrollingElement;
    const scrollSize = vertical ? scroller.scrollHeight : scroller.scrollWidth;
    // Where the content ends. WebKit also counts a column that only holds the margin after the last
    // element as something to scroll to: an empty page at the end of the section.
    const range = doc.createRange();
    range.selectNodeContents(doc.body ?? doc.documentElement);
    const rect = range.getBoundingClientRect();
    const end = vertical ? rect.bottom + scroller.scrollTop : rect.right + scroller.scrollLeft;
    const pages = Math.max(1, Math.ceil((Math.min(scrollSize, end) - m) / pageSize));
    // What can be scrolled ends with the last column: without the padding after it, and in a spread
    // without the second column where there is none. The last page could not be scrolled to as a
    // whole, and was shown shifted. A mark at the end of the last page gives it the room.
    const [along, across] = vertical ? ['top', 'left'] : ['left', 'top'];
    style.textContent += `
    html::after {
      content: '' !important; display: block !important; position: absolute !important;
      ${along}: ${pages * pageSize - 1}px !important; ${across}: 0 !important;
      width: 1px !important; height: 1px !important;
    }`;
    return { writingMode, vertical, pageSize, pages };
}
/** Scrolls to a page (0-based). */
export function scrollToPage(doc, { vertical, pageSize }, page) {
    // Instant, whatever the book says (scroll-behavior: smooth): each step of a smooth scroll would be taken for a page of its own.
    doc.scrollingElement.scrollTo({ left: vertical ? 0 : page * pageSize, top: vertical ? page * pageSize : 0, behavior: 'instant' });
}
/** The page nearest to where the document is scrolled to: the browser may scroll it to a place between pages. */
export function scrolledPage(doc, { vertical, pageSize }) {
    const scroller = doc.scrollingElement;
    return Math.round((vertical ? scroller.scrollTop : scroller.scrollLeft) / pageSize);
}
/** The page that an element or a piece of text is on. */
export function pageOf(doc, { vertical, pageSize }, target) {
    const rect = target.getBoundingClientRect();
    const scroller = doc.scrollingElement;
    return Math.floor((vertical ? rect.top + scroller.scrollTop : rect.left + scroller.scrollLeft) / pageSize);
}
/** The first character of the page shown: what the reader is at, to be found again after a re-layout. */
export function firstText(doc, { vertical, pageSize }) {
    const range = doc.createRange();
    // Pages follow each other along the scroll axis, so text on earlier pages ends before 0.
    // Text that is not rendered (e.g. collapsed white space) has an empty box.
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
        // Binary search for the first character that reaches the page (a paragraph may begin on an earlier page).
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
        // Text that begins on a later page: the current one has none (e.g. a page with only an image).
        const rect = range.getBoundingClientRect();
        return (vertical ? rect.top : rect.left) < pageSize ? range : undefined;
    }
    return undefined;
}
//# sourceMappingURL=reflow.js.map