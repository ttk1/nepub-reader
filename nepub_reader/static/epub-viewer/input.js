const WHEEL_GESTURE_GAP = 150;
const WHEEL_THRESHOLD = 10;
const SWIPE_DISTANCE = 40;
const SWIPE_SLOPE = 1.5;
const LINKS = 'a, area, use, [*|href]';
const linkAt = (target) => Element.prototype.closest.call(target, LINKS);
export class Input {
    #host;
    #container;
    #stage;
    #pressedKeys = new Set();
    #lastTurn = -Infinity;
    #wheel = { x: 0, y: 0, turned: false, last: -Infinity };
    #selectedAtPress = false;
    #touchStart;
    constructor(container, stage, host) {
        this.#container = container;
        this.#stage = stage;
        this.#host = host;
        container.addEventListener('click', this.#onSideClick);
        this.#listenGestures(container, 'addEventListener');
        this.#listenKeys(this.#window, 'addEventListener');
    }
    attach(doc) {
        this.#listenKeys(doc.defaultView, 'addEventListener');
        doc.documentElement.addEventListener('click', this.#onClick);
        doc.documentElement.addEventListener('auxclick', this.#onAuxClick);
        this.#listenGestures(doc, 'addEventListener');
        doc.addEventListener('pointerdown', this.#onPointerDown);
    }
    destroy() {
        this.#container.removeEventListener('click', this.#onSideClick);
        this.#listenGestures(this.#container, 'removeEventListener');
        this.#listenKeys(this.#window, 'removeEventListener');
    }
    get #window() {
        return this.#container.ownerDocument.defaultView;
    }
    #listenGestures(target, method) {
        target[method]('wheel', this.#onWheel, { passive: false });
        target[method]('touchstart', this.#onTouchStart, { passive: true });
        target[method]('touchend', this.#onTouchEnd);
        target[method]('touchcancel', this.#onTouchEnd);
    }
    #listenKeys(target, method) {
        target[method]('keydown', this.#onKeydown);
        target[method]('keyup', this.#onKeyup);
        target[method]('blur', this.#onBlur);
    }
    #turn(direction) {
        const now = performance.now();
        if (now - this.#lastTurn < this.#host.options.cooldown)
            return;
        this.#lastTurn = now;
        this.#host[direction]().catch((error) => this.#host.dispatchEvent(new CustomEvent('error', { detail: { error } })));
    }
    #onKeydown = (e) => {
        if (!this.#host.options.keyboard || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey)
            return;
        const target = e.target;
        if (target.closest?.('input, textarea, select, [contenteditable]'))
            return;
        if (e.key === ' ' && target.closest?.('button, summary'))
            return;
        const direction = {
            ArrowLeft: 'goLeft',
            ArrowRight: 'goRight',
            ArrowUp: 'prev',
            ArrowDown: 'next',
            PageUp: 'prev',
            PageDown: 'next',
            ' ': e.shiftKey ? 'prev' : 'next',
        }[e.key];
        if (!direction)
            return;
        e.preventDefault();
        if (this.#pressedKeys.has(e.key))
            return;
        this.#pressedKeys.add(e.key);
        this.#turn(direction);
    };
    #onKeyup = (e) => {
        this.#pressedKeys.delete(e.key);
    };
    #onBlur = () => {
        this.#pressedKeys.clear();
    };
    #onClick = (e) => {
        if (!this.#host.shown())
            return e.preventDefault();
        const doc = e.target.ownerDocument;
        const link = linkAt(e.target);
        if (link)
            e.preventDefault();
        const href = link?.matches('a, area') ? (link.getAttribute('href') ?? link.getAttributeNS('http://www.w3.org/1999/xlink', 'href')) : null;
        if (href != null)
            return this.#host.followLink(href, doc);
        if (this.#selecting(doc))
            return;
        const frame = doc.defaultView.frameElement;
        const rect = frame.getBoundingClientRect();
        this.#clickAt(rect.left + (e.clientX * rect.width) / frame.clientWidth);
    };
    #onAuxClick = (e) => {
        if (linkAt(e.target))
            e.preventDefault();
    };
    #onSideClick = (e) => {
        if (e.target === this.#stage)
            this.#clickAt(e.clientX);
    };
    #clickAt(clientX) {
        const { left, right } = this.#host.pagesRect();
        const x = Math.min(Math.max((clientX - left) / (right - left), 0), 1);
        if (!this.#host.options.click || (x >= 1 / 3 && x <= 2 / 3))
            this.#host.dispatchEvent(new CustomEvent('tap', { detail: { x } }));
        else
            this.#turn(x < 1 / 3 ? 'goLeft' : 'goRight');
    }
    #selecting(doc) {
        return this.#selectedAtPress || doc.getSelection()?.isCollapsed === false;
    }
    #onPointerDown = (e) => {
        this.#selectedAtPress = e.currentTarget.getSelection()?.isCollapsed === false;
    };
    #onTouchStart = (e) => {
        const [touch, second] = e.touches;
        this.#touchStart = second ? undefined : { x: touch.screenX, y: touch.screenY };
    };
    #onTouchEnd = (e) => {
        const start = this.#touchStart;
        this.#touchStart = undefined;
        if (!start || !this.#host.options.swipe || e.type === 'touchcancel')
            return;
        if (this.#selecting(e.target.ownerDocument))
            return;
        const dx = e.changedTouches[0].screenX - start.x;
        const dy = e.changedTouches[0].screenY - start.y;
        if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < SWIPE_SLOPE * Math.abs(dy))
            return;
        if ((this.#window.visualViewport?.scale ?? 1) > 1.01)
            return;
        this.#turn(dx > 0 ? 'goLeft' : 'goRight');
    };
    #onWheel = (e) => {
        if (!this.#host.options.wheel || e.ctrlKey)
            return;
        e.preventDefault();
        const wheel = this.#wheel;
        const now = performance.now();
        if (now - wheel.last > WHEEL_GESTURE_GAP)
            Object.assign(wheel, { x: 0, y: 0, turned: false });
        wheel.last = now;
        if (wheel.turned)
            return;
        const unit = e.deltaMode === 0 ? 1 : 100;
        wheel.x += e.deltaX * unit;
        wheel.y += e.deltaY * unit;
        if (Math.max(Math.abs(wheel.x), Math.abs(wheel.y)) < WHEEL_THRESHOLD)
            return;
        wheel.turned = true;
        if (Math.abs(wheel.x) > Math.abs(wheel.y))
            this.#turn(wheel.x > 0 ? 'goRight' : 'goLeft');
        else
            this.#turn(wheel.y > 0 ? 'next' : 'prev');
    };
}
//# sourceMappingURL=input.js.map