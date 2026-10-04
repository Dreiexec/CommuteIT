/* CommuteIT mobile interaction controls: preserve scrolling while preventing browser pinch/gesture zoom. */
(function(){
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if(!isTouch) return;
  document.addEventListener('gesturestart', e => e.preventDefault(), {passive:false});
  document.addEventListener('gesturechange', e => e.preventDefault(), {passive:false});
  document.addEventListener('gestureend', e => e.preventDefault(), {passive:false});
  document.addEventListener('wheel', e => {
    if(e.ctrlKey) e.preventDefault();
  }, {passive:false});
})();


/* Portrait-only mobile browser experience. Browsers cannot reliably force the
   physical orientation, so landscape use is covered by a rotate-back screen. */
(function(){
  const mobileLayout = window.matchMedia('(max-width: 900px)');
  const landscape = window.matchMedia('(orientation: landscape)');
  if (!mobileLayout.matches) return;
  const gate = document.createElement('div');
  gate.id = 'portraitOrientationGate';
  gate.setAttribute('role','status');
  gate.setAttribute('aria-live','polite');
  gate.innerHTML = '<div class="portrait-gate-card"><div class="portrait-gate-icon" aria-hidden="true">↻</div><strong>Please return to portrait mode</strong><p>CommuteIT is designed for portrait viewing on mobile. Rotate your device upright to continue.</p></div>';
  const style = document.createElement('style');
  style.textContent = `
    #portraitOrientationGate{display:none;position:fixed;inset:0;z-index:2147483647;align-items:center;justify-content:center;padding:24px;background:#102b25;color:#fff;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;}
    #portraitOrientationGate .portrait-gate-card{width:min(360px,100%);padding:30px 24px;border:1px solid rgba(255,255,255,.18);border-radius:24px;background:rgba(255,255,255,.08);box-shadow:0 20px 60px rgba(0,0,0,.2);}
    #portraitOrientationGate .portrait-gate-icon{font-size:44px;line-height:1;margin-bottom:18px;}
    #portraitOrientationGate strong{display:block;font-size:21px;line-height:1.25;margin-bottom:10px;}
    #portraitOrientationGate p{margin:0;color:rgba(255,255,255,.78);font-size:14px;line-height:1.55;}
    @media screen and (max-width:900px) and (orientation:landscape){#portraitOrientationGate{display:flex;}body>*:not(#portraitOrientationGate):not(#portraitOrientationStyle){visibility:hidden!important;}body{overflow:hidden!important;}}
  `;
  style.id = 'portraitOrientationStyle';
  document.head.appendChild(style);
  document.body.appendChild(gate);
  const sync = () => { gate.style.display = mobileLayout.matches && landscape.matches ? 'flex' : 'none'; };
  mobileLayout.addEventListener?.('change',sync);
  landscape.addEventListener?.('change',sync);
  window.addEventListener('resize',sync,{passive:true});
  sync();
})();
