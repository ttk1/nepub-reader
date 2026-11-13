export const themes = {
    light: { background: '#ffffff', color: '#1a1a1a', link: '#1a5fb4' },
    dark: { background: '#000000', color: '#acacac', link: '#7fa3d9' },
    sepia: { background: '#f4ecd8', color: '#5b4636', link: '#8a4b08' },
};
export const fonts = {
    mincho: '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "BIZ UDMincho", "Noto Serif JP", "Noto Serif CJK JP", "IPAexMincho", "IPAMincho", serif',
    gothic: '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic Medium", "Yu Gothic", YuGothic, Meiryo, "Noto Sans JP", "Noto Sans CJK JP", "IPAexGothic", "IPAGothic", sans-serif',
};
export const DEFAULT_OPTIONS = {
    theme: themes.light,
    fontFamily: '',
    fontSize: 16,
    lineHeight: 0,
    writingMode: 'auto',
    margin: 32,
    maxWidth: 0,
    spread: 'auto',
    direction: 'auto',
    keyboard: true,
    click: true,
    wheel: true,
    swipe: true,
    cooldown: 100,
};
//# sourceMappingURL=options.js.map