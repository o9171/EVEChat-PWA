(() => {
    'use strict';

    // EVE shell v7: viewport logic kept aligned with SullyOS; inner fixed layers are normalized in CSS.

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    if (!isIOS || !isStandalone) return;

    const root = document.documentElement;
    root.classList.add('eve-ios-standalone');

    let stableStandaloneHeight = 0;
    let cachedTopInset = null;
    let cachedBottomInset = null;
    let wallpaperObserver = null;
    let syncRaf = 0;

    const isTextEntryElement = (target) => {
        if (!(target instanceof HTMLElement)) return false;
        if (target.isContentEditable) return true;
        return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    };

    const readSafeAreaInsets = () => {
        if (!document.body) {
            return { top: cachedTopInset ?? 0, bottom: cachedBottomInset ?? 0 };
        }
        if (cachedTopInset !== null && cachedBottomInset !== null) {
            return { top: cachedTopInset, bottom: cachedBottomInset };
        }

        const probe = document.createElement('div');
        probe.style.position = 'fixed';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        probe.style.opacity = '0';
        probe.style.paddingTop = 'env(safe-area-inset-top)';
        probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
        document.body.appendChild(probe);

        const computed = window.getComputedStyle(probe);
        const top = Math.round(parseFloat(computed.paddingTop) || 0);
        const bottom = Math.round(parseFloat(computed.paddingBottom) || 0);
        probe.remove();

        if (cachedTopInset === null && top > 0) cachedTopInset = top;
        if (cachedBottomInset === null && bottom > 0) cachedBottomInset = bottom;

        return {
            top: cachedTopInset ?? top,
            bottom: cachedBottomInset ?? bottom
        };
    };

    /* This follows SullyOS' actual standalone height logic:
       - never use screen.height
       - detect keyboard from visualViewport
       - keep the pre-keyboard app height stable
       - add the bottom safe inset to the full paint canvas */
    const setViewportVars = () => {
        const innerHeight = Math.round(window.innerHeight || 0);
        const viewportHeight = Math.round(window.visualViewport?.height || innerHeight);
        const viewportOffsetTop = Math.round(window.visualViewport?.offsetTop || 0);
        const safeInsets = readSafeAreaInsets();

        const bottomSafeInset = safeInsets.bottom;
        const topSafeInset = safeInsets.top > 0 ? safeInsets.top : 44;
        const obscuredHeight = Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
        const keyboardInset = obscuredHeight > 120 ? obscuredHeight : 0;
        const nextViewportHeight = Math.max(innerHeight, viewportHeight + viewportOffsetTop);

        if (!keyboardInset || !stableStandaloneHeight) {
            stableStandaloneHeight = nextViewportHeight;
        }

        const appHeight = stableStandaloneHeight || nextViewportHeight;
        const fullAppHeight = appHeight + bottomSafeInset;

        root.style.setProperty('--eve-app-height', `${fullAppHeight}px`);
        root.style.setProperty('--eve-visual-viewport-height', `${viewportHeight}px`);
        root.style.setProperty('--eve-keyboard-inset', `${keyboardInset}px`);
        root.style.setProperty('--eve-safe-bottom', `${bottomSafeInset}px`);
        root.style.setProperty('--eve-safe-top', `${topSafeInset}px`);
    };

    const isTransparent = (value) => !value || value === 'transparent' ||
        value === 'rgba(0, 0, 0, 0)' || value === 'rgba(0,0,0,0)';

    /* SullyOS mirrors its wallpaper onto html/body. We only mirror EVE's REAL
       wallpaper — never modals or active screens — so no black overlay can be copied. */
    const syncRootWallpaper = () => {
        syncRaf = 0;
        if (!document.body) return;
        const wallpaper = document.getElementById('wallpaper-element');
        if (!wallpaper) return;

        const cs = getComputedStyle(wallpaper);
        const image = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : 'none';
        const color = !isTransparent(cs.backgroundColor) ? cs.backgroundColor : '#d4e8f5';
        const size = cs.backgroundSize || 'cover';
        const position = cs.backgroundPosition || 'center';
        const repeat = cs.backgroundRepeat || 'no-repeat';

        [root, document.body].forEach((el) => {
            el.style.setProperty('background-image', image, 'important');
            el.style.setProperty('background-color', color, 'important');
            el.style.setProperty('background-size', size, 'important');
            el.style.setProperty('background-position', position, 'important');
            el.style.setProperty('background-repeat', repeat, 'important');
        });
    };

    const scheduleWallpaperSync = () => {
        if (syncRaf) return;
        syncRaf = requestAnimationFrame(syncRootWallpaper);
    };

    const installWallpaperObserver = () => {
        const wallpaper = document.getElementById('wallpaper-element');
        if (!wallpaper || wallpaperObserver) return;
        wallpaperObserver = new MutationObserver(scheduleWallpaperSync);
        wallpaperObserver.observe(wallpaper, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    };

    const handleViewportChange = () => {
        setViewportVars();
    };

    const handleSafeAreaChange = () => {
        cachedTopInset = null;
        cachedBottomInset = null;
        setViewportVars();
    };

    const handleFocusIn = (event) => {
        if (!isTextEntryElement(event.target)) return;
        document.body?.classList.add('eve-ios-keyboard-open');
        setViewportVars();

        const target = event.target;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (document.activeElement !== target) return;
                try {
                    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                } catch (_) {}
            });
        });
    };

    const handleFocusOut = () => {
        setTimeout(() => {
            if (!isTextEntryElement(document.activeElement)) {
                document.body?.classList.remove('eve-ios-keyboard-open');
            }
            setViewportVars();
        }, 180);
    };

    const init = () => {
        if (!document.body) return;
        document.body.classList.add('eve-ios-standalone');

        setViewportVars();
        installWallpaperObserver();
        syncRootWallpaper();

        /* iOS standalone can report env() as 0 during cold start; SullyOS retries. */
        [120, 500, 1500, 3000].forEach((delay) => {
            setTimeout(() => {
                if (cachedTopInset !== null && cachedBottomInset !== null) return;
                setViewportVars();
            }, delay);
        });

        [100, 500, 1500].forEach((delay) => setTimeout(scheduleWallpaperSync, delay));
    };

    window.addEventListener('resize', handleSafeAreaChange, { passive: true });
    window.addEventListener('orientationchange', handleSafeAreaChange, { passive: true });
    window.visualViewport?.addEventListener('resize', handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener('scroll', handleViewportChange, { passive: true });
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    window.addEventListener('pageshow', () => {
        setViewportVars();
        scheduleWallpaperSync();
    }, { passive: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
