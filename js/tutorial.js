(() => {
  const overlay = document.getElementById("tutorialOverlay");
  const card = document.getElementById("tutorialCard");
  const title = document.getElementById("tutorialTitle");
  const text = document.getElementById("tutorialText");
  const label = document.getElementById("tutorialStepLabel");
  const next = document.getElementById("tutorialNext");
  const back = document.getElementById("tutorialBack");
  const close = document.getElementById("tutorialClose");
  const spotlight = document.getElementById("tutorialSpotlight");
  const confirmModal = document.getElementById("tutorialConfirmModal");
  const confirmYes = document.getElementById("tutorialConfirmYes");
  const confirmNo = document.getElementById("tutorialConfirmNo");
  const confirmClose = document.getElementById("tutorialConfirmClose");
  if (!overlay) return;

  const steps = [
    {section:"dashboard", selector:"[data-tour='dashboard-overview']", title:"Dashboard", text:"This is your commuting overview. See trips, saved routes, CO₂ savings, your Eco Score, and quick access to your most-used tools."},
    {section:"dashboard", selector:"[data-tour='quick-route']", title:"Quick Route", text:"Enter your origin and destination here to quickly plan a trip without opening the full Route Planner."},
    {section:"dashboard", selector:"[data-tour='sustainability']", title:"Sustainability Impact", text:"Track estimated CO₂ savings and your environmental impact for this week, this month, or all time."},
    {section:"planner", selector:"[data-tour='route-planner']", title:"Route Planner", text:"Choose Commute Mode or Private Vehicle, enter From and To, compare route options, and view travel details such as time, fare, and CO₂."},
    {section:"trips", selector:"[data-tour='my-trips']", title:"My Trips", text:"Review your completed trips and keep a history of the routes you have taken."},
    {section:"saved", selector:"[data-tour='saved-routes']", title:"Saved Routes", text:"Save frequently used routes so you can reuse them later, and edit or delete them when needed."},
    {section:"reports", selector:"[data-tour='reports']", title:"Reports", text:"View commuting insights such as route recommendations, travel time, cost, CO₂ reduction, travel history, and sustainability impact."},
    {section:"community", selector:"[data-tour='community']", title:"Community", text:"Find or create carpool matches by sharing a route and available seats with other commuters."},
    {section:"settings", selector:"[data-tour='settings']", title:"Settings", text:"Customize CommuteIT here. Toggle Dark Mode on or off, manage your preferences, and let your choices save automatically. Registered users can also update their name. Use Start Tutorial to replay this tour anytime."},
    {section:"about", selector:"[data-tour='about']", title:"About CommuteIT", text:"Learn what CommuteIT provides, including live navigation, multi-modal planning, Eco-Score, travel reports, and the steps from planning a route to reviewing its impact."}
  ];
  let index = 0;
  let activeElement = null;

  function nav(section){
    const link = document.querySelector(`.side-link[data-section="${section}"]`);
    if (link) link.click();
    else if (window.CommuteITApp) window.CommuteITApp.navigateSection(section);
  }

  function clearHighlight(){
    if (activeElement) activeElement.classList.remove("tutorial-highlight");
    activeElement = null;
    if (spotlight) spotlight.style.display = "none";
  }

  function position(el){
    if (!el || !spotlight || !card) return;
    activeElement = el;
    el.classList.add("tutorial-highlight");
    const r = el.getBoundingClientRect();
    const pad = 7;
    spotlight.style.display = "block";
    spotlight.style.left = `${Math.max(4, r.left-pad)}px`;
    spotlight.style.top = `${Math.max(4, r.top-pad)}px`;
    spotlight.style.width = `${Math.min(window.innerWidth-8, r.width+pad*2)}px`;
    spotlight.style.height = `${Math.min(window.innerHeight-8, r.height+pad*2)}px`;

    // Place the tutorial card next to the tile it is explaining.
    const gap = 16;
    const cw = card.offsetWidth || Math.min(560, window.innerWidth-28);
    const ch = card.offsetHeight || 220;
    let left = r.left + r.width/2 - cw/2;
    let top = r.bottom + gap;
    if (top + ch > window.innerHeight - 12) top = r.top - ch - gap;
    if (top < 12) top = Math.max(12, Math.min(window.innerHeight-ch-12, r.top + r.height/2 - ch/2));
    left = Math.max(12, Math.min(window.innerWidth-cw-12, left));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.bottom = "auto";
    card.style.transform = "none";
  }

  function render(){
    const st=steps[index];
    clearHighlight();
    nav(st.section);
    setTimeout(()=>{
      const el=document.querySelector(st.selector) || document.querySelector(`#section-${st.section}`);
      if (el) {
        el.scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"});
        setTimeout(()=>position(el),280);
      }
      label.textContent=`Step ${index+1} of ${steps.length}`;
      title.textContent=st.title;
      text.textContent=st.text;
      back.disabled=index===0;
      next.textContent=index===steps.length-1?"Finish":"Next";
    },140);
  }

  function start(){
    index=0;
    clearHighlight();
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden","false");
    render();
  }
  function showStartConfirmation(){
    if (!confirmModal) return start();
    confirmModal.classList.remove("hidden");
    confirmModal.setAttribute("aria-hidden","false");
  }
  function hideStartConfirmation(){
    confirmModal?.classList.add("hidden");
    confirmModal?.setAttribute("aria-hidden","true");
  }
  function finish(){
    clearHighlight();
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden","true");
    card.style.left=""; card.style.top=""; card.style.bottom=""; card.style.transform="";
    localStorage.removeItem("commuteit_tutorial_start");
    localStorage.setItem("commuteit_tutorial_completed","1");
    try{localStorage.setItem("commuteit_welcome_v73_seen","1")}catch{}
    nav("dashboard");
  }

  next?.addEventListener("click",()=>{ if(index<steps.length-1){index++;render();}else finish(); });
  back?.addEventListener("click",()=>{if(index>0){index--;render();}});
  close?.addEventListener("click",finish);
  window.CommuteITTutorial={start,finish};
  document.getElementById("dashboardInfoBtn")?.addEventListener("click",showStartConfirmation);
  document.getElementById("settingsStartTutorial")?.addEventListener("click",showStartConfirmation);
  confirmYes?.addEventListener("click",()=>{ hideStartConfirmation(); start(); });
  confirmNo?.addEventListener("click",hideStartConfirmation);
  confirmClose?.addEventListener("click",hideStartConfirmation);
  confirmModal?.querySelector(".tutorial-confirm-dim")?.addEventListener("click",hideStartConfirmation);

  window.addEventListener("resize",()=>{
    if (overlay.classList.contains("hidden") || !activeElement) return;
    position(activeElement);
  });
  window.addEventListener("scroll",()=>{
    if (overlay.classList.contains("hidden") || !activeElement) return;
    position(activeElement);
  }, {passive:true});

  if (document.body.classList.contains("app-page")) {
    const shouldStart=localStorage.getItem("commuteit_tutorial_start")==="1";
    if (shouldStart) setTimeout(start,650);
  }
})();
