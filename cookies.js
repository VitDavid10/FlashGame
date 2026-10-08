/*
 * Cookie notice and Google Analytics (landing page and game).
 *
 * Analytics only loads if the visitor accepts it. With no answer, or after
 * REJECT, nothing is requested from Google. The choice is kept in localStorage
 * (pw_cookies = 'yes' | 'no') and can be reset from privacy.html.
 * ACCEPT and REJECT carry the same weight on purpose: rejecting has to be as
 * easy as accepting.
 */
(function () {
    var STORAGE_KEY = 'pw_cookies', GA_ID = 'G-WER49F1YEH';
    var choice = null;
    try { choice = localStorage.getItem(STORAGE_KEY); } catch (e) {}

    // The gtag queue always exists, so any call works even if Analytics never
    // loads: it just stays in the queue and never leaves the page.
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

    // Inside the Solana dApp Store app (its WebView adds this to the user
    // agent): no notice and no Analytics at all.
    if (navigator.userAgent.indexOf('Solana Mobile Web Shell') !== -1) return;

    function loadAnalytics() {
        if (window.__pwAnalytics) return;
        window.__pwAnalytics = true;
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
        document.head.appendChild(s);
        window.gtag('js', new Date());
        window.gtag('config', GA_ID);
    }
    if (choice === 'yes') loadAnalytics();

    // Only the top window shows the notice: the landing page embeds the game as
    // the hero background (game/?hero=1) and that copy must not ask again.
    // The game page never shows the notice (it covers the menu); Analytics there still follows the choice made on the landing page.
    if (choice === 'yes' || choice === 'no' || window.top !== window.self || /^\/game(\/|$)/.test(location.pathname)) return;

    function mount() {
        var css = document.createElement('style');
        css.textContent =
            '#pwCookies{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;' +
            'width:min(760px,calc(100% - 24px));box-sizing:border-box;display:flex;align-items:center;gap:18px;' +
            'padding:14px 18px;background:rgba(5,8,6,.94);border:2px solid #00ff88;' +
            'box-shadow:0 0 0 2px #000,6px 6px 0 2px rgba(0,0,0,.55),0 0 18px rgba(0,255,136,.25);' +
            "font-family:'Press Start 2P',monospace;color:#cfe9dd}" +
            '#pwCookies p{margin:0;flex:1;font-size:10px;line-height:1.8;letter-spacing:.5px}' +
            '#pwCookies a{color:#ffce3d;text-decoration:none;border-bottom:2px solid rgba(255,206,61,.45)}' +
            '#pwCookies .pwc-btns{display:flex;gap:10px;flex-shrink:0}' +
            "#pwCookies button{font-family:'Press Start 2P',monospace;font-size:10px;letter-spacing:1px;" +
            'min-width:112px;padding:11px 12px;cursor:pointer;color:#fff;background:#14171c;' +
            'border:2px solid #00ff88;box-shadow:3px 3px 0 #000;text-shadow:2px 2px 0 rgba(0,0,0,.65)}' +
            '#pwCookies button:hover{background:#00ff88;color:#04150c;text-shadow:none}' +
            '#pwCookies button:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #000}' +
            '@media (max-width:640px){#pwCookies{flex-direction:column;align-items:stretch;gap:12px;bottom:10px;padding:12px 14px}' +
            '#pwCookies p{font-size:9px}#pwCookies .pwc-btns button{flex:1;min-width:0}}';
        document.head.appendChild(css);

        var box = document.createElement('div');
        box.id = 'pwCookies';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Cookies');
        box.innerHTML =
            '<p>We use cookies only for anonymous stats (Google Analytics). ' +
            'The game works the same if you say no. <a href="/privacy.html#cookies">PRIVACY</a></p>' +
            '<div class="pwc-btns"><button type="button" data-choice="no">REJECT</button>' +
            '<button type="button" data-choice="yes">ACCEPT</button></div>';
        box.addEventListener('click', function (e) {
            var v = e.target && e.target.getAttribute && e.target.getAttribute('data-choice');
            if (!v) return;
            try { localStorage.setItem(STORAGE_KEY, v); } catch (e2) {}
            if (v === 'yes') loadAnalytics();
            box.remove();
        });
        document.body.appendChild(box);
    }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();
