(() => {
  const cfg = window.COMMUTEIT_CONFIG || {};
  const SB = window.COMMUTEIT_SB;
  const USER_KEY = "commuteit_user";

  const getStoredUser = () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; }
  };
  const saveUser = user => localStorage.setItem(USER_KEY, JSON.stringify(user));
  const clearDemoBrowserData = () => {
    ["commuteit_saved_routes","commuteit_trips","commuteit_last_route"].forEach(k => localStorage.removeItem(k));
  };
  const showMessage = (id, text, success=false) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = "form-message" + (success ? " success" : "");
  };
  const goDashboard = () => window.location.href = "dashboard.html";
  const hasRemoteAuth = !!SB;

  document.querySelectorAll("[data-password-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.passwordToggle);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  async function demoLogin(startTutorial=false) {
    clearDemoBrowserData();
    if (startTutorial) { localStorage.setItem("commuteit_tutorial_start", "1"); }
    if (hasRemoteAuth && cfg.demo?.useAnonymousAuth !== false) {
      const { data, error } = await SB.auth.signInAnonymously();
      if (error) throw error;
      const u = data.user;
      saveUser({
        id: u.id, firstName: cfg.demo?.firstName || "Anonymous", lastName: cfg.demo?.lastName || "",
        email: "demo@commuteit.local", demo: true, anonymous: true
      });
    } else {
      saveUser({firstName:cfg.demo?.firstName || "Anonymous",lastName:"",email:"demo@commuteit.com",demo:true});
    }
    goDashboard();
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async e => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value.trim().toLowerCase();
      const password = document.getElementById("loginPassword").value;
      try {
        if (hasRemoteAuth) {
          const { data, error } = await SB.auth.signInWithPassword({email, password});
          if (error) throw error;
          const meta = data.user.user_metadata || {};
          saveUser({id:data.user.id, firstName:meta.first_name || meta.firstName || email.split("@")[0], lastName:meta.last_name || meta.lastName || "", email:data.user.email, demo:false});
        } else {
          const demo = email === "demo@commuteit.com" && password === "123456";
          const accounts = JSON.parse(localStorage.getItem("commuteit_accounts") || "{}");
          if (!demo && (!accounts[email] || accounts[email].password !== password)) {
            showMessage("loginMessage", "Incorrect email or password.");
            return;
          }
          saveUser(demo ? {firstName:"Anonymous",lastName:"",email,demo:true} : accounts[email]);
        }
        showMessage("loginMessage", "Signed in successfully.", true);
        setTimeout(goDashboard, 250);
      } catch (err) {
        showMessage("loginMessage", err?.message || "Unable to sign in.");
      }
    });
  }

  window.CommuteITAuth = {
    startDemoTutorial: () => demoLogin(true)
  };

  document.getElementById("demoLogin")?.addEventListener("click", async () => {
    const btn = document.getElementById("demoLogin");
    try {
      btn.disabled = true; btn.textContent = "Starting demo…";
      await demoLogin();
    } catch (err) {
      btn.disabled = false; btn.textContent = "Use demo account";
      showMessage("loginMessage", err?.message || "Could not start the demo account.");
    }
  });

  // Version 73: the landing page goes directly to the Welcome card. Preferences are
  // saved automatically in local storage; there is no cookie-consent gate.
  const optionsToggle = document.getElementById("landingOptionsToggle");
  const optionsPanel = document.getElementById("landingOptionsPanel");
  const optionsHint = document.getElementById("landingOptionsHint");
  if (optionsToggle && optionsPanel) {
    const setOptionsOpen = open => {
      optionsPanel.classList.toggle("is-open", open);
      optionsPanel.setAttribute("aria-hidden", String(!open));
      optionsToggle.setAttribute("aria-expanded", String(open));
      optionsToggle.setAttribute("aria-label", open ? "Close options" : "Open options");
      if (optionsHint) optionsHint.classList.add("is-hidden");
    };
    optionsToggle.addEventListener("click", () => setOptionsOpen(!optionsPanel.classList.contains("is-open")));
    document.addEventListener("click", event => {
      if (!event.target.closest(".landing-options-wrap")) setOptionsOpen(false);
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape") setOptionsOpen(false); });
  }
  if (optionsHint) {
    window.setTimeout(() => optionsHint.classList.add("is-hidden"), 15000);
  }

  const landingInfoBtn = document.getElementById("landingInfoBtn");
  const landingWelcomeGate = document.getElementById("landingWelcomeGate");
  const landingWelcomeClose = document.getElementById("landingWelcomeClose");
  const landingWelcomeStart = document.getElementById("landingWelcomeStart");
  const landingWelcomeSkip = document.getElementById("landingWelcomeSkip");
  const landingConfirmModal = document.getElementById("landingTutorialConfirmModal");
  const landingConfirmTitle = document.getElementById("landingTutorialConfirmTitle");
  const landingConfirmText = document.getElementById("landingTutorialConfirmText");
  const landingConfirmYes = document.getElementById("landingTutorialConfirmYes");
  const landingConfirmNo = document.getElementById("landingTutorialConfirmNo");
  const landingConfirmClose = document.getElementById("landingTutorialConfirmClose");
  let landingConfirmMode = "start";

  const storageGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const storageSet = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const welcomeSeen = () => storageGet("commuteit_welcome_v73_seen") === "1";
  const markWelcomeSeen = () => storageSet("commuteit_welcome_v73_seen", "1");

  function setLandingLock(locked){
    document.body.classList.toggle("landing-welcome-open", !!locked);
    document.body.classList.toggle("landing-gate-open", !!locked);
    landingWelcomeGate?.setAttribute("aria-hidden", locked ? "false" : "true");
  }
  function closeWelcome(){
    markWelcomeSeen();
    landingWelcomeGate?.classList.add("hidden");
    setLandingLock(false);
  }
  function openWelcome(){
    if (!landingWelcomeGate) return;
    landingWelcomeGate.classList.remove("hidden");
    landingWelcomeGate.style.display = "grid";
    setLandingLock(true);
  }
  function configureConfirmation(mode){
    landingConfirmMode = mode;
    if(!landingConfirmTitle || !landingConfirmText || !landingConfirmNo || !landingConfirmYes) return;
    if(mode === "skip") {
      landingConfirmTitle.textContent = "Skip the tutorial?";
      landingConfirmText.textContent = "You can explore CommuteIT yourself and start the tutorial later from the help button.";
      landingConfirmNo.textContent = "Keep Tutorial";
      landingConfirmYes.textContent = "Skip Tutorial";
    } else {
      landingConfirmTitle.textContent = "Start a guided tutorial?";
      landingConfirmText.textContent = "We’ll walk you through the main CommuteIT features step by step. You can stop anytime.";
      landingConfirmNo.textContent = "Never mind";
      landingConfirmYes.textContent = "Start Tutorial";
    }
  }
  function showLandingTutorialConfirmation(mode="start"){
    if(!landingConfirmModal) return;
    configureConfirmation(mode);
    landingConfirmModal.classList.remove("hidden");
    landingConfirmModal.setAttribute("aria-hidden","false");
    document.body.classList.add("tutorial-confirm-open", "landing-gate-open");
  }
  function hideLandingTutorialConfirmation(){
    landingConfirmModal?.classList.add("hidden");
    landingConfirmModal?.setAttribute("aria-hidden","true");
    document.body.classList.remove("tutorial-confirm-open");
    if(landingWelcomeGate && !landingWelcomeGate.classList.contains("hidden")) setLandingLock(true);
    else document.body.classList.remove("landing-gate-open");
  }

  // Direct first-visit flow: Welcome appears without a cookie consent screen.
  if (landingWelcomeGate) {
    if (welcomeSeen()) closeWelcome();
    else openWelcome();
  }

  if (landingInfoBtn) {
    landingInfoBtn.classList.remove("hidden");
    landingInfoBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showLandingTutorialConfirmation("start");
    });
  }
  landingWelcomeClose?.addEventListener("click", (event) => {
    event.preventDefault();
    closeWelcome();
  });
  // Welcome-card actions are direct: no second confirmation card is shown here.
  // The confirmation card is reserved for the tutorial/help button.
  landingWelcomeStart?.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      landingWelcomeStart.disabled = true;
      landingWelcomeStart.textContent = "Starting…";
      markWelcomeSeen();
      closeWelcome();
      await demoLogin(true);
    } catch (err) {
      landingWelcomeStart.disabled = false;
      landingWelcomeStart.textContent = "Start Tutorial";
      showMessage("loginMessage", err?.message || "Could not start the tutorial.");
    }
  });
  landingWelcomeSkip?.addEventListener("click", (event) => {
    event.preventDefault();
    markWelcomeSeen();
    closeWelcome();
  });
  landingConfirmYes?.addEventListener("click", async () => {
    if(landingConfirmMode === "skip") {
      markWelcomeSeen();
      hideLandingTutorialConfirmation();
      closeWelcome();
      return;
    }
    try {
      landingConfirmYes.disabled = true;
      landingConfirmYes.textContent = "Starting…";
      markWelcomeSeen();
      hideLandingTutorialConfirmation();
      closeWelcome();
      await demoLogin(true);
    } catch (err) {
      landingConfirmYes.disabled = false;
      landingConfirmYes.textContent = "Start Tutorial";
      showMessage("loginMessage", err?.message || "Could not start the tutorial.");
    }
  });
  landingConfirmNo?.addEventListener("click", hideLandingTutorialConfirmation);
  landingConfirmClose?.addEventListener("click", hideLandingTutorialConfirmation);
  landingConfirmModal?.querySelector(".tutorial-confirm-dim")?.addEventListener("click", hideLandingTutorialConfirmation);

  // Freeze the landing page while the Welcome/tutorial confirmation is open.
  const blockGateInteraction = (event) => {
    const locked = document.body.classList.contains("landing-gate-open") || document.body.classList.contains("tutorial-confirm-open");
    if (locked) event.preventDefault();
  };
  document.addEventListener("touchmove", blockGateInteraction, {passive:false});
  document.addEventListener("wheel", blockGateInteraction, {passive:false});
  document.addEventListener("gesturestart", blockGateInteraction, {passive:false});
  document.addEventListener("gesturechange", blockGateInteraction, {passive:false});
  document.addEventListener("gestureend", blockGateInteraction, {passive:false});
  document.addEventListener("scroll", () => {
    if(document.body.classList.contains("landing-gate-open")) window.scrollTo(0,0);
  }, {passive:true});

  const signupForm = document.getElementById("signupForm");
  if (signupForm) {
    signupForm.addEventListener("submit", async e => {
      e.preventDefault();
      const firstName = document.getElementById("signupFirstName").value.trim();
      const lastName = document.getElementById("signupLastName").value.trim();
      const email = document.getElementById("signupEmail").value.trim().toLowerCase();
      const password = document.getElementById("signupPassword").value;
      const confirm = document.getElementById("signupConfirm").value;
      if (password !== confirm) return showMessage("signupMessage", "Passwords do not match.");
      if (password.length < 6) return showMessage("signupMessage", "Password must be at least 6 characters.");

      try {
        if (hasRemoteAuth) {
          const { data, error } = await SB.auth.signUp({email, password, options:{data:{first_name:firstName,last_name:lastName,full_name:[firstName,lastName].filter(Boolean).join(" ")}}});
          if (error) throw error;
          if (data.session && data.user) {
            saveUser({id:data.user.id,firstName,lastName,email,demo:false});
            showMessage("signupMessage", "Account created. Opening your dashboard…", true);
            setTimeout(goDashboard, 450);
          } else {
            showMessage("signupMessage", "Account created. Check your email to confirm the account, then sign in.", true);
          }
        } else {
          const accounts = JSON.parse(localStorage.getItem("commuteit_accounts") || "{}");
          if (accounts[email]) return showMessage("signupMessage", "An account with this email already exists.");
          accounts[email] = {firstName,lastName,email,password,demo:false};
          localStorage.setItem("commuteit_accounts", JSON.stringify(accounts));
          saveUser(accounts[email]);
          showMessage("signupMessage", "Account created. Opening your dashboard…", true);
          setTimeout(goDashboard, 450);
        }
      } catch (err) {
        showMessage("signupMessage", err?.message || "Unable to create the account.");
      }
    });
  }

  // If dashboard is opened directly, do not manufacture a Supabase session.
  // The dashboard will redirect to login if no authenticated session exists.
})();
