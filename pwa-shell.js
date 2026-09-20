(() => {
    'use strict';

    const isStandalone = () =>
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    if (!isStandalone()) return;

    const root = document.documentElement;
    root.classList.add('eve-standalone');

    let backdrop = null;
    let overlay = null;
    let phone = null;
    let wallpaper = null;
    let raf = 0;
    let observer = null;

    const transparent = c =>
        !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || c === 'rgba(0,0,0,0)';

    // Same stable-height logic as the working first PWA shell.
    const setStableHeight = () => {
        const screenH = Number(window.screen && window.screen.height) || 0;
        const innerH = Number(window.innerHeight) || 0;
        const clientH = Number(document.documentElement.clientHeight) || 0;
        const h = Math.max(screenH, innerH, clientH);
        if (h > 0) {
            root.style.setProperty('--eve-app-height', `${Math.round(h)}px`);
        }
    };

    function ensureLayers() {
        if (!document.body) return false;

        if (!backdrop) {
            backdrop = document.getElementById('eve-fullbleed-backdrop');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.id = 'eve-fullbleed-backdrop';
                document.body.insertBefore(backdrop, document.body.firstChild);
            }
        }

        if (!overlay) {
            overlay = document.getElementById('eve-fullbleed-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'eve-fullbleed-overlay';
                document.body.appendChild(overlay);
            }
        }
        return true;
    }

    function isVisible(el) {
        if (!el) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
    }

    function getActiveAppScreen() {
        if (!phone) phone = document.getElementById('phone-screen');
        if (!phone) return null;
        const screens = Array.from(phone.querySelectorAll(':scope > .app-screen'));
        let active = null;
        for (const el of screens) if (isVisible(el)) active = el;
        return active;
    }

    function copyBackground(source) {
        if (!backdrop || !source) return;
        const cs = getComputedStyle(source);

        backdrop.style.backgroundImage = cs.backgroundImage && cs.backgroundImage !== 'none'
            ? cs.backgroundImage
            : 'none';
        backdrop.style.backgroundColor = transparent(cs.backgroundColor)
            ? 'transparent'
            : cs.backgroundColor;
        backdrop.style.backgroundSize = cs.backgroundSize || 'cover';
        backdrop.style.backgroundPosition = cs.backgroundPosition || 'center';
        backdrop.style.backgroundRepeat = cs.backgroundRepeat || 'no-repeat';
        backdrop.style.backgroundOrigin = cs.backgroundOrigin || 'padding-box';
        backdrop.style.backgroundClip = cs.backgroundClip || 'border-box';
    }

    function syncScene() {
        raf = 0;
        if (!ensureLayers()) return;
        setStableHeight();

        if (!phone) phone = document.getElementById('phone-screen');
        if (!wallpaper) wallpaper = document.getElementById('wallpaper-element');

        const active = getActiveAppScreen();

        if (active) {
            if (wallpaper) wallpaper.classList.remove('eve-wallpaper-bridged');
            copyBackground(active);
        } else if (wallpaper) {
            // Read background first, then make the original wallpaper paint transparent.
            wallpaper.classList.remove('eve-wallpaper-bridged');
            copyBackground(wallpaper);
            wallpaper.classList.add('eve-wallpaper-bridged');
        }

        // Mirror only the visible modal dimmer, not the modal card itself.
        const modalCandidates = Array.from(document.querySelectorAll(
            '.modal, .sms-manage-modal, #eve-terms-modal, .game-exit-overlay, #image-viewer-modal'
        ));
        let modalBg = '';
        for (let i = modalCandidates.length - 1; i >= 0; i--) {
            const el = modalCandidates[i];
            if (!isVisible(el)) continue;
            const bg = getComputedStyle(el).backgroundColor;
            if (bg && !transparent(bg)) {
                modalBg = bg;
                break;
            }
        }

        if (modalBg) {
            overlay.style.background = modalBg;
            overlay.style.display = 'block';
        } else {
            overlay.style.display = 'none';
            overlay.style.background = 'transparent';
        }
    }

    function scheduleSync() {
        if (raf) return;
        raf = requestAnimationFrame(syncScene);
    }

    function init() {
        if (document.body) document.body.classList.add('eve-standalone');
        setStableHeight();
        ensureLayers();
        phone = document.getElementById('phone-screen');
        wallpaper = document.getElementById('wallpaper-element');
        syncScene();

        if (phone && typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(scheduleSync);
            observer.observe(phone, {
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }

        window.addEventListener('pageshow', scheduleSync, { passive: true });
        window.addEventListener('orientationchange', () => {
            setTimeout(scheduleSync, 350);
            setTimeout(scheduleSync, 800);
        }, { passive: true });

        // Wallpaper/theme settings can be applied asynchronously after startup.
        [80, 250, 600, 1200, 2500].forEach(ms => setTimeout(scheduleSync, ms));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
