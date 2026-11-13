const OWN_COLORS = 'data-epub-viewer-colors';
const OWN_FONT = 'data-epub-viewer-font';
const JUSTIFIED = 'justified';
const DARK_BORDER = 'data-epub-viewer-border';
const GLYPHS = 'img[class*="gaiji"]';
const alpha = (color) => Number(color.match(/^rgba\(.*,\s*([\d.]+)\)$/)?.[1] ?? color.match(/\/\s*([\d.]+)\)$/)?.[1] ?? 1);
const brightness = (color) => {
    const [r, g, b] = color.startsWith('rgb') ? (color.match(/[\d.]+/g) ?? []).map(Number) : [];
    return b === undefined ? 1 : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
const DARK = 0.2;
export function keepBookStyles(doc) {
    const { getAttribute, setAttribute } = Element.prototype;
    const marks = [];
    const onOwnBackground = new Set();
    for (const el of doc.body?.querySelectorAll('*') ?? []) {
        const style = doc.defaultView.getComputedStyle(el);
        if (alpha(style.backgroundColor) >= 0.5) {
            onOwnBackground.add(el);
            marks.push([el, OWN_COLORS, ''], [el, 'style', `color:${style.color} !important;${getAttribute.call(el, 'style') ?? ''}`]);
        }
        else if (onOwnBackground.has(el.parentElement)) {
            onOwnBackground.add(el);
        }
        else {
            const borders = ['Top', 'Right', 'Bottom', 'Left'].filter((side) => parseFloat(style[`border${side}Width`]) > 0 && alpha(style[`border${side}Color`]) >= 0.5);
            if (borders.length && borders.every((side) => brightness(style[`border${side}Color`]) < DARK))
                marks.push([el, DARK_BORDER, '']);
        }
        if (/\bmonospace\b/.test(style.fontFamily))
            marks.push([el, OWN_FONT, style.textAlign === 'justify' ? JUSTIFIED : '']);
    }
    for (const [el, attribute, value] of marks)
        setAttribute.call(el, attribute, value);
}
export function lookRules({ theme, fontFamily }) {
    const onOwnBackground = `[${OWN_COLORS}], [${OWN_COLORS}] *`;
    return `
    html {
      color: ${theme.color} !important;
      /* Not transparent: browsers paint an opaque (white) backdrop behind an iframe whose
         color-scheme differs from the host page's, e.g. a dark host page. */
      background: ${theme.background} !important;
    }
    /* The colors of the page are the theme's. With the color too: a book that sets both on
       <body> (black on white) would be left with its black on a dark page. */
    body { background: transparent !important; color: inherit !important; }
    ${fontFamily ? `body, body :not([${OWN_FONT}]) { font-family: ${fontFamily} !important; }` : ''}
    [${OWN_FONT}="${JUSTIFIED}"] { text-align: start !important; }
    body :not(a):not(${onOwnBackground}) {
      color: inherit !important;
      /* What is drawn with the text, in a color that the book may set apart from it. */
      -webkit-text-emphasis-color: currentcolor !important;
      text-emphasis-color: currentcolor !important;
      text-decoration-color: currentcolor !important;
    }
    :is(a:link, a:visited):not(${onOwnBackground}) { color: ${theme.link} !important; }
    /* The white around a character does not show on a page of another color (e.g. sepia). */
    ${GLYPHS} { mix-blend-mode: multiply !important; }`;
}
export function darkPageRules(doc) {
    if (brightness(doc.defaultView.getComputedStyle(doc.documentElement).backgroundColor) >= 0.5)
        return '';
    return `
    [${DARK_BORDER}] { border-color: currentcolor !important; }
    ${GLYPHS}:not([${OWN_COLORS}] *) { filter: invert(1) !important; mix-blend-mode: screen !important; }`;
}
//# sourceMappingURL=look.js.map