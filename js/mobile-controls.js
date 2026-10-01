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
