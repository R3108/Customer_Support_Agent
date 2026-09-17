/*!
 * Relay support widget — paste one tag on any website:
 *   <script src="https://YOUR-RELAY-APP/widget.js" async></script>
 * Optional attributes: data-position="left|right", data-color="#4f46e5", data-open="true",
 * data-customer-id="..." (demo only — in production pass a signed session token instead).
 */
(function () {
  if (window.__relayWidgetLoaded) return;
  window.__relayWidgetLoaded = true;

  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  if (!script) return;
  var origin = new URL(script.src, window.location.href).origin;
  var side = script.getAttribute("data-position") === "left" ? "left" : "right";
  var color = script.getAttribute("data-color") || "#4f46e5";
  var customer = script.getAttribute("data-customer-id") || "";
  var mobile = window.matchMedia("(max-width: 480px)");

  var root = document.createElement("div");
  root.setAttribute("data-relay-widget", "");
  root.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;font-family:system-ui,sans-serif;";

  var frameWrap = document.createElement("div");
  frameWrap.style.cssText =
    "position:absolute;bottom:72px;" + side + ":0;width:390px;height:620px;max-height:calc(100vh - 110px);max-width:calc(100vw - 40px);" +
    "border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,.28);background:#fff;opacity:0;transform:translateY(8px) scale(.98);" +
    "transform-origin:bottom " + side + ";transition:opacity .18s ease,transform .18s ease;pointer-events:none;";

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Open support chat");
  button.style.cssText =
    "width:56px;height:56px;border-radius:9999px;border:0;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;" +
    "box-shadow:0 10px 25px rgba(15,23,42,.25);transition:transform .15s ease;background:" + color + ";";
  var chatIcon =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  var closeIcon =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  button.innerHTML = chatIcon;
  button.onmouseenter = function () { button.style.transform = "scale(1.06)"; };
  button.onmouseleave = function () { button.style.transform = "scale(1)"; };

  var iframe = null;
  var isOpen = false;

  function layout() {
    if (mobile.matches && isOpen) {
      frameWrap.style.position = "fixed";
      frameWrap.style.inset = "0";
      frameWrap.style.width = "100vw";
      frameWrap.style.height = "100dvh";
      frameWrap.style.maxHeight = "none";
      frameWrap.style.maxWidth = "none";
      frameWrap.style.borderRadius = "0";
    } else {
      frameWrap.style.position = "absolute";
      frameWrap.style.inset = "";
      frameWrap.style.bottom = "72px";
      frameWrap.style[side] = "0";
      frameWrap.style.width = "390px";
      frameWrap.style.height = "620px";
      frameWrap.style.maxHeight = "calc(100vh - 110px)";
      frameWrap.style.maxWidth = "calc(100vw - 40px)";
      frameWrap.style.borderRadius = "16px";
    }
  }

  function toggle(open) {
    isOpen = open;
    if (open && !iframe) {
      iframe = document.createElement("iframe");
      iframe.src = origin + "/embed" + (customer ? "?customer=" + encodeURIComponent(customer) : "");
      iframe.title = "Support chat";
      iframe.allow = "clipboard-write";
      iframe.style.cssText = "width:100%;height:100%;border:0;display:block;";
      frameWrap.appendChild(iframe);
    }
    layout();
    frameWrap.style.opacity = open ? "1" : "0";
    frameWrap.style.transform = open ? "none" : "translateY(8px) scale(.98)";
    frameWrap.style.pointerEvents = open ? "auto" : "none";
    button.innerHTML = open ? closeIcon : chatIcon;
    button.setAttribute("aria-label", open ? "Close support chat" : "Open support chat");
    button.style.display = open && mobile.matches ? "none" : "flex";
  }

  button.addEventListener("click", function () { toggle(!isOpen); });
  window.addEventListener("message", function (event) {
    if (event.origin !== origin || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "relay:close") toggle(false);
    if (event.data.type === "relay:config" && /^#[0-9a-f]{6}$/i.test(event.data.accent || "") && !script.getAttribute("data-color")) {
      button.style.background = event.data.accent;
    }
  });
  mobile.addEventListener && mobile.addEventListener("change", layout);

  root.appendChild(frameWrap);
  root.appendChild(button);
  (document.body || document.documentElement).appendChild(root);
  if (script.getAttribute("data-open") === "true") toggle(true);

  window.Relay = { open: function () { toggle(true); }, close: function () { toggle(false); } };
})();
