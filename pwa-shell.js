(() => {
    'use strict';

    const isStandalone = () =>
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    if (!isStandalone()) return;

    // Mark the document before paint as early as a deferred script allows.
    document.documentElement.classList.add('eve-standalone');

    // Capture the FULL installed-app canvas once. Keyboard/VisualViewport
    // changes must not redefine the root height. We only refresh on orientation.
    const setStableHeight = () => {
        const screenH = Number(window.screen && window.screen.height) || 0;
        const innerH = Number(window.innerHeight) || 0;
        const clientH = Number(document.documentElement.clientHeight) || 0;
        const h = Math.max(screenH, innerH, clientH);
        if (h > 0) {
            document.documentElement.style.setProperty('--eve-app-height', `${Math.round(h)}px`);
        }
    };

    const markBody = () => {
        if (document.body) document.body.classList.add('eve-standalone');
        setStableHeight();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', markBody, { once: true });
    } else {
        markBody();
    }

    window.addEventListener('orientationchange', () => {
        // Wait for iOS to publish the new screen dimensions.
        setTimeout(setStableHeight, 350);
        setTimeout(setStableHeight, 800);
    }, { passive: true });

    // Deliberately NO visualViewport resize/scroll handlers here.
    // Those events fire during keyboard animation and caused the older patches
    // to move/repaint the top strip.
})();
