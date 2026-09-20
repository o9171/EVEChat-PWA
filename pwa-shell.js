(() => {
    'use strict';

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    if (!isIOS || !isStandalone) return;

    const root = document.documentElement;
    root.classList.add('eve-standalone');

    let stableHeight = 0;
    let cachedTop = null;
    let cachedBottom = null;
    let syncRaf = 0;
    let phoneObserver = null;
    let wallpaperObserver = null;

    const isTextEntry = (el) => el instanceof HTMLElement &&
        (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

    const readSafeArea = () => {
        if (!document.body) return { top: cachedTop || 0, bottom: cachedBottom || 0 };
        const probe = document.createElement('div');
        probe.style.cssText = [
            'position:fixed',
            'visibility:hidden',
            'pointer-events:none',
            'opacity:0',
            'padding-top:env(safe-area-inset-top)',
            'padding-bottom:env(safe-area-inset-bottom)'
        ].join(';');
        document.body.appendChild(probe);
        const cs = getComputedStyle(probe);
        const top = Math.round(parseFloat(cs.paddingTop) || 0);
        const bottom = Math.round(parseFloat(cs.paddingBottom) || 0);
        probe.remove();
        if (cachedTop === null && top > 0) cachedTop = top;
        if (cachedBottom === null && bottom > 0) cachedBottom = bottom;
        return { top: cachedTop ?? top, bottom: cachedBottom ?? bottom };
    };

    const setViewportVars = () => {
        const innerH = Math.round(window.innerHeight || 0);
        const vv = window.visualViewport;
        const vvH = Math.round(vv?.height || innerH);
        const vvTop = Math.round(vv?.offsetTop || 0);
        const safe = readSafeArea();

        const obscured = Math.max(0, innerH - vvH - vvTop);
        const keyboardInset = obscured > 120 ? obscured : 0;
        const nextH = Math.max(innerH, vvH + vvTop);

        if (!keyboardInset || !stableHeight) stableHeight = nextH;
        const appHeight = stableHeight || nextH || Math.round(screen.height || 0);

        root.style.setProperty('--eve-app-height', `${appHeight}px`);
        root.style.setProperty('--eve-keyboard-inset', `${keyboardInset}px`);
        root.style.setProperty('--eve-safe-top', `${safe.top > 0 ? safe.top : 0}px`);
        root.style.setProperty('--eve-safe-bottom', `${safe.bottom > 0 ? safe.bottom : 0}px`);
    };

    const visible = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
    };

    const activeScreen = () => {
        const phone = document.getElementById('phone-screen');
        if (!phone) return null;
        const direct = Array.from(phone.children).filter(el => el.classList?.contains('app-screen'));
        let found = null;
        for (const el of direct) if (visible(el)) found = el;
        return found;
    };

    const isTransparent = (value) => !value || value === 'transparent' ||
        value === 'rgba(0, 0, 0, 0)' || value === 'rgba(0,0,0,0)';

    /* SullyOS' key trick: mirror the REAL wallpaper onto html + body.
       We do the same here. No extra DOM layer is created. */
    const paintRootFrom = (source) => {
        if (!source || !document.body) return;
        const cs = getComputedStyle(source);
        const img = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : 'none';
        const color = !isTransparent(cs.backgroundColor) ? cs.backgroundColor : '#d4e8f5';
        const size = cs.backgroundSize || 'cover';
        const pos = cs.backgroundPosition || 'center';
        const repeat = cs.backgroundRepeat || 'no-repeat';

        for (const el of [root, document.body]) {
            el.style.setProperty('background-image', img, 'important');
            el.style.setProperty('background-color', color, 'important');
            el.style.setProperty('background-size', size, 'important');
            el.style.setProperty('background-position', pos, 'important');
            el.style.setProperty('background-repeat', repeat, 'important');
            el.style.setProperty('background-attachment', 'scroll', 'important');
        }
    };

    const syncRootScene = () => {
        syncRaf = 0;
        setViewportVars();

        const screen = activeScreen();
        const wallpaper = document.getElementById('wallpaper-element');

        if (screen) {
            const cs = getComputedStyle(screen);
            const hasOwnPaint = (cs.backgroundImage && cs.backgroundImage !== 'none') || !isTransparent(cs.backgroundColor);
            if (hasOwnPaint) paintRootFrom(screen);
            else if (wallpaper) paintRootFrom(wallpaper);
        } else if (wallpaper) {
            paintRootFrom(wallpaper);
        }
    };

    let keyboardFrozen = false;
    let frozenPaint = null;

    const capturePaint = () => {
        const screen = activeScreen();
        const wallpaper = document.getElementById('wallpaper-element');
        let source = wallpaper;
        if (screen) {
            const cs = getComputedStyle(screen);
            const hasOwnPaint = (cs.backgroundImage && cs.backgroundImage !== 'none') || !isTransparent(cs.backgroundColor);
            if (hasOwnPaint) source = screen;
        }
        if (!source) return null;
        const cs = getComputedStyle(source);
        return {
            image: cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : 'none',
            color: !isTransparent(cs.backgroundColor) ? cs.backgroundColor : '#d4e8f5',
            size: cs.backgroundSize || 'cover',
            pos: cs.backgroundPosition || 'center',
            repeat: cs.backgroundRepeat || 'no-repeat'
        };
    };

    const applyFrozenPaint = () => {
        if (!frozenPaint || !document.body) return;
        for (const el of [root, document.body]) {
            el.style.setProperty('background-image', frozenPaint.image, 'important');
            el.style.setProperty('background-color', frozenPaint.color, 'important');
            el.style.setProperty('background-size', frozenPaint.size, 'important');
            el.style.setProperty('background-position', frozenPaint.pos, 'important');
            el.style.setProperty('background-repeat', frozenPaint.repeat, 'important');
        }
    };

    const freezeKeyboardFrame = () => {
        if (keyboardFrozen) return;
        setViewportVars();
        frozenPaint = capturePaint();
        applyFrozenPaint();
        keyboardFrozen = true;
        document.body?.classList.add('eve-keyboard-open');
    };

    const scheduleSync = () => {
        if (keyboardFrozen || syncRaf) return;
        syncRaf = requestAnimationFrame(syncRootScene);
    };

    const installObservers = () => {
        const phone = document.getElementById('phone-screen');
        const wallpaper = document.getElementById('wallpaper-element');

        if (phone && !phoneObserver) {
            phoneObserver = new MutationObserver(scheduleSync);
            phoneObserver.observe(phone, {
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }
        if (wallpaper && !wallpaperObserver) {
            wallpaperObserver = new MutationObserver(scheduleSync);
            wallpaperObserver.observe(wallpaper, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }
    };

    const init = () => {
        if (!document.body) return;
        document.body.classList.add('eve-standalone');
        setViewportVars();
        installObservers();
        syncRootScene();
        [100, 350, 800, 1600, 3000].forEach(ms => setTimeout(scheduleSync, ms));
    };

    const preFreeze = (e) => {
        const target = e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
        if (target && isTextEntry(target)) freezeKeyboardFrame();
    };

    document.addEventListener('pointerdown', preFreeze, true);
    document.addEventListener('touchstart', preFreeze, { capture: true, passive: true });

    document.addEventListener('focusin', (e) => {
        if (isTextEntry(e.target)) freezeKeyboardFrame();
    }, true);

    document.addEventListener('focusout', () => {
        setTimeout(() => {
            if (isTextEntry(document.activeElement)) return;
            keyboardFrozen = false;
            document.body?.classList.remove('eve-keyboard-open');
            cachedTop = null;
            cachedBottom = null;
            stableHeight = 0;
            setViewportVars();
            scheduleSync();
        }, 350);
    }, true);

    window.addEventListener('resize', () => {
        if (keyboardFrozen) {
            applyFrozenPaint();
            return;
        }
        cachedTop = null;
        cachedBottom = null;
        stableHeight = 0;
        setViewportVars();
        scheduleSync();
    }, { passive: true });

    window.addEventListener('orientationchange', () => {
        if (keyboardFrozen) return;
        cachedTop = null;
        cachedBottom = null;
        stableHeight = 0;
        setTimeout(() => { setViewportVars(); scheduleSync(); }, 350);
        setTimeout(() => { setViewportVars(); scheduleSync(); }, 800);
    }, { passive: true });

    window.visualViewport?.addEventListener('resize', () => {
        if (keyboardFrozen) {
            applyFrozenPaint();
            return;
        }
        setViewportVars();
        scheduleSync();
    }, { passive: true });

    window.visualViewport?.addEventListener('scroll', () => {
        if (keyboardFrozen) {
            applyFrozenPaint();
            return;
        }
        setViewportVars();
    }, { passive: true });

    window.addEventListener('pageshow', () => {
        if (!keyboardFrozen) scheduleSync();
    }, { passive: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
