(() => {
    'use strict';

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    if (!isIOS || !isStandalone) return;

    const root = document.documentElement;
    let stableStandaloneHeight = 0;
    let cachedTopInset = null;
    let cachedBottomInset = null;
    let syncRaf = 0;
    let phoneObserver = null;
    let wallpaperObserver = null;

    root.classList.add('eve-standalone');

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

    const setViewportVars = () => {
        const innerHeight = Math.round(window.innerHeight || 0);
        const vv = window.visualViewport;
        const viewportHeight = Math.round(vv?.height || innerHeight);
        const viewportOffsetTop = Math.round(vv?.offsetTop || 0);
        const safeInsets = readSafeAreaInsets();
        const focused = isTextEntry(document.activeElement);

        const currentViewportSpan = Math.max(1, viewportHeight + viewportOffsetTop);
        const nextViewportHeight = Math.max(innerHeight, currentViewportSpan);

        if (!stableStandaloneHeight) {
            stableStandaloneHeight = nextViewportHeight;
        } else if (!focused) {
            /* Never accept the temporary keyboard-shrunken height as the new app height.
               Rotation explicitly clears stableStandaloneHeight below. */
            if (nextViewportHeight >= stableStandaloneHeight - 8) {
                stableStandaloneHeight = nextViewportHeight;
            }
        }

        const byCurrentViewport = Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
        const byStableViewport = Math.max(0, stableStandaloneHeight - currentViewportSpan);
        const keyboardInset = focused && Math.max(byCurrentViewport, byStableViewport) > 120
            ? Math.max(byCurrentViewport, byStableViewport)
            : 0;

        const topSafeInset = safeInsets.top > 0 ? safeInsets.top : 44;

        root.style.setProperty('--eve-app-height', `${stableStandaloneHeight || nextViewportHeight}px`);
        root.style.setProperty('--eve-visual-height', `${viewportHeight}px`);
        root.style.setProperty('--eve-keyboard-inset', `${keyboardInset}px`);
        root.style.setProperty('--eve-safe-top', `${topSafeInset}px`);
        root.style.setProperty('--eve-safe-bottom', `${safeInsets.bottom}px`);
    };

    const isTransparent = (value) => !value || value === 'transparent' ||
        value === 'rgba(0, 0, 0, 0)' || value === 'rgba(0,0,0,0)';

    const visible = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
    };

    const getRootPaintSource = () => {
        const phone = document.getElementById('phone-screen');
        const wallpaper = document.getElementById('wallpaper-element');
        if (!phone) return wallpaper;

        const screens = Array.from(phone.querySelectorAll('.app-screen')).filter(visible);
        for (let i = screens.length - 1; i >= 0; i--) {
            const cs = getComputedStyle(screens[i]);
            const hasPaint = (cs.backgroundImage && cs.backgroundImage !== 'none') ||
                !isTransparent(cs.backgroundColor);
            if (hasPaint) return screens[i];
        }
        return wallpaper;
    };

    const paintRootFrom = (source) => {
        if (!source || !document.body) return;
        const cs = getComputedStyle(source);
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
        });
    };

    const syncScene = () => {
        syncRaf = 0;
        setViewportVars();
        paintRootFrom(getRootPaintSource());
    };

    const scheduleSync = () => {
        if (syncRaf) return;
        syncRaf = requestAnimationFrame(syncScene);
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

    const handleFocusIn = (event) => {
        if (!isTextEntry(event.target)) return;
        document.body?.classList.add('eve-keyboard-open');
        setViewportVars();

        const target = event.target;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (document.activeElement !== target) return;
                try {
                    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                } catch (_) {}
                setViewportVars();
                paintRootFrom(getRootPaintSource());
            });
        });
    };

    const handleFocusOut = () => {
        setTimeout(() => {
            if (!isTextEntry(document.activeElement)) {
                document.body?.classList.remove('eve-keyboard-open');
            }
            setViewportVars();
            scheduleSync();
            setTimeout(() => {
                setViewportVars();
                scheduleSync();
            }, 350);
        }, 180);
    };

    const init = () => {
        if (!document.body) return;
        document.body.classList.add('eve-standalone');
        setViewportVars();
        installObservers();
        syncScene();

        [120, 500, 1500, 3000].forEach((delay) => {
            setTimeout(() => {
                if (cachedTopInset !== null && cachedBottomInset !== null) return;
                setViewportVars();
                scheduleSync();
            }, delay);
        });
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);

    window.visualViewport?.addEventListener('resize', () => {
        setViewportVars();
        paintRootFrom(getRootPaintSource());
    }, { passive: true });

    window.visualViewport?.addEventListener('scroll', () => {
        setViewportVars();
        paintRootFrom(getRootPaintSource());
    }, { passive: true });

    window.addEventListener('resize', () => {
        const focused = isTextEntry(document.activeElement);
        if (!focused) {
            cachedTopInset = null;
            cachedBottomInset = null;
        }
        setViewportVars();
        scheduleSync();
    }, { passive: true });

    window.addEventListener('orientationchange', () => {
        cachedTopInset = null;
        cachedBottomInset = null;
        stableStandaloneHeight = 0;
        setTimeout(() => { setViewportVars(); scheduleSync(); }, 350);
        setTimeout(() => { setViewportVars(); scheduleSync(); }, 800);
    }, { passive: true });

    window.addEventListener('pageshow', scheduleSync, { passive: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
