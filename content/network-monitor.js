/**
 * SF-Intel Studio — Network Monitor
 * Loaded into the Salesforce page's JS execution context via <script src> from injector.js.
 * Monitors fetch/XHR calls to /aura and /services/apexrest to detect LWC Apex invocations.
 *
 * Security: Only reads request URL + Aura descriptor (class/method). Never reads response bodies.
 * Data flows: page → window.postMessage → content script → service worker (memory only).
 */
(function () {
    'use strict';

    // Noise patterns — Salesforce internal telemetry / framework calls we don't care about
    var NOISE_PATTERNS = [
        'ui-instrumentation',
        'ui-analytics',
        'aura.System',
        'ComponentController',
        'beacon',
        'aura.devtools',
        'ui-telemetry'
    ];

    function isNoise(url, descriptor) {
        for (var i = 0; i < NOISE_PATTERNS.length; i++) {
            if (url.indexOf(NOISE_PATTERNS[i]) !== -1) return true;
            if (descriptor && descriptor.indexOf(NOISE_PATTERNS[i]) !== -1) return true;
        }
        return false;
    }

    // Parse the Aura POST body to extract Apex class and method name.
    // Aura sends URL-encoded form data: message={"actions":[{"descriptor":"apex://ClassName/ACTION$methodName",...}]}
    // The body is typically URL-encoded so we must decode first.
    function parseAuraDescriptor(bodyStr) {
        if (!bodyStr) return {};
        try {
            // URL-decode if needed (Aura sends application/x-www-form-urlencoded)
            var decoded = bodyStr;
            try { decoded = decodeURIComponent(bodyStr.replace(/\+/g, ' ')); } catch (e) {}

            // Match apex://ClassName/ACTION$methodName
            var match = decoded.match(/apex:\/\/([^/]+)\/ACTION\$([^"&\s]+)/);
            if (match) return { className: match[1], methodName: match[2] };

            // Fallback: try raw (unencoded) in case it wasn't encoded
            match = bodyStr.match(/apex:\/\/([^/]+)\/ACTION\$([^"&\s]+)/);
            if (match) return { className: match[1], methodName: match[2] };
        } catch (e) {}
        return {};
    }

    function postEvent(payload) {
        try {
            window.postMessage({ type: 'SF_INTEL_NET_EVENT', payload: payload }, window.location.origin);
        } catch (e) {}
    }

    // Only emit if this is a meaningful Apex call (not noise)
    function shouldEmit(url, parsed) {
        // For /apexrest — always emit (always Apex)
        if (url.indexOf('/services/apexrest') !== -1) return true;
        // For /aura — only emit if we parsed a real Apex class OR URL indicates ApexAction
        if (url.indexOf('/aura') !== -1) {
            if (parsed && parsed.className) return !isNoise(url, parsed.className);
            // ApexAction.execute in URL = it's an Apex call even if we couldn't parse body
            if (url.indexOf('ApexAction.execute') !== -1) return !isNoise(url, null);
            return false; // Skip all other /aura calls (framework, nav, etc.)
        }
        return false;
    }

    // Extract body string — duck-type approach (no instanceof, works across frames)
    function extractBodyStr(body) {
        if (!body) return null;
        if (typeof body === 'string') return body;
        // Duck-type: URLSearchParams and FormData both have .get() — no instanceof needed
        if (typeof body.get === 'function') {
            try {
                var msg = body.get('message');
                if (msg) return String(msg);
            } catch (e) {}
            // Fallback: URLSearchParams.toString() gives URL-encoded key=value string
            try {
                var s = body.toString();
                if (s && s.indexOf('[object') === -1) return s;
            } catch (e) {}
        }
        // Last resort: coerce to string if it looks useful
        try {
            var s = String(body);
            if (s && s.indexOf('[object') === -1) return s;
        } catch (e) {}
        return null;
    }

    // ── Intercept fetch (modern LWC components) ──────────────────────────────
    var _fetch = window.fetch;
    window.fetch = async function (resource, init) {
        var t0 = performance.now();
        var url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

        // Parse body BEFORE making the request (body object stays readable, but best to read early)
        var parsed = {};
        try {
            if ((url.indexOf('/aura') !== -1 || url.indexOf('/services/apexrest') !== -1) && init && init.body) {
                var bodyStr = extractBodyStr(init.body);
                if (bodyStr) parsed = parseAuraDescriptor(bodyStr);
            }
        } catch (e) {}

        var res = null, fetchErr = null;
        try {
            res = await _fetch.call(this, resource, init);
        } catch (e) {
            fetchErr = e;
        }

        try {
            if (url.indexOf('/aura') !== -1 || url.indexOf('/services/apexrest') !== -1) {
                if (shouldEmit(url, parsed)) {
                    postEvent({
                        url: url,
                        className: parsed.className || null,
                        methodName: parsed.methodName || null,
                        statusCode: res ? res.status : 0,
                        failed: !!fetchErr,
                        duration: Math.round(performance.now() - t0),
                        timestamp: new Date().toISOString()
                    });
                }
            }
        } catch (e) {}

        if (fetchErr) throw fetchErr; // re-throw so LWC error handling still works
        return res;
    };

    // ── Listen for ShowToastEvent (LWC client-side errors before any network call) ─
    // ShowToastEvent fires a CustomEvent('lightning__showtoast', { composed: true, bubbles: true })
    // which crosses all shadow DOM boundaries and reaches window.
    //
    // NOTE: We cannot use EventTarget.prototype.dispatchEvent override here because
    // the LWC framework saves a reference to the native dispatchEvent at init time
    // (before our script loads). LWC's this.dispatchEvent() uses that saved reference,
    // bypassing any prototype override. Listening on window is reliable — we catch
    // the event after it has been dispatched and is bubbling up the DOM tree.
    window.addEventListener('lightning__showtoast', function (event) {
        try {
            var d = event.detail || {};
            var variant = String(d.variant || 'info').toLowerCase();
            if (variant === 'error' || variant === 'warning') {
                window.postMessage({
                    type: 'SF_INTEL_UI_ERROR',
                    payload: {
                        title: String(d.title || 'Error'),
                        message: String(d.message || ''),
                        variant: variant,
                        timestamp: new Date().toISOString()
                    }
                }, window.location.origin);
            }
        } catch (e) {}
    }, { capture: true });

    // ── Intercept XHR (older Aura / Visualforce components) ──────────────────
    var _open = XMLHttpRequest.prototype.open;
    var _send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._sfi_url = url;
        return _open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        var self = this;
        var url = self._sfi_url || '';
        if (url.indexOf('/aura') !== -1 || url.indexOf('/services/apexrest') !== -1) {
            var t0 = performance.now();
            self.addEventListener('loadend', function () {
                try {
                    var parsed = {};
                    if (body) { var bs = extractBodyStr(body); if (bs) parsed = parseAuraDescriptor(bs); }
                    if (shouldEmit(url, parsed)) {
                        postEvent({
                            url: url,
                            className: parsed.className || null,
                            methodName: parsed.methodName || null,
                            statusCode: self.status,
                            duration: Math.round(performance.now() - t0),
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (e) {}
            });
        }
        return _send.apply(this, arguments);
    };
})();
