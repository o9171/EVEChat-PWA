(() => {
    'use strict';

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    if (!isIOS || !standalone) return;

    const root = document.documentElement;
    let wallpaperObserver = null;
    let bodyObserver = null;
    let raf = 0;

    const transparent = (value) => !value || value === 'transparent' ||
        value === 'rgba(0, 0, 0, 0)' || value === 'rgba(0,0,0,0)';

    /* SullyOS does this too: if WebKit ever reveals the document canvas,
       it must reveal the REAL wallpaper rather than white/blue/black. */
    const syncDocumentWallpaper = () => {
        raf = 0;
        const wallpaper = document.getElementById('wallpaper-element');
        if (!wallpaper || !document.body) return;

        const cs = getComputedStyle(wallpaper);
        const image = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : 'none';
        const color = !transparent(cs.backgroundColor) ? cs.backgroundColor : '#d4e8f5';
        const size = cs.backgroundSize || 'cover';
        const position = cs.backgroundPosition || 'center';
        const repeat = cs.backgroundRepeat || 'no-repeat';

        [root, document.body].forEach((el) => {
            el.style.setProperty('background-image', image, 'important');
            el.style.setProperty('background-color', color, 'important');
            el.style.setProperty('background-size', size, 'important');
            el.style.setProperty('background-position', position, 'important');
            el.style.setProperty('background-repeat', repeat, 'important');
            el.style.setProperty('background-attachment', 'scroll', 'important');
        });
    };

    const scheduleWallpaperSync = () => {
        if (raf) return;
        raf = requestAnimationFrame(syncDocumentWallpaper);
    };

    const init = () => {
        if (!document.body) return;

        root.classList.add('eve-wanwan-shell');
        document.body.classList.add('eve-wanwan-shell');

        /* IMPORTANT: unlike old EVE patches, there is intentionally NO
           visualViewport resize/scroll handler and NO keyboard height JS.
           Wanwan lets interactive-widget=resizes-content resize the layout root. */
        syncDocumentWallpaper();

        const wallpaper = document.getElementById('wallpaper-element');
        if (wallpaper) {
            wallpaperObserver = new MutationObserver(scheduleWallpaperSync);
            wallpaperObserver.observe(wallpaper, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }

        bodyObserver = new MutationObserver(scheduleWallpaperSync);
        bodyObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['style', 'class', 'data-theme']
        });

        /* Capture the current wallpaper once more immediately before focus.
           Do NOT touch viewport geometry. */
        document.addEventListener('focusin', (event) => {
            const el = event.target;
            if (!(el instanceof HTMLElement)) return;
            if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
                syncDocumentWallpaper();
            }
        }, true);

        window.addEventListener('pageshow', scheduleWallpaperSync, { passive: true });
        window.addEventListener('orientationchange', () => setTimeout(scheduleWallpaperSync, 350), { passive: true });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
