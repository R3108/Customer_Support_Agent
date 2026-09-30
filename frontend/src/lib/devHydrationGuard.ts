/**
 * Attributes that browser extensions stamp onto the page before React hydrates (form fillers and password
 * managers: fdprocessedid; Bitdefender: bis_*; Grammarly: data-gr-*). They make React report a hydration
 * mismatch that has nothing to do with our code.
 */
const EXTENSION_ATTRIBUTES = ["fdprocessedid", "bis_skin_checked", "bis_register", "data-new-gr-c-s-check-loaded", "data-gr-ext-installed"];

/**
 * Development-only script, inlined at the top of <head>: strips those attributes as soon as they appear so the
 * dev overlay only shows real mismatches. Mutation callbacks run as microtasks, before React's hydration task.
 * It stops watching 10s after load, once hydration is long done. Production ignores these attributes anyway.
 */
export const DEV_HYDRATION_GUARD_SCRIPT = `(function(){try{var a=${JSON.stringify(EXTENSION_ATTRIBUTES)};var o=new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var t=ms[i].target,n=ms[i].attributeName;if(t.hasAttribute&&t.hasAttribute(n))t.removeAttribute(n)}});o.observe(document.documentElement,{attributes:true,attributeFilter:a,subtree:true});addEventListener("load",function(){setTimeout(function(){o.disconnect()},10000)})}catch(e){}})();`;
