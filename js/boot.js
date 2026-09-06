"use strict";
/* ---------- Boot ---------- */
finalizeStaleSessions();
render();
initAuth();
window.addEventListener('online', ()=>{ if(currentUser) syncPending(); });
// Skip the SW on localhost so edits land on a plain refresh; unregister any
// stale one left over from an earlier visit.
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  if(isLocalDev){
    navigator.serviceWorker.getRegistrations()
      .then(rs => rs.forEach(r => r.unregister())).catch(()=>{});
  } else {
    navigator.serviceWorker.register("sw.js").then(reg=>{
      // Ask for an update check on launch and whenever the app comes back to
      // the foreground. A home-screen PWA is rarely "navigated", so without
      // this a new worker can sit undiscovered for a long time.
      const check = ()=>{ try{ reg.update(); }catch(_){} };
      check();
      document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) check(); });
    }).catch(()=>{});

    // A new worker took over: offer a one-tap reload rather than telling
    // someone to quit and reopen twice.
    let _reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", ()=>{
      if(_reloading) return;
      toastAction("New version ready", "Reload", ()=>{ _reloading = true; location.reload(); }, true);
    });
    navigator.serviceWorker.addEventListener("message", ev=>{
      if(!ev.data) return;
      if(ev.data.type === "update-ready")
        toastAction("New version ready", "Reload", ()=>location.reload(), true);
      if(ev.data.type === "version"){
        _swCache = ev.data.cache;
        if(activeTab === "more") renderMore();
      }
    });
  }
}
