(() => {
    'use strict';

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
    if (!isIOS || !standalone) return;

    const root = document.documentElement;
    let stableContentHeight = 0;
    let cachedTop = null;
    let cachedBottom = null;
    let keyboardActive = false;
    let lastOuterWidth = Math.round(window.innerWidth || 0);
    let wallpaperObserver = null;

    const isTextEntry = (el) => el instanceof HTMLElement &&
        (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

    const readSafeArea = () => {
        if (!document.body) return { top: cachedTop ?? 0, bottom: cachedBottom ?? 0 };
        if (cachedTop !== null && cachedBottom !== null) return { top: cachedTop, bottom: cachedBottom };

        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;opacity:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);';
        document.body.appendChild(probe);
        const cs = getComputedStyle(probe);
        const top = Math.round(parseFloat(cs.paddingTop) || 0);
        const bottom = Math.round(parseFloat(cs.paddingBottom) || 0);
        probe.remove();

        if (cachedTop === null && top > 0) cachedTop = top;
        if (cachedBottom === null && bottom > 0) cachedBottom = bottom;
        return { top: cachedTop ?? top, bottom: cachedBottom ?? bottom };
    };

    const currentViewportHeight = () => {
        const inner = Math.round(window.innerHeight || 0);
        const vv = window.visualViewport;
        const visual = Math.round(vv?.height || inner);
        const offset = Math.round(vv?.offsetTop || 0);
        return { inner, visual, offset, candidate: Math.max(inner, visual + offset) };
    };

    const setViewportVars = ({ allowStableUpdate = true } = {}) => {
        const v = currentViewportHeight();
        const safe = readSafeArea();

        if (!stableContentHeight) stableContentHeight = v.candidate;

        // Important difference for EVE: while a text field is focused, iOS may resize
        // window.innerHeight itself, making SullyOS's geometry-only keyboard test read 0.
        // Never replace the known full-screen height with that smaller keyboard height.
        const geometryKeyboard = stableContentHeight > 0 && (stableContentHeight - (v.visual + v.offset)) > 120;
        const keyboardNow = keyboardActive || geometryKeyboard;

        if (allowStableUpdate && !keyboardNow) {
            stableContentHeight = v.candidate;
        }

        const keyboardInset = keyboardNow
            ? Math.max(0, stableContentHeight - (v.visual + v.offset))
            : 0;
        const fullHeight = stableContentHeight + safe.bottom;
        const safeTop = safe.top > 0 ? safe.top : 44;

        root.style.setProperty('--eve-app-height', `${fullHeight}px`);
        root.style.setProperty('--eve-keyboard-inset', `${keyboardInset}px`);
        root.style.setProperty('--eve-safe-top', `${safeTop}px`);
        root.style.setProperty('--eve-safe-bottom', `${safe.bottom}px`);
        root.style.setProperty('--eve-safe-left', 'env(safe-area-inset-left, 0px)');
        root.style.setProperty('--eve-safe-right', 'env(safe-area-inset-right, 0px)');
    };

    const transparent = (v) => !v || v === 'transparent' || v === 'rgba(0, 0, 0, 0)' || v === 'rgba(0,0,0,0)';

    // Same idea as SullyOS: the document root always paints the same wallpaper as the phone shell.
    // If WebKit reveals any area while moving the visual viewport, it reveals the wallpaper, not white.
    const syncRootWallpaper = () => {
        const wallpaper = document.getElementById('wallpaper-element');
        if (!wallpaper || !document.body) return;
        const cs = getComputedStyle(wallpaper);
        const image = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : 'none';
        const color = !transparent(cs.backgroundColor) ? cs.backgroundColor : '#d4e8f5';
        const size = cs.backgroundSize || 'cover';
        const pos = cs.backgroundPosition || 'center';
        const repeat = cs.backgroundRepeat || 'no-repeat';

        for (const el of [root, document.body]) {
            el.style.setProperty('background-image', image, 'important');
            el.style.setProperty('background-color', color, 'important');
            el.style.setProperty('background-size', size, 'important');
            el.style.setProperty('background-position', pos, 'important');
            el.style.setProperty('background-repeat', repeat, 'important');
            el.style.setProperty('background-attachment', 'scroll', 'important');
        }
    };

    const keepLayoutOrigin = () => {
        // Only the document is pinned. Internal chat/message scrollers are untouched.
        const se = document.scrollingElement;
        if (se && se.scrollTop !== 0) se.scrollTop = 0;
        if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    const enterKeyboardMode = () => {
        if (!keyboardActive) {
            // Capture the last good full-screen metrics before the keyboard resize arrives.
            setViewportVars({ allowStableUpdate: true });
            syncRootWallpaper();
        }
        keyboardActive = true;
        document.body?.classList.add('eve-keyboard-open');
        setViewportVars({ allowStableUpdate: false });
        keepLayoutOrigin();
    };

    const finishKeyboardMode = (attempt = 0) => {
        if (isTextEntry(document.activeElement)) return;
        const v = currentViewportHeight();
        const recovered = v.candidate >= stableContentHeight - 60;
        if (!recovered && attempt < 8) {
            setTimeout(() => finishKeyboardMode(attempt + 1), 100);
            return;
        }
        keyboardActive = false;
        document.body?.classList.remove('eve-keyboard-open');
        setViewportVars({ allowStableUpdate: recovered });
        syncRootWallpaper();
        keepLayoutOrigin();
    };

    const init = () => {
        if (!document.body) return;
        root.classList.add('eve-standalone');
        document.body.classList.add('eve-standalone');

        setViewportVars({ allowStableUpdate: true });
        syncRootWallpaper();
        keepLayoutOrigin();

        const wallpaper = document.getElementById('wallpaper-element');
        if (wallpaper) {
            wallpaperObserver = new MutationObserver(() => requestAnimationFrame(syncRootWallpaper));
            wallpaperObserver.observe(wallpaper, { attributes: true, attributeFilter: ['style', 'class'] });
        }

        // Pointer/touch capture runs before focus and before the keyboard changes viewport metrics.
        const preFocus = (event) => {
            const target = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
            if (target && isTextEntry(target)) enterKeyboardMode();
        };
        document.addEventListener('pointerdown', preFocus, true);
        document.addEventListener('touchstart', preFocus, { capture: true, passive: true });

        document.addEventListener('focusin', (event) => {
            if (isTextEntry(event.target)) enterKeyboardMode();
        }, true);
        document.addEventListener('focusout', () => setTimeout(() => finishKeyboardMode(0), 180), true);

        window.visualViewport?.addEventListener('resize', () => {
            setViewportVars({ allowStableUpdate: !keyboardActive });
            syncRootWallpaper();
            if (keyboardActive) keepLayoutOrigin();
        }, { passive: true });

        window.visualViewport?.addEventListener('scroll', () => {
            setViewportVars({ allowStableUpdate: false });
            if (keyboardActive) keepLayoutOrigin();
        }, { passive: true });

        window.addEventListener('resize', () => {
            const width = Math.round(window.innerWidth || 0);
            const widthChanged = Math.abs(width - lastOuterWidth) > 20;
            lastOuterWidth = width;

            if (keyboardActive && !widthChanged) {
                // Keyboard-induced window resize: never invalidate safe areas or stable height.
                setViewportVars({ allowStableUpdate: false });
                syncRootWallpaper();
                keepLayoutOrigin();
                return;
            }

            cachedTop = null;
            cachedBottom = null;
            if (widthChanged) stableContentHeight = 0;
            setViewportVars({ allowStableUpdate: true });
            syncRootWallpaper();
        }, { passive: true });

        window.addEventListener('orientationchange', () => {
            keyboardActive = false;
            document.body?.classList.remove('eve-keyboard-open');
            cachedTop = null;
            cachedBottom = null;
            stableContentHeight = 0;
            setTimeout(() => { setViewportVars({ allowStableUpdate: true }); syncRootWallpaper(); }, 350);
            setTimeout(() => { setViewportVars({ allowStableUpdate: true }); syncRootWallpaper(); }, 800);
        }, { passive: true });

        window.addEventListener('pageshow', () => {
            setViewportVars({ allowStableUpdate: !keyboardActive });
            syncRootWallpaper();
            keepLayoutOrigin();
        }, { passive: true });

        [120, 500, 1500, 3000].forEach(delay => setTimeout(() => {
            if (keyboardActive) return;
            if (cachedTop !== null && cachedBottom !== null) return;
            setViewportVars({ allowStableUpdate: true });
            syncRootWallpaper();
        }, delay));
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
