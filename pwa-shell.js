(() => {
    'use strict';

    let installed = false;
    let stableStandaloneHeight = 0;
    let cachedTopInset = null;
    let cachedBottomInset = null;
    let wallpaperObserver = null;

    const isIOSDevice = () => {
        const ua = navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    };

    const isStandaloneDisplayMode = () =>
        window.matchMedia?.('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    const isIOSStandalone = () => isIOSDevice() && isStandaloneDisplayMode();

    if (!isIOSStandalone()) return;

    const root = document.documentElement;

    const isTextEntry = (target) => target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

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

        const computed = getComputedStyle(probe);
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

    /* Exact SullyOS height model: stable content height + bottom safe area. */
    const setViewportVars = () => {
        const innerHeight = Math.round(window.innerHeight || 0);
        const viewportHeight = Math.round(window.visualViewport?.height || innerHeight);
        const viewportOffsetTop = Math.round(window.visualViewport?.offsetTop || 0);
        const safeInsets = readSafeAreaInsets();

        const obscuredHeight = Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
        const keyboardInset = obscuredHeight > 120 ? obscuredHeight : 0;
        const nextViewportHeight = Math.max(innerHeight, viewportHeight + viewportOffsetTop);

        if (!keyboardInset || !stableStandaloneHeight) {
            stableStandaloneHeight = nextViewportHeight;
        }

        const contentHeight = stableStandaloneHeight || nextViewportHeight;
        const fullAppHeight = contentHeight + safeInsets.bottom;
        const topSafeInset = safeInsets.top > 0 ? safeInsets.top : 44;

        root.style.setProperty('--eve-app-height', `${fullAppHeight}px`);
        root.style.setProperty('--eve-content-height', `${contentHeight}px`);
        root.style.setProperty('--eve-visual-height', `${viewportHeight}px`);
        root.style.setProperty('--eve-keyboard-inset', `${keyboardInset}px`);
        root.style.setProperty('--eve-safe-top', `${topSafeInset}px`);
        root.style.setProperty('--eve-safe-bottom', `${safeInsets.bottom}px`);
        root.style.setProperty('--eve-safe-left', 'env(safe-area-inset-left, 0px)');
        root.style.setProperty('--eve-safe-right', 'env(safe-area-inset-right, 0px)');
    };

    const isTransparent = (value) => !value || value === 'transparent' ||
        value === 'rgba(0, 0, 0, 0)' || value === 'rgba(0,0,0,0)';

    /* SullyOS keeps html/body on the wallpaper itself, never on the active app page. */
    const syncRootWallpaper = () => {
        const wallpaper = document.getElementById('wallpaper-element');
        if (!wallpaper || !document.body) return;

        const cs = getComputedStyle(wallpaper);
        const image = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : 'none';
        const color = !isTransparent(cs.backgroundColor) ? cs.backgroundColor : '#d4e8f5';
        const size = cs.backgroundSize || 'cover';
        const position = cs.backgroundPosition || 'center';
        const repeat = cs.backgroundRepeat || 'no-repeat';

        [root, document.body].forEach((element) => {
            element.style.setProperty('background-image', image, 'important');
            element.style.setProperty('background-color', color, 'important');
            element.style.setProperty('background-size', size, 'important');
            element.style.setProperty('background-position', position, 'important');
            element.style.setProperty('background-repeat', repeat, 'important');
            element.style.setProperty('background-attachment', 'scroll', 'important');
        });
    };

    /*
     * Split EVE's original wallpaper element into:
     *   wallpaper-element = one real full-bleed wallpaper/background
     *   eve-pwa-content   = all original UI, ending above safe-bottom
     * This is the structural part that matches SullyOS's background + shell-content design.
     */
    const ensureContentShell = () => {
        const wallpaper = document.getElementById('wallpaper-element');
        if (!wallpaper) return null;

        let content = document.getElementById('eve-pwa-content');
        if (content) return content;

        content = document.createElement('div');
        content.id = 'eve-pwa-content';

        const children = Array.from(wallpaper.childNodes);
        for (const child of children) content.appendChild(child);
        wallpaper.appendChild(content);

        return content;
    };

    const installWallpaperObserver = () => {
        const wallpaper = document.getElementById('wallpaper-element');
        if (!wallpaper || wallpaperObserver) return;

        wallpaperObserver = new MutationObserver(() => {
            requestAnimationFrame(syncRootWallpaper);
        });
        wallpaperObserver.observe(wallpaper, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    };

    const handleViewportChange = () => {
        setViewportVars();
        syncRootWallpaper();
    };

    const handleSafeAreaChange = () => {
        cachedTopInset = null;
        cachedBottomInset = null;
        setViewportVars();
        syncRootWallpaper();
    };

    const handleFocusIn = (event) => {
        if (!isTextEntry(event.target)) return;
        document.body?.classList.add('eve-keyboard-open');
        setViewportVars();
        syncRootWallpaper();

        const target = event.target;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (document.activeElement !== target) return;
                try {
                    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                } catch (_) {}
                setViewportVars();
                syncRootWallpaper();
            });
        });
    };

    const handleFocusOut = () => {
        setTimeout(() => {
            if (!isTextEntry(document.activeElement)) {
                document.body?.classList.remove('eve-keyboard-open');
            }
            setViewportVars();
            syncRootWallpaper();
        }, 180);
    };

    const init = () => {
        if (installed || !document.body) return;
        installed = true;

        root.classList.add('eve-standalone');
        document.body.classList.add('eve-standalone');

        ensureContentShell();
        setViewportVars();
        syncRootWallpaper();
        installWallpaperObserver();

        window.addEventListener('resize', handleSafeAreaChange, { passive: true });
        window.addEventListener('orientationchange', handleSafeAreaChange, { passive: true });
        window.visualViewport?.addEventListener('resize', handleViewportChange, { passive: true });
        window.visualViewport?.addEventListener('scroll', handleViewportChange, { passive: true });
        document.addEventListener('focusin', handleFocusIn, true);
        document.addEventListener('focusout', handleFocusOut, true);
        window.addEventListener('pageshow', handleViewportChange, { passive: true });

        [120, 500, 1500, 3000].forEach((delay) => {
            setTimeout(() => {
                if (cachedTopInset !== null && cachedBottomInset !== null) return;
                setViewportVars();
                syncRootWallpaper();
            }, delay);
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
