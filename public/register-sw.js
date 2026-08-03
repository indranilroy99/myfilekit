/*
 * Service worker registration. Kept as an external file (not inline) so it
 * satisfies the app's strict Content-Security-Policy (script-src 'self'),
 * which does not permit inline scripts. Fails silently on any error so the
 * page always loads even if registration is unavailable.
 */
(function () {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  // Only register in a secure context (https or localhost).
  if (!window.isSecureContext) {
    return;
  }
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {
      // Registration failed — ignore, the app still works without offline support.
    });
  });
})();
