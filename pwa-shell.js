(() => {
    'use strict';

    const root = document.documentElement;

    const isIOS = () => {
        const ua = navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    };

    const isStandalone = () =>
        window.navigator.standalone === true ||
        !!window.matchMedia?.('(display-mode: standalone)').matches ||
        !!window.matchMedia?.('(display-mode: fullscreen)').matches;

    if (!isIOS() || !isStandalone()) return;

    root.classList.add('eve-standalone');

    let stableAppHeight = 0;
    let stableTopGap = 0;
    let raf = 0;
    let wallpaper = null;
    let phone = null;
    let backdrop = null;
    let overlay = null;
    let observer = null;

    const px = n => `${Math.max(0, Math.round(Number(n) || 0))}px`;

    const transparent = c =>
        !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || c === 'rgba(0,0,0,0)';

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

    function readSafeInsets() {
        if (!document.body) return { top: 0, bottom: 0 };
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
        const result = {
            top: Math.round(parseFloat(cs.paddingTop) || 0),
            bottom: Math.round(parseFloat(cs.paddingBottom) || 0)
        };
        probe.remove();
        return result;
    }

    function updateGeometry() {
        const innerH = Math.round(window.innerHeight || 0);
        const clientH = Math.round(document.documentElement.clientHeight || 0);
        const vvH = Math.round(window.visualViewport?.height || innerH || clientH || 0);
        const vvTop = Math.round(window.visualViewport?.offsetTop || 0);

        // Use ONLY the real interactive viewport for EVE's UI. Never screen.height.
        const normalCandidate = Math.max(innerH, clientH, vvH + vvTop);

        if (!stableAppHeight || normalCandidate > stableAppHeight) {
            stableAppHeight = normalCandidate;
        }

        const keyboardOpen = vvH > 150 && stableAppHeight > 0 && vvH < stableAppHeight - 120;

        // The top-gap is measured only while the keyboard is closed, then frozen.
        if (!keyboardOpen) {
            const screenH = Math.round(window.screen?.height || 0);
            if (screenH > 0 && normalCandidate > 0) {
                const measured = screenH - normalCandidate;
                // iPhone Home-Screen status-bar gaps are normally under ~100 CSS px.
                if (measured >= 0 && measured <= 120) stableTopGap = measured;
            }
        }

        const physicalH = Math.max(stableAppHeight + stableTopGap, window.screen?.height || 0);

        root.style.setProperty('--eve-app-height', px(stableAppHeight || normalCandidate));
        root.style.setProperty('--eve-top-gap', px(stableTopGap));
        root.style.setProperty('--eve-physical-height', px(physicalH));

        if (keyboardOpen && vvTop > 0) {
            // Do not move the app; only cancel iOS viewport scroll drift.
            window.scrollTo(0, 0);
        }
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
        for (const el of screens) {
            if (isVisible(el)) active = el;
        }
        return active;
    }

    function applyBackgroundFrom(source) {
        if (!backdrop || !source) return;
        const cs = getComputedStyle(source);
        const color = cs.backgroundColor;
        const image = cs.backgroundImage;

        backdrop.style.backgroundImage = image && image !== 'none' ? image : 'none';
        backdrop.style.backgroundColor = transparent(color) ? 'transparent' : color;
        backdrop.style.backgroundSize = cs.backgroundSize || 'cover';
        backdrop.style.backgroundPosition = cs.backgroundPosition || 'center';
        backdrop.style.backgroundRepeat = cs.backgroundRepeat || 'no-repeat';
        backdrop.style.backgroundOrigin = cs.backgroundOrigin || 'padding-box';
        backdrop.style.backgroundClip = cs.backgroundClip || 'border-box';
    }

    function syncScene() {
        raf = 0;
        if (!ensureLayers()) return;
        updateGeometry();

        if (!phone) phone = document.getElementById('phone-screen');
        if (!wallpaper) wallpaper = document.getElementById('wallpaper-element');

        const activeScreen = getActiveAppScreen();

        if (activeScreen) {
            // An app page is open: continue that page's real background upward.
            if (wallpaper) wallpaper.classList.remove('eve-wallpaper-bridged');
            applyBackgroundFrom(activeScreen);
        } else if (wallpaper) {
            // Home screen: the ENTIRE wallpaper paint lives on one full-screen layer.
            // This is not a sampled color strip; it is the same image/color background.
            wallpaper.classList.remove('eve-wallpaper-bridged');
            applyBackgroundFrom(wallpaper);
            wallpaper.classList.add('eve-wallpaper-bridged');
        }

        // Extend the currently visible dimmer over the same top-gap without moving UI.
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

        window.addEventListener('resize', scheduleSync, { passive: true });
        window.addEventListener('orientationchange', () => {
            stableAppHeight = 0;
            stableTopGap = 0;
            setTimeout(scheduleSync, 120);
            setTimeout(scheduleSync, 500);
        }, { passive: true });
        window.addEventListener('pageshow', scheduleSync, { passive: true });

        window.visualViewport?.addEventListener('resize', scheduleSync, { passive: true });
        window.visualViewport?.addEventListener('scroll', scheduleSync, { passive: true });

        document.addEventListener('focusin', scheduleSync, true);
        document.addEventListener('focusout', () => setTimeout(scheduleSync, 220), true);

        // iOS standalone can publish final viewport numbers late after cold launch.
        [80, 250, 600, 1500, 3000].forEach(ms => setTimeout(scheduleSync, ms));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
