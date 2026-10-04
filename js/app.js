(() => {
  const CONFIG = window.COMMUTEIT_CONFIG || {};
  const USER_KEY = "commuteit_user";
  const SAVED_KEY = "commuteit_saved_routes";
  const TRIPS_KEY = "commuteit_trips";
  const LAST_KEY = "commuteit_last_route";
  const FEEDBACK_KEY = "commuteit_recommendation_feedback";
  const CARPOOL_KEY = "commuteit_carpool_posts";

  let map, trafficLayer, directionsService, directionsRenderer, autocompleteFrom, autocompleteTo;
  let userLocationCoords = null;
  let plannerCategory = "private";
  let commuteAutoTimer = null;
  let lastRoute = null;
  let userLocationMarker = null;
  let realtimeChannel = null;
  let remoteRefreshTimer = null;

  const $ = id => document.getElementById(id);
  const getJSON = (key, fallback=[]) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
  const setJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  let user = (() => { try { return JSON.parse(localStorage.getItem(USER_KEY) || '{"firstName":"Commuter"}'); } catch { return {firstName:"Commuter"}; } })();
  const SB = window.COMMUTEIT_SB;
  const isRemote = !!SB;

  const MAP_CENTER = {lat:14.5995, lng:120.9842};
  let googleMapReady = false;
  let geocoder = null;

  function initMap() {
    const mapEl = $("map");
    if (mapEl && !map && window.google?.maps) {
      map = new google.maps.Map(mapEl, {
        center: MAP_CENTER,
        zoom: 11.2,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
        rotateControl: false,
        scaleControl: false,
        gestureHandling: "greedy",
        clickableIcons: false,
        backgroundColor: "#dfeeea",
        styles: [
          {featureType:"poi", elementType:"labels", stylers:[{visibility:"off"}]}
        ]
      });
      // Google Maps TrafficLayer renders live road conditions using the standard
      // green / yellow / red traffic overlay. Keep it visible while routes are shown.
      trafficLayer = new google.maps.TrafficLayer();
      trafficLayer.setMap(map);
      directionsService = new google.maps.DirectionsService();
      directionsRenderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: false,
        preserveViewport: false,
        polylineOptions: {strokeColor:"#1976d2", strokeOpacity:.92, strokeWeight:5}
      });
      geocoder = new google.maps.Geocoder();
      googleMapReady = true;
      $("mapLoading")?.classList.add("hidden");

      const autocompleteOptions = {componentRestrictions:{country:"ph"}, fields:["formatted_address","geometry","name"]};
      if ($("fromInput") && google.maps.places?.Autocomplete) {
        autocompleteFrom = new google.maps.places.Autocomplete($("fromInput"), autocompleteOptions);
        autocompleteFrom.addListener("place_changed", () => {
          const place=autocompleteFrom.getPlace();
          const input=$("fromInput");
          if(place?.geometry?.location && input){
            input.dataset.lat=place.geometry.location.lat();
            input.dataset.lng=place.geometry.location.lng();
            updateTrainFarePreview();
            maybeAutoPlanAfterPlaceSelection();
          }
        });
      }
      if ($("toInput") && google.maps.places?.Autocomplete) {
        autocompleteTo = new google.maps.places.Autocomplete($("toInput"), autocompleteOptions);
        autocompleteTo.addListener("place_changed", () => {
          const place=autocompleteTo.getPlace();
          const input=$("toInput");
          if(place?.geometry?.location && input){
            input.dataset.lat=place.geometry.location.lat();
            input.dataset.lng=place.geometry.location.lng();
            updateTrainFarePreview();
            maybeAutoPlanAfterPlaceSelection();
          }
        });
      }
    }
    if (!window.google?.maps && $("mapLoading")) {
      $("mapLoading").classList.remove("hidden");
      $("mapLoading").querySelector("span")?.replaceChildren(document.createTextNode("Loading Google Maps…"));
    }
  }
  window.initMap = initMap;
  initMap();

  function clearMapRoute() {
    if (directionsRenderer) directionsRenderer.setDirections({routes:[]});
    // Keep the user's current-location marker visible while routes are cleared/replanned.
  }

  async function reverseGeocode(coords) {
    if (!geocoder) throw new Error("Google Maps is still loading.");
    const response=await geocoder.geocode({location:{lat:coords[1],lng:coords[0]}});
    return response.results?.[0]?.formatted_address || "Current location";
  }

  async function loadRemoteUserData(authUser) {
    if (!SB || !authUser?.id) return;
    const [savedRes, tripsRes] = await Promise.all([
      SB.from("saved_routes").select("*").eq("user_id", authUser.id).order("created_at", {ascending:false}),
      SB.from("trips").select("*").eq("user_id", authUser.id).order("occurred_at", {ascending:false})
    ]);

    if (!savedRes.error) {
      const remoteRoutes = (savedRes.data || []).map(r => ({
        id: Number(r.id), remote_id: Number(r.id), name: String(r.name || `${r.from_location || "From"} → ${r.to_location || "To"}`),
        from: String(r.from_location || ""), to: String(r.to_location || ""), mode: r.mode || "BEST",
        distanceKm: Number(r.distance_km) || 0, durationMin: Number(r.duration_min) || 0,
        fare: Number(r.fare) || 0, co2: Number(r.co2) || 0, score: Number(r.eco_score) || 0
      }));
      // Keep local routes if the remote table is temporarily empty. This prevents
      // the Saved Routes screen from becoming a blank card while the remote data
      // is syncing or while an older database has not received the route yet.
      const localRoutes = getJSON(SAVED_KEY, []);
      const merged = [...remoteRoutes];
      for (const local of localRoutes) {
        const exists = merged.some(r => (r.remote_id && local.remote_id && r.remote_id === local.remote_id) || (!local.remote_id && r.name === local.name && r.from === local.from && r.to === local.to));
        if (!exists) merged.push(local);
      }
      setJSON(SAVED_KEY, merged);
    }
    if (!tripsRes.error) {
      setJSON(TRIPS_KEY, (tripsRes.data || []).map(t => ({
        id:Number(t.id), remote_id:Number(t.id), from:t.from_location, to:t.to_location, mode:t.mode,
        distanceKm:Number(t.distance_km), durationMin:Number(t.duration_min), fare:Number(t.fare), co2:Number(t.co2), score:Number(t.eco_score),
        summary:t.summary || "", timestamp:t.occurred_at
      })));
    }
    refreshDashboard();
    renderSaved();
    renderTrips();
    refreshReports();
    loadCarpoolPosts();
    loadGovernmentInsights();
  }

  function scheduleRemoteRefresh(authUser) {
    clearTimeout(remoteRefreshTimer);
    remoteRefreshTimer = setTimeout(() => loadRemoteUserData(authUser), 120);
  }

  function subscribeToUserRealtime(authUser) {
    if (!SB || !authUser?.id) return;
    if (realtimeChannel) SB.removeChannel(realtimeChannel);

    realtimeChannel = SB.channel("commuteit-user-" + authUser.id)
      .on("postgres_changes", {event:"*", schema:"public", table:"trips", filter:`user_id=eq.${authUser.id}`}, () => scheduleRemoteRefresh(authUser))
      .on("postgres_changes", {event:"*", schema:"public", table:"saved_routes", filter:`user_id=eq.${authUser.id}`}, () => scheduleRemoteRefresh(authUser))
      .on("postgres_changes", {event:"*", schema:"public", table:"carpool_posts"}, () => loadCarpoolPosts())
      .subscribe();
  }

  // CommuteIT stores the editable display name in Supabase Auth metadata.
  // This avoids depending on a particular profiles-table column layout and
  // keeps the user's email address completely separate from their name.
  async function loadProfile(authUser) {
    return null;
  }

  async function ensureProfile(authUser) {
    return null;
  }

  function getNameFromMetadata(authUser) {
    const meta = authUser?.user_metadata || {};
    const fullName = String(meta.full_name || meta.fullName || "").trim();
    const firstName = String(meta.first_name || meta.firstName || "").trim();
    const lastName = String(meta.last_name || meta.lastName || "").trim();
    if (firstName || lastName) return { firstName, lastName };
    if (fullName) {
      const parts = fullName.split(/\s+/);
      return { firstName: parts.shift() || "", lastName: parts.join(" ") };
    }
    return { firstName: "", lastName: "" };
  }

  function updateSettingsVisibility() {
    const anonymous = !!user?.anonymous || !!user?.demo;
    // Appearance and local preferences are available to every account, including Demo/Anonymous.
    document.querySelectorAll(".settings-content").forEach(el => el.classList.remove("hidden"));
    document.querySelectorAll(".registered-only-setting").forEach(el => el.classList.toggle("hidden", anonymous));
    document.querySelectorAll(".registered-account-details").forEach(el => el.classList.toggle("hidden", anonymous));
  }

  // Preferences are saved automatically per account/device. Registered users are keyed
  // by their Supabase user id; Demo/Anonymous uses one stable demo key so its settings
  // can persist when the demo session is restarted. No profile-table columns are needed.
  function getPreferenceOwnerKey() {
    if (user?.demo || user?.anonymous) return "demo";
    if (user?.id) return `user_${String(user.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    if (user?.email) return `email_${String(user.email).toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    return "device";
  }

  function preferenceStorageKey() {
    return `commuteit_preferences_${getPreferenceOwnerKey()}`;
  }

  function getUserPreferences() {
    try {
      return JSON.parse(localStorage.getItem(preferenceStorageKey()) || "{}");
    } catch {
      return {};
    }
  }

  function saveUserPreference(name, value) {
    const prefs = getUserPreferences();
    prefs[name] = value;
    localStorage.setItem(preferenceStorageKey(), JSON.stringify(prefs));
  }

  function isDarkModeEnabled() {
    const prefs = getUserPreferences();
    return prefs.darkMode === true;
  }

  let themeTransitionTimer = null;

  function applyDarkMode(enabled, save=true) {
    const on = !!enabled;
    const root = document.documentElement;
    if (save) {
      // Turn on the slow fade only when the user flips the switch (not on page load).
      root.classList.add("theme-transition");
      clearTimeout(themeTransitionTimer);
      themeTransitionTimer = setTimeout(() => root.classList.remove("theme-transition"), 900);
    }
    root.classList.toggle("dark-mode", on);
    document.body?.classList.toggle("dark-mode", on);
    if (save) saveUserPreference("darkMode", on);
    const toggle = $("darkModeSetting");
    if (toggle) toggle.checked = on;
    const label = $("darkModeLabel");
    if (label) label.textContent = on ? "On" : "Off";
  }

  function restoreUserPreferences() {
    const prefs = getUserPreferences();
    // White is the default on every new device/browser. Dark mode is restored only
    // when this exact browser has an explicitly saved preference for this user.
    const hasExplicitDarkPreference = Object.prototype.hasOwnProperty.call(prefs, "darkMode");
    applyDarkMode(hasExplicitDarkPreference && prefs.darkMode === true, false);
    const remember = $("rememberSetting");
    if (remember) remember.checked = prefs.rememberMe !== false;
  }

  function populateAccountInformation() {
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || (user?.anonymous || user?.demo ? "Anonymous" : "Commuter");
    if ($("settingsAccountName")) $("settingsAccountName").textContent = fullName;
    if ($("settingsAccountEmail")) $("settingsAccountEmail").textContent = user?.email || "Not available";
    if ($("settingsAccountType")) $("settingsAccountType").textContent = user?.anonymous || user?.demo ? "Demo account" : "Registered account";
  }

  function populateNameSettings() {
    populateAccountInformation();
    if (user?.anonymous || user?.demo) return;
    if ($("settingsFirstName")) $("settingsFirstName").value = user?.firstName || "";
    if ($("settingsLastName")) $("settingsLastName").value = user?.lastName || "";
  }

  async function saveNameSettings() {
    if (!user?.id || user?.anonymous || user?.demo) return;
    const firstName = $("settingsFirstName")?.value.trim() || "";
    const lastName = $("settingsLastName")?.value.trim() || "";
    const message = $("nameSettingsMessage");
    if (!firstName) { if (message) { message.textContent = "Please enter your first name."; message.className = "form-message"; } return; }
    try {
      if (SB) {
        // Save the display name to Supabase Auth metadata. This works for
        // existing and newly-created accounts without requiring first_name or
        // last_name columns in public.profiles.
        const { error: authError } = await SB.auth.updateUser({
          data: {
            first_name: firstName,
            last_name: lastName,
            full_name: [firstName, lastName].filter(Boolean).join(" ")
          }
        });
        if (authError) throw authError;
      } else {
        const accounts = getJSON("commuteit_accounts", {});
        if (user.email && accounts[user.email]) {
          accounts[user.email].firstName = firstName;
          accounts[user.email].lastName = lastName;
          setJSON("commuteit_accounts", accounts);
        }
      }
      user.firstName = firstName; user.lastName = lastName;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      refreshDashboard();
      if (message) { message.textContent = "Name updated successfully."; message.className = "form-message success"; }
    } catch (err) {
      if (message) { message.textContent = err?.message || "Unable to update your name."; message.className = "form-message"; }
    }
  }

  async function syncFromSupabase() {
    if (!SB) return;
    const { data: sessionData } = await SB.auth.getSession();
    const authUser = sessionData?.session?.user;
    if (!authUser) {
      if (location.pathname.endsWith("dashboard.html")) window.location.href = "index.html";
      return;
    }
    const meta = authUser.user_metadata || {};
    const metaName = getNameFromMetadata(authUser);
    user = {
      id: authUser.id,
      firstName: authUser.is_anonymous ? "Anonymous" : (metaName.firstName || user?.firstName || (authUser.email || "Commuter").split("@")[0]),
      lastName: authUser.is_anonymous ? "" : (metaName.lastName || user?.lastName || ""),
      email: authUser.email || user?.email || "",
      demo: !!user?.demo || !!authUser.is_anonymous,
      anonymous: !!authUser.is_anonymous
    };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    updateSettingsVisibility();
    populateNameSettings();
    restoreUserPreferences();

    await loadRemoteUserData(authUser);
    subscribeToUserRealtime(authUser);
  }

  async function persistSavedRoute(item) {
    if (!SB || !user?.id) return;
    const { data, error } = await SB.from("saved_routes").insert({
      user_id:user.id, name:item.name, from_location:item.from, to_location:item.to, mode:item.mode,
      distance_km:item.distanceKm, duration_min:item.durationMin, fare:item.fare, co2:item.co2, eco_score:item.score
    }).select("id").single();
    if (!error && data?.id) {
      item.remote_id=Number(data.id); item.id=Number(data.id);
      const routes=getJSON(SAVED_KEY,[]); const idx=routes.findIndex(r=>r.id===item.id || r.remote_id===item.remote_id || r.name===item.name);
      if(idx>=0){ routes[idx]={...routes[idx],...item}; setJSON(SAVED_KEY,routes); renderSaved(); refreshDashboard(); }
    }
  }

  async function deleteSavedRoute(item) {
    if (SB && user?.id && item.remote_id) await SB.from("saved_routes").delete().eq("id", item.remote_id).eq("user_id", user.id);
  }

  async function persistTrip(item) {
    if (!SB || !user?.id) return;
    const { data, error } = await SB.from("trips").insert({
      user_id:user.id, from_location:item.from, to_location:item.to, mode:item.mode, distance_km:item.distanceKm,
      duration_min:item.durationMin, fare:item.fare, co2:item.co2, eco_score:item.score, summary:item.summary || ""
    }).select("id").single();
    if (!error && data?.id) {
      item.remote_id=Number(data.id); item.id=Number(data.id);
      const trips=getJSON(TRIPS_KEY,[]); const idx=trips.findIndex(t=>t.id===item.id || t.remote_id===item.remote_id);
      if(idx>=0){ trips[idx]={...trips[idx],...item}; setJSON(TRIPS_KEY,trips); renderTrips(); refreshDashboard(); }
    }
  }

  async function deleteTrip(item) {
    if (SB && user?.id && item.remote_id) await SB.from("trips").delete().eq("id", item.remote_id).eq("user_id", user.id);
  }

  async function resetDemoRemoteData() {
    if (!SB || !user?.id || !user?.demo) return;
    await Promise.all([
      SB.from("saved_routes").delete().eq("user_id", user.id),
      SB.from("trips").delete().eq("user_id", user.id),
      SB.from("profiles").delete().eq("user_id", user.id),
      SB.from("carpool_posts").delete().eq("user_id", user.id)
    ]);
  }

  function showPlannerChooser(){
    $("plannerChooser")?.classList.remove("hidden");
    $("plannerModePanel")?.classList.add("hidden");
    $("plannerWorkspace")?.classList.add("hidden");
    $("privateModeFolder")?.classList.add("hidden");
    $("commuteModeFolder")?.classList.add("hidden");
    $("commuteIntro")?.classList.add("hidden");
    $("plannerModeLabel") && ($("plannerModeLabel").textContent = "Choose a route type");
    document.querySelectorAll(".mode-option").forEach(b=>b.classList.remove("active"));
  }

  function openPlannerMode(category){
    plannerCategory = category;
    $("plannerChooser")?.classList.add("hidden");
    $("plannerModePanel")?.classList.remove("hidden");
    const isCommute = category === "commute";
    $("plannerWorkspace")?.classList.remove("hidden");
    $("mapShell")?.classList.toggle("hidden", isCommute);
    $("plannerModeLabel") && ($("plannerModeLabel").textContent = isCommute ? "Commute Mode" : "Private Vehicle");
    $("commuteModeFolder")?.classList.toggle("hidden", !isCommute);
    $("privateModeFolder")?.classList.toggle("hidden", isCommute);
    $("commuteIntro")?.classList.toggle("hidden", !isCommute);
    document.querySelectorAll(".mode-option").forEach(b=>b.classList.remove("active"));
    if (!isCommute) {
      document.querySelector('.mode-option[data-route-mode="BEST"]')?.classList.add("active");
      $("modeSelect").value="BEST";
      $("selectedModeText") && ($("selectedModeText").textContent="Recommended");
      $("routeBtn") && ($("routeBtn").textContent="Show route");
      $("commuteItinerary")?.classList.add("hidden");
    } else {
      $("modeSelect").value="TRANSIT";
      $("selectedModeText") && ($("selectedModeText").textContent="Smart Commute");
      $("routeBtn") && ($("routeBtn").textContent="Find my commute");
      $("trainFarePreview")?.classList.add("hidden");
    }
  }

  function chooseRouteMode(mode){
    if (plannerCategory === "commute") return;
    $("modeSelect").value = mode;
    $("selectedModeText") && ($("selectedModeText").textContent = modeLabel(mode));
    $("plannerWorkspace")?.classList.remove("hidden");
    $("mapShell")?.classList.remove("hidden");
    updateTrainFarePreview();
    document.querySelectorAll(".mode-option").forEach(b=>b.classList.toggle("active", b.dataset.routeMode===mode));
    if (map) setTimeout(()=>google.maps.event.trigger(map,"resize"),100);
    const origin=$("fromInput")?.value.trim(), destination=$("toInput")?.value.trim();
    if(origin && destination && directionsService) planRoute(); else $("fromInput")?.focus();
  }

  function navigateSection(section, options={}) {
    document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active-section"));
    const target = $("section-"+section) || $("section-dashboard");
    target.classList.add("active-section");
    document.querySelectorAll(".side-link[data-section]").forEach(a => a.classList.toggle("active", a.dataset.section===section));
    const title = section === "planner" ? "Route Planner" : section === "about" ? "About" : section.charAt(0).toUpperCase()+section.slice(1);
    document.body.classList.remove("dashboard-view");
    $("sectionTitle").textContent = title;
    history.replaceState(null,"","#"+section);
    closeSidebar();
    if (section === "saved") renderSaved();
    if (section === "trips") renderTrips();
    if (section === "dashboard") refreshDashboard();
    if (section === "reports") refreshReports();
    if (section === "community") loadCarpoolPosts();
    if (section === "planner") {
      if (options.resetPlanner !== false) showPlannerChooser();
      if (map) setTimeout(()=>google.maps.event.trigger(map,"resize"),100);
    }
  }

  function openSidebar(){ $("sidebar").classList.add("open"); $("sidebarBackdrop").classList.add("show"); }
  function closeSidebar(){ $("sidebar").classList.remove("open"); $("sidebarBackdrop").classList.remove("show"); }

  function useMyLocation(targetId="fromInput") {
    const status = $("locationStatus");
    if (!navigator.geolocation) { if(status) status.textContent="Location is not supported by this browser."; return; }
    if(status) status.textContent="Finding your location…";
    navigator.geolocation.getCurrentPosition(async pos => {
      const coords = [pos.coords.longitude,pos.coords.latitude];
      userLocationCoords = {lat: coords[1], lng: coords[0]};
      if (map && window.google?.maps) {
        const position = {lat:coords[1],lng:coords[0]};
        map.panTo(position);
        map.setZoom(15);
        if (userLocationMarker) {
          userLocationMarker.setPosition(position);
          userLocationMarker.setMap(map);
        } else if (google.maps.Marker) {
          userLocationMarker = new google.maps.Marker({
            map,
            position,
            title:"Your current location",
            zIndex:9999,
            icon:{
              path:google.maps.SymbolPath.CIRCLE,
              scale:9,
              fillColor:"#1683ff",
              fillOpacity:1,
              strokeColor:"#ffffff",
              strokeOpacity:1,
              strokeWeight:3
            }
          });
        }
      }
      const input = $(targetId) || $("fromInput");
      if (input) {
        input.value = "Current location";
        input.dataset.lat = String(coords[1]);
        input.dataset.lng = String(coords[0]);
      }
      try {
        const label = await reverseGeocode(coords);
        if (input) input.value = label;
      } catch (_) {}
      if(status) status.textContent="Location found.";
      if (targetId === "fromInput" && $("dashFrom")) $("dashFrom").value = input?.value || "Current location";
    }, err => {
      const message = err?.code === 1 ? "Allow location access in your browser, then try again." : "We could not get your current location. Try again.";
      if(status) status.textContent=message;
      alert(message);
    }, {enableHighAccuracy:true, timeout:12000, maximumAge:60000});
  }

  function resolveInputLocation(id) {
    const el=$(id);
    if(!el) return "";
    const lat=Number(el.dataset.lat), lng=Number(el.dataset.lng);
    if(Number.isFinite(lat) && Number.isFinite(lng)) return {lat,lng};
    return el.value.trim();
  }

  function resolveOrigin() {
    return resolveInputLocation("fromInput");
  }

  async function geocodeRouteInputsIfNeeded(){
    if(!geocoder) return;
    const fields=["fromInput","toInput"];
    for(const id of fields){
      const el=$(id);
      if(!el || !el.value.trim()) continue;
      const lat=Number(el.dataset.lat), lng=Number(el.dataset.lng);
      if(Number.isFinite(lat) && Number.isFinite(lng)) continue;
      try{
        const response=await geocoder.geocode({address:el.value.trim(), region:"ph"});
        const loc=response.results?.[0]?.geometry?.location;
        if(loc){
          el.dataset.lat=String(loc.lat());
          el.dataset.lng=String(loc.lng());
        }
      }catch(_){}
    }
  }

  function maybeAutoPlanAfterPlaceSelection(){
    const from=$("fromInput")?.value.trim(), to=$("toInput")?.value.trim();
    if(!from || !to || !directionsService) return;
    clearTimeout(window.__commuteITPlaceRouteTimer);
    window.__commuteITPlaceRouteTimer=setTimeout(()=>planRoute(),120);
  }

  // Fare matrices transcribed from the fare-matrix references supplied for this prototype.
  const MRT3_STATIONS = ["North Ave.","Quezon Ave.","GMA Kamuning","Araneta-Cubao","Santolan Annapolis","Ortigas","Shaw Blvd.","Boni","Guadalupe","Buendia","Ayala","Magallanes","Taft Ave."];
  const MRT3_FARES = [
    [0,6,6,8,8,10,10,10,12,12,12,14,14],
    [6,0,6,6,8,8,10,10,10,12,12,12,14],
    [6,6,0,6,6,8,8,10,10,10,12,12,12],
    [8,6,6,0,6,6,8,8,10,10,10,12,12],
    [8,8,6,6,0,6,6,8,8,10,10,10,12],
    [10,8,8,6,6,0,6,6,8,8,10,10,10],
    [10,10,8,8,6,6,0,6,6,8,8,10,10],
    [10,10,10,8,8,6,6,0,6,6,8,8,10],
    [12,10,10,10,8,8,6,6,0,6,6,8,8],
    [12,12,10,10,10,8,8,6,6,0,6,6,8],
    [12,12,12,10,10,10,8,8,6,6,0,6,6],
    [14,12,12,12,10,10,10,8,8,6,6,0,6],
    [14,14,12,12,12,10,10,10,8,8,6,6,0]
  ];

  const LRT1_STATIONS = ["Dr. Santos","Ninoy Aquino Avenue","PITX","MIA Road","Redemptorist-Aseana","Baclaran","EDSA","Libertad","Gil Puyat","Vito Cruz","Quirino","Pedro Gil","UN Avenue","Central","Carriedo","D. Jose","Bambang","Tayuman","Blumentritt","Abad Santos","R. Papa","5th Avenue","Monumento","Balintawak","Fernando Poe Jr."];
  const LRT1_FARES = [
    [16,19,20,22,23,26,27,28,29,31,32,33,34,36,37,38,39,40,41,42,43,45,46,49,52],
    [19,16,18,20,21,23,24,26,27,28,29,31,32,33,35,36,36,37,38,40,41,42,44,47,50],
    [20,18,16,18,19,22,22,24,25,27,28,29,30,32,33,34,35,36,37,38,39,40,42,45,48],
    [22,20,18,16,17,20,20,22,23,25,26,27,28,30,31,32,33,34,35,36,37,38,40,43,46],
    [23,21,19,17,16,18,19,21,22,23,25,26,27,29,30,31,32,33,34,35,36,37,39,42,45],
    [26,23,22,20,18,16,17,19,20,21,22,24,25,27,28,29,30,30,31,33,34,35,37,40,43],
    [27,24,22,20,19,17,16,18,19,20,22,23,24,26,27,28,29,30,31,32,33,34,36,39,42],
    [28,26,24,22,21,19,18,16,17,19,20,21,22,24,25,26,27,28,29,30,31,33,34,38,40],
    [29,27,25,23,22,20,19,17,16,18,19,20,21,23,24,25,26,27,28,29,30,32,33,37,39],
    [31,28,27,25,23,21,20,19,18,16,17,18,20,21,22,23,24,25,26,27,28,30,31,35,37],
    [32,29,28,26,25,22,22,20,19,17,16,17,19,20,21,22,23,24,25,26,27,29,30,34,36],
    [33,31,29,27,26,24,23,21,20,18,17,16,17,19,20,21,22,23,24,25,26,28,29,33,35],
    [34,32,30,28,27,25,24,22,21,20,19,17,16,18,19,20,21,22,23,24,25,27,28,32,34],
    [36,33,32,30,29,27,26,24,23,21,20,19,18,16,17,18,19,20,21,22,23,25,26,30,33],
    [37,35,33,31,30,28,27,25,24,22,21,20,19,17,16,17,18,19,20,21,22,24,25,29,32],
    [38,36,34,32,31,29,28,26,25,23,22,21,20,18,17,16,17,18,19,20,21,23,24,28,31],
    [39,36,35,33,32,30,29,27,26,24,23,22,21,19,18,17,16,17,18,19,20,22,23,27,30],
    [40,37,36,34,33,30,30,28,27,25,24,23,22,20,19,18,17,16,17,18,19,21,22,26,29],
    [41,38,37,35,34,31,31,29,28,26,25,24,23,21,20,19,18,17,16,17,18,20,21,25,28],
    [42,40,38,36,35,33,32,30,29,27,26,25,24,22,21,20,19,18,17,16,17,19,20,24,27],
    [43,41,39,37,36,34,33,31,30,28,27,26,25,23,22,21,20,19,18,17,16,18,19,23,26],
    [45,42,40,38,37,35,34,33,32,30,29,28,27,25,24,23,22,21,20,19,18,16,18,21,24],
    [46,44,42,40,39,37,36,34,33,31,30,29,28,26,25,24,23,22,21,20,19,18,16,20,23],
    [49,47,45,43,42,40,39,38,37,35,34,33,32,30,29,28,27,26,25,24,23,21,20,16,19],
    [52,50,48,46,45,43,42,40,39,37,36,35,34,33,32,31,30,29,28,27,26,24,23,19,16]
  ];

  function normalizeStationName(value){
    return String(value||"").toLowerCase().replace(/[.]/g,"").replace(/\s+/g," ").trim();
  }
  function matrixLookup(stations, matrix, from, to){
    const a=normalizeStationName(from), b=normalizeStationName(to);
    const i=stations.findIndex(x=>normalizeStationName(x)===a);
    const j=stations.findIndex(x=>normalizeStationName(x)===b);
    return i>=0 && j>=0 ? matrix[i][j] : null;
  }
  function trainFareFor(from,to){
    if(!from||!to||normalizeStationName(from)===normalizeStationName(to)) return null;
    return matrixLookup(MRT3_STATIONS,MRT3_FARES,from,to) ?? matrixLookup(LRT1_STATIONS,LRT1_FARES,from,to);
  }
  function trainLineFor(from,to){
    const m = matrixLookup(MRT3_STATIONS,MRT3_FARES,from,to);
    if(m !== null) return "MRT-3";
    const l = matrixLookup(LRT1_STATIONS,LRT1_FARES,from,to);
    if(l !== null) return "LRT-1";
    return null;
  }
  function updateTrainFarePreview(){
    const box=$("trainFarePreview"); if(!box) return;
    const mode=$("modeSelect")?.value;
    if(mode!=="TRAIN"){ box.classList.add("hidden"); box.innerHTML=""; return; }
    const from=$("fromInput")?.value.trim(), to=$("toInput")?.value.trim();
    const fare=trainFareFor(from,to), line=trainLineFor(from,to);
    box.classList.remove("hidden");
    if(fare!==null){
      box.innerHTML=`<div><span class="eyebrow">${line} FARE MATRIX</span><strong>₱${fare.toLocaleString()}</strong></div><small>${escapeHtml(from)} → ${escapeHtml(to)} • Based on the supplied fare matrix.</small>`;
    } else {
      box.innerHTML=`<div><span class="eyebrow">TRAIN FARE</span><strong>Choose two stations</strong></div><small>Use the station names in the suggestions to calculate the exact MRT-3 or LRT-1 fare.</small>`;
    }
  }

  function calcCO2(distanceKm, mode) {
    // Approximate passenger-level factors for prototype comparison.
    const factors = {DRIVING:.192, TRANSIT:.065, WALKING:0, BICYCLING:0, BUS:.085, TRAIN:.041};
    const f = factors[mode] ?? .065;
    return Math.max(0, distanceKm * f);
  }

  function estimateFare(distanceKm, mode) {
    if (mode === "WALKING" || mode === "BICYCLING") return 0;
    if (mode === "DRIVING") return Math.round(55 + distanceKm * 5.5);
    if (mode === "TRAIN") return trainFareFor($("fromInput")?.value, $("toInput")?.value) ?? Math.max(16, Math.round(16 + distanceKm * 2.0));
    if (mode === "TRANSIT") return Math.round(15 + distanceKm * 2.2);
    return Math.round(15 + distanceKm * 2.2);
  }

  function scoreRoute(distanceKm, mode, durationMin) {
    const co2 = calcCO2(distanceKm, mode);
    let score = 96 - co2*28 - Math.max(0,durationMin-60)*.22;
    if (mode === "WALKING" || mode === "BICYCLING") score += 8;
    if (mode === "TRANSIT") score += 5;
    if (mode === "DRIVING") score -= 7;
    return Math.max(45, Math.min(99, Math.round(score)));
  }

  function modeFromSelect() {
    const v = $("modeSelect").value;
    return v || "BEST";
  }

  async function planRoute() {
    await geocodeRouteInputsIfNeeded();
    const origin=resolveOrigin();
    const destination=resolveInputLocation("toInput");
    if(!origin || !destination) return alert("Please enter both an origin and destination.");
    const isCommute=plannerCategory==="commute";
    const selected=isCommute ? "TRANSIT" : modeFromSelect();
    if(!directionsService) return alert("Google Maps is still loading. Please try again in a moment.");

    $("mapShell")?.classList.remove("hidden");
    $("routeBtn") && ($("routeBtn").textContent=isCommute?"Finding commute…":"Finding route…", $("routeBtn").disabled=true);
    updateWeatherRouteNote();

    const request={origin,destination,provideRouteAlternatives:true,region:"ph"};
    if(isCommute){
      request.travelMode="TRANSIT";
      request.transitOptions={departureTime:new Date(),routingPreference:"FEWER_TRANSFERS"};
      $("commuteItinerary") && ($("commuteItinerary").classList.remove("hidden"), $("commuteItinerary").innerHTML='<div class="commute-loading"><span class="spinner small"></span><span>Searching public-transit combinations…</span></div>');
    } else {
      request.travelMode=selected==="WALKING"?"WALKING":selected==="BICYCLING"?"BICYCLING":"DRIVING";
      if(request.travelMode==="DRIVING") request.drivingOptions={departureTime:new Date(),trafficModel:"BEST_GUESS"};
    }

    directionsService.route(request,(result,status)=>{
      if($("routeBtn")){ $("routeBtn").disabled=false; $("routeBtn").textContent=isCommute?"Find my commute":"Show route"; }
      if(status!=="OK" || !result?.routes?.length){
        showRouteError(status,isCommute?"Google Maps transit":"Google Maps");
        if(isCommute) renderCommuteItinerary(null,status);
        return;
      }
      handleDirections(result,selected);
    });
  }

  function handleGoogleRoute(route, requestedMode, originLabel, destinationLabel){
    const leg=route?.legs?.[0]; if(!leg) return;
    const distanceKm=(Number(leg.distance?.value)||0)/1000;
    const baseDurationMin=Math.round((Number(leg.duration?.value)||0)/60);
    const durationMin=Math.round((Number(leg.duration_in_traffic?.value)||leg.duration?.value||0)/60);
    const mode=requestedMode||"BEST";
    const calcMode=mode==="TAXI"||mode==="BEST"?"DRIVING":mode;
    const co2=calcCO2(distanceKm,calcMode);
    const fare=typeof route.fare?.value==="number"?route.fare.value:estimateFare(distanceKm,calcMode);
    const score=scoreRoute(distanceKm,calcMode,durationMin);
    const trafficDelayMin=Math.max(0,durationMin-baseDurationMin);
    lastRoute={from:$("fromInput").value.trim(),to:$("toInput").value.trim(),distanceKm,durationMin,mode,co2,fare,score,trafficDelayMin,baseDurationMin,timestamp:new Date().toISOString(),summary:`${originLabel} → ${destinationLabel}`};
    setJSON(LAST_KEY,lastRoute);
    const trafficText=calcMode==="DRIVING"?(trafficDelayMin>0?` • +${trafficDelayMin} min traffic delay`:" • live traffic checked"):"";
    const fareText=` • estimated fare ₱${fare.toLocaleString()}`;
    $("routeSummary").className="route-summary";
    $("routeSummary").innerHTML=`<span>${distanceKm.toFixed(1)} km • about ${durationMin} min • ${modeLabel(mode)}${trafficText}${fareText}</span><div class="route-feedback"><span>Was this recommendation useful?</span><button type="button" data-feedback="1">👍 Good</button><button type="button" data-feedback="0">👎 Needs improvement</button></div><button id="logTripBtn" class="btn btn-primary compact">Log this trip</button>`;
    $("routeSummary").querySelectorAll("[data-feedback]").forEach(b=>b.addEventListener("click",()=>recordRecommendationFeedback(Number(b.dataset.feedback))));
    $("logTripBtn")?.addEventListener("click",logTrip);
    renderRouteCards(distanceKm,durationMin,mode,"Google Maps");
    refreshReports(); refreshDashboard();
  }

  function showRouteError(status, provider="Google Maps"){
    $("routeSummary").className="route-summary";
    $("routeSummary").innerHTML=`<strong>Route unavailable.</strong><span>${escapeHtml(provider)} returned: ${escapeHtml(status)}. Try a nearby landmark or another travel mode.</span>`;
    $("routeCards").innerHTML="";
  }

  function transitVehicleLabel(step){
    const td = step.transit && step.transit.line;
    const name = (td?.vehicle?.name || "").toLowerCase();
    const type = (td?.vehicle?.type || "").toLowerCase();
    const label = (td?.name || td?.short_name || "").trim();
    if (type.includes("rail") || type.includes("subway") || type.includes("train") || name.includes("train") || name.includes("rail")) return "Train";
    if (type.includes("bus") || name.includes("bus")) {
      // Google generally classifies jeepneys as BUS; surface the line name so the user
      // can see exactly what to board instead of pretending the API knows every PUJ.
      if (/jeep|puj/i.test(label + " " + (td?.agency || ""))) return "Jeepney";
      return "Bus";
    }
    return name ? (td?.name || td?.short_name || "Transit") : "Transit";
  }

  function estimateTransitStepFare(step, label){
    const km = Math.max(0.5, (step.distance?.value || 0) / 1000);
    if (label === "Train") return Math.max(15, Math.round(15 + km * 2.0));
    if (label === "Bus") return Math.max(15, Math.round(15 + km * 2.1));
    if (label === "Jeepney") return Math.max(13, Math.round(13 + Math.max(0, km - 4) * 2));
    return Math.max(15, Math.round(15 + km * 2.2));
  }

  function fareForTransitStep(step,label){
    const km=Math.max(0.1,(step.distance?.value||0)/1000);
    const dep=step.transit?.departure_stop?.name||"", arr=step.transit?.arrival_stop?.name||"";
    if(label==="Train"){
      const exact=trainFareFor(dep,arr); if(exact!==null) return {value:exact,kind:"matrix"};
      return {value:Math.max(16,Math.round(16+km*2)),kind:"estimate"};
    }
    if(label==="Jeepney") return {value:Math.max(14,Math.round(14+Math.max(0,km-4)*2)),kind:"estimate"};
    if(label==="Bus") return {value:Math.max(15,Math.round(15+Math.max(0,km-5)*2.49)),kind:"estimate"};
    return {value:Math.max(0,Math.round(km*2.5)),kind:"estimate"};
  }

  function renderCommuteItinerary(result,status){
    const box=$("commuteItinerary"); if(!box) return;
    box.classList.remove("hidden");
    if(!result?.routes?.length){
      box.innerHTML=`<div class="commute-empty"><strong>We couldn't build a public-transit itinerary.</strong><span>The transit routing service returned ${escapeHtml(status||"no route")}. Try a nearby landmark, station, terminal, or another destination.</span><small>Local TODA/tricycle routes are controlled by individual LGUs and are not available as one complete NCR-wide machine-readable dataset, so the app does not invent a TODA route when none is verified.</small></div>`; return;
    }
    const route=result.routes[0],leg=route.legs[0],steps=leg.steps||[]; const items=[]; let totalEstimated=0,hasEstimate=false;
    steps.forEach(step=>{
      if(step.travel_mode==="WALKING"){
        const km=(step.distance?.value||0)/1000; if(km<0.08)return;
        items.push(`<div class="commute-leg walk-leg"><span class="commute-leg-num">${items.length+1}</span><div><strong>Walk</strong><small>${escapeHtml(step.instructions||"Walk to the next stop")} • ${km.toFixed(2)} km • ${Math.round((step.duration?.value||0)/60)} min</small></div></div>`); return;
      }
      if(step.travel_mode!=="TRANSIT" || !step.transit)return;
      const td=step.transit.line||{},label=transitVehicleLabel(step),fare=fareForTransitStep(step,label); totalEstimated+=fare.value; hasEstimate=hasEstimate||fare.kind==="estimate";
      const dep=step.transit.departure_stop?.name||"Boarding stop",arr=step.transit.arrival_stop?.name||"Arrival stop",line=td.short_name||td.name||"Public transport",headsign=step.transit.headsign?` toward ${escapeHtml(step.transit.headsign)}`:"",stops=step.transit.num_stops?` • ${step.transit.num_stops} stops`:"";
      const fareText=fare.kind==="matrix"?`₱${fare.value.toLocaleString()} matrix fare`:`~₱${fare.value.toLocaleString()} estimated fare`;
      items.push(`<div class="commute-leg"><span class="commute-leg-num">${items.length+1}</span><div><strong>${escapeHtml(label)} — ${escapeHtml(line)}${headsign}</strong><small>Take at <b>${escapeHtml(dep)}</b> → get off at <b>${escapeHtml(arr)}</b>${stops}</small><em>${fareText}</em></div></div>`);
    });
    const googleFare=typeof route.fare?.value==="number"?route.fare.value:null,total=googleFare??(hasEstimate?totalEstimated:null),totalNote=googleFare!==null?"Live transit fare":(hasEstimate?"Estimated from available fare rules; train legs use the supplied MRT-3/LRT-1 matrix when station pairs match.":"Fare unavailable");
    box.innerHTML=`<div class="commute-itinerary-head"><div><span class="eyebrow">WHAT YOU NEED TO TAKE</span><h3>Automatic commute plan</h3></div><div class="commute-total"><small>Total fare</small><strong>${total===null?"—":"₱"+Math.round(total).toLocaleString()}</strong><span>${escapeHtml(totalNote)}</span></div></div><div class="commute-leg-list">${items.length?items.join(""):"<div class='commute-empty'><strong>Walk-only connection</strong><span>No public-transport vehicle leg was returned.</span></div>"}</div><div class="coverage-note"><strong>Route-data coverage:</strong> The transit routing service supplies the live public-transit itinerary. LTFRB and OpenStreetMap are the supporting route-data references; TODA/tricycle routes remain LGU-specific and are only shown when a verified source supports them.</div>`;
  }

  function handleDirections(result, requestedMode){
    const route=choosePreferredRoute(result.routes||[]);
    if(!route) return;
    if(directionsRenderer) directionsRenderer.setDirections({...result,routes:[route]});
    if(plannerCategory==="commute") renderCommuteItinerary({...result,routes:[route]});
    const leg=route.legs[0];
    handleGoogleRoute(route,requestedMode,leg.start_address,leg.end_address);
  }

  function renderRouteCards(distanceKm,durationMin,selectedMode,provider="Google Maps"){
    const mapOnlyModes = ["BEST","WALKING","BICYCLING","DRIVING"];
    if (mapOnlyModes.includes(selectedMode)) {
      $("routeCards").innerHTML = `<div class="map-only-note"><strong>${escapeHtml(provider)} route shown above.</strong><span>No vehicle-by-vehicle breakdown is needed for ${modeLabel(selectedMode).toLowerCase()}.</span></div>`;
      return;
    }
    $("routeCards").innerHTML = "";
  }

  function saveCurrentEstimate(btn){
    const routes=getJSON(SAVED_KEY,[]);
    const item={
      id:Date.now(),name:`${$("fromInput").value.trim()} → ${$("toInput").value.trim()}`,
      from:$("fromInput").value.trim(),to:$("toInput").value.trim(),mode:btn.dataset.saveMode,
      distanceKm:+btn.dataset.distance,durationMin:+btn.dataset.duration,fare:+btn.dataset.fare,co2:+btn.dataset.co2,score:+btn.dataset.score
    };
    routes.unshift(item); setJSON(SAVED_KEY,routes); renderSaved(); refreshDashboard();
    persistSavedRoute(item);
    btn.textContent="Saved ✓";
  }

  function renderSaved(){
    const routes=getJSON(SAVED_KEY,[]);
    const el=$("savedList");
    if(!routes.length){el.innerHTML='<div class="empty-state">No saved routes yet. Plan a route and save an estimate.</div>';return}
    el.innerHTML=routes.map(r=>{
      const distance = Number(r.distanceKm) || 0;
      const duration = Number(r.durationMin) || 0;
      const fare = Number(r.fare) || 0;
      const co2 = Number(r.co2) || 0;
      const id = String(r.id ?? r.remote_id ?? Date.now());
      const name = r.name || `${r.from || "From"} → ${r.to || "To"}`;
      return `<div class="saved-item">
        <div class="saved-route-info"><strong>${escapeHtml(name)}</strong><p>${modeLabel(r.mode)} • ${distance.toFixed(1)} km • ${duration} min • ₱${fare.toLocaleString()} • ${co2.toFixed(2)} kg CO₂</p></div>
        <div class="saved-actions"><button type="button" data-edit="${escapeHtml(id)}">Edit</button><button type="button" data-load="${escapeHtml(id)}">Use</button><button type="button" data-delete="${escapeHtml(id)}">Delete</button></div>
      </div>`;
    }).join("");
    el.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{const item=routes.find(r=>String(r.id)===String(b.dataset.delete) || String(r.remote_id)===String(b.dataset.delete));await deleteSavedRoute(item||{});setJSON(SAVED_KEY,routes.filter(r=>String(r.id)!==String(b.dataset.delete) && String(r.remote_id)!==String(b.dataset.delete)));renderSaved();refreshDashboard()});
    el.querySelectorAll("[data-load]").forEach(b=>b.onclick=()=>{
      const r=routes.find(x=>String(x.id)===String(b.dataset.load) || String(x.remote_id)===String(b.dataset.load));
      if(!r) return;
      $("fromInput").value=r.from; $("toInput").value=r.to;
      const mode = ["DRIVING","WALKING","BICYCLING","BEST","BUS","TRAIN","TAXI","JEEPNEY"].includes(r.mode) ? r.mode : "BEST";
      navigateSection("planner");
      const commute=["BUS","TRAIN","TAXI","JEEPNEY"].includes(mode);
      openPlannerMode(commute ? "commute" : "private");
      chooseRouteMode(mode);
      setTimeout(planRoute,250);
    });
    el.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editSaved(+b.dataset.edit));
  }

  function editSaved(id){
    const routes=getJSON(SAVED_KEY,[]), r=routes.find(x=>x.id===id);
    if(!r)return;
    const newName=prompt("Edit saved route name:",r.name);
    if(newName===null)return;
    r.name=newName.trim()||r.name; setJSON(SAVED_KEY,routes);renderSaved();
  }

  async function logTrip(){
    if(!lastRoute)return;
    const trips=getJSON(TRIPS_KEY,[]);
    const item={...lastRoute,id:Date.now()};
    trips.unshift(item);
    setJSON(TRIPS_KEY,trips); refreshDashboard(); renderTrips();
    await persistTrip(item);
    const btn=$("logTripBtn");
    if(btn){btn.textContent="Trip logged ✓";btn.disabled=true;}
  }

  function renderTrips(){
    const trips=getJSON(TRIPS_KEY,[]);
    const el=$("tripsList");
    if(!trips.length){el.className="empty-state";el.textContent="No trips yet. Plan a route to start building your history.";return}
    el.className="saved-list";
    el.innerHTML=trips.map(t=>`<div class="saved-item"><div><strong>${escapeHtml(t.from)} → ${escapeHtml(t.to)}</strong><p>${new Date(t.timestamp).toLocaleString()} • ${modeLabel(t.mode)} • ${t.distanceKm.toFixed(1)} km • ${t.co2.toFixed(2)} kg CO₂</p></div><div class="saved-actions"><button data-trip-delete="${t.id}">Delete</button></div></div>`).join("");
    el.querySelectorAll("[data-trip-delete]").forEach(b=>b.onclick=async()=>{const item=trips.find(t=>t.id===+b.dataset.tripDelete);await deleteTrip(item||{});setJSON(TRIPS_KEY,trips.filter(t=>t.id!==+b.dataset.tripDelete));renderTrips();refreshDashboard()});
  }

  function refreshDashboard(){
    const trips=getJSON(TRIPS_KEY,[]), saved=getJSON(SAVED_KEY,[]);
    const co2=trips.reduce((sum,t)=>sum+(Number(t.co2)||0),0);
    const baseline=trips.reduce((sum,t)=>sum+((Number(t.distanceKm)||0)*0.192),0);
    const savedCo2=Math.max(0,baseline-co2);
    $("dashCo2").textContent=savedCo2.toFixed(2)+" kg";
    $("dashTrips").textContent=trips.length;
    $("dashSaved").textContent=saved.length;
    const last=getJSON(LAST_KEY,null);
    $("dashScore").textContent=last?.score ?? "—";

    const period = $("impactPeriod")?.value || "This Week";
    const now = new Date();
    const impactTrips = period === "All Time" ? trips : trips.filter(t => {
      const d = new Date(t.timestamp || t.occurred_at || 0);
      if (period === "This Week") {
        const start = new Date(now);
        const day = start.getDay();
        const daysSinceMonday = (day + 6) % 7;
        start.setHours(0,0,0,0);
        start.setDate(start.getDate() - daysSinceMonday);
        return d >= start;
      }
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const impactCo2 = impactTrips.reduce((sum,t)=>sum+(Number(t.co2)||0),0);
    const impactBaseline = impactTrips.reduce((sum,t)=>sum+((Number(t.distanceKm)||0)*0.192),0);
    const impactSaved = Math.max(0, impactBaseline-impactCo2);
    const trees = Math.max(0, impactSaved / 15);
    const treeEl = $("treeEquivalent");
    if (treeEl) treeEl.textContent = trees.toFixed(1) + " Trees";

    // The ring is calculated from the current user's own Supabase trips.
    // No global/shared counter is used. It updates immediately after local
    // changes and automatically when another tab/device changes this account.
    const progress = Math.max(0, Math.min(100, Math.round((impactSaved / 5) * 100)));
    const ring = $("impactRing");
    const percent = $("impactPercent");
    if (ring) ring.style.setProperty("--progress", progress + "%");
    if (percent) percent.textContent = progress + "%";
    const goalLabel = $("impactGoalLabel");
    if (goalLabel) goalLabel.textContent = period === "This Week" ? "of your weekly goal" : period === "This Month" ? "of your monthly goal" : "of your long-term goal";

    const name=user?.demo ? "Anonymous" : (user.firstName||"Commuter");
    // Always determine the greeting from the current time in Manila, Philippines.
    const manilaHour = Number(new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila", hour: "2-digit", hourCycle: "h23"
    }).format(new Date()));
    const greeting = manilaHour >= 5 && manilaHour < 12 ? "Good morning"
      : manilaHour >= 12 && manilaHour < 18 ? "Good afternoon"
      : "Good evening";
    if ($("greetingText")) $("greetingText").textContent=greeting;
    $("greetingName").textContent=name;$("profileName").textContent=name;
    $("profileAvatar").textContent=name.charAt(0).toUpperCase();
    populateAccountInformation();
  }

  function refreshReports(){
    const r=getJSON(LAST_KEY,null), trips=getJSON(TRIPS_KEY,[]);
    const totalCo2=trips.reduce((a,t)=>a+(Number(t.co2)||0),0);
    const baselineCo2=trips.reduce((a,t)=>a+((Number(t.distanceKm)||0)*0.192),0);
    const reducedCo2=Math.max(0,baselineCo2-totalCo2);
    const avgScore=trips.length ? Math.round(trips.reduce((a,t)=>a+(Number(t.score)||0),0)/trips.length) : null;
    const lastMode=modeLabel(r?.mode||"BEST");
    if($("reportRecRoute")) $("reportRecRoute").textContent=r ? `${lastMode} • ${r.distanceKm.toFixed(1)} km` : "—";
    if($("reportRecMeta")) $("reportRecMeta").textContent=r ? `${r.from} → ${r.to} • Eco-Score ${r.score}` : "Plan a route to generate this report.";
    if($("reportTime")) $("reportTime").textContent=r ? `${r.durationMin} min` : "—";
    if($("reportTimeMeta")) $("reportTimeMeta").textContent=r ? (r.trafficDelayMin ? `Includes ${r.trafficDelayMin} min live traffic delay.` : "Latest route estimate.") : "Latest route estimate.";
    if($("reportCo2")) $("reportCo2").textContent=trips.length ? `${reducedCo2.toFixed(2)} kg saved` : "—";
    if($("reportCo2Meta")) $("reportCo2Meta").textContent=trips.length ? `Compared with a private-vehicle baseline of ${baselineCo2.toFixed(2)} kg.` : "Based on your logged trips.";
    if($("reportHistoryCount")) $("reportHistoryCount").textContent=`${trips.length} trip${trips.length===1?"":"s"}`;
    if($("reportHistoryMeta")) $("reportHistoryMeta").textContent=trips.length ? `Last trip: ${new Date(trips[0].timestamp||Date.now()).toLocaleString()}.` : "No completed trips yet.";
    if($("reportSavedCo2")) $("reportSavedCo2").textContent=`${reducedCo2.toFixed(2)} kg`;
    if($("reportTreeCount")) $("reportTreeCount").textContent=(reducedCo2/15).toFixed(1);
    if($("reportEcoAvg")) $("reportEcoAvg").textContent=avgScore ?? "—";
    renderModeComparison(r); renderCostComparison(r); renderPopularRoutes(trips); renderTrafficReport(r); renderAccuracyReport();
  }

  function estimateModeForReport(distanceKm, durationMin, mode){
    const factors={BEST:.065,TRANSIT:.065,DRIVING:.192,WALKING:0,BICYCLING:0};
    const mins={WALKING:Math.max(1,Math.round(distanceKm/4.5*60)),BICYCLING:Math.max(1,Math.round(distanceKm/16*60)),DRIVING:Math.max(1,Math.round(durationMin*.72)),TRANSIT:Math.max(1,Math.round(durationMin)),BEST:Math.max(1,Math.round(durationMin))};
    const m=mins[mode]; const fare=estimateFare(distanceKm,mode); const co2=distanceKm*(factors[mode]??.065); const score=scoreRoute(distanceKm,mode,m);
    return {m,fare,co2,score};
  }
  function renderModeComparison(r){
    const el=$("modeComparison"); if(!el)return;
    if(!r){el.innerHTML='<p class="mini-empty">Plan a route to compare modes.</p>';return;}
    const rows=[['Recommended','BEST'],['Walk','WALKING'],['Bike','BICYCLING'],['Drive','DRIVING'],['Commute','TRANSIT']].map(([name,mode])=>{const x=estimateModeForReport(r.distanceKm,r.durationMin,mode);return `<div class="mini-row"><strong>${name}</strong><span>${x.m} min</span><span>₱${Math.round(x.fare)}</span><span>${x.co2.toFixed(2)} kg</span></div>`}).join('');
    el.innerHTML='<div class="mini-head"><span>Mode</span><span>Time</span><span>Fare</span><span>CO₂</span></div>'+rows;
  }
  function renderCostComparison(r){
    const el=$("costComparison"); if(!el)return;
    if(!r){el.innerHTML='<p class="mini-empty">Plan a route to compare costs.</p>';return;}
    const modes=[['Walk','WALKING'],['Bike','BICYCLING'],['Commute','TRANSIT'],['Drive','DRIVING']];
    el.innerHTML=modes.map(([n,m])=>{const x=estimateModeForReport(r.distanceKm,r.durationMin,m);return `<div class="mini-cost"><span>${n}</span><strong>₱${Math.round(x.fare).toLocaleString()}</strong></div>`}).join('');
  }
  function renderPopularRoutes(trips){
    const el=$("popularRoutes"); if(!el)return;
    const map=new Map(); trips.forEach(t=>{const key=`${t.from} → ${t.to}`; map.set(key,(map.get(key)||0)+1)});
    const rows=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
    el.innerHTML=rows.length?rows.map(([route,count],i)=>`<div class="popular-row"><span>${i+1}</span><strong>${escapeHtml(route)}</strong><b>${count}</b></div>`).join(''):'<p>No route history yet.</p>';
  }
  function renderTrafficReport(r){
    if(!$("trafficLevel"))return;
    if(!r){$("trafficLevel").textContent="—";$("trafficMeta").textContent="Run a driving route to measure live delay.";return;}
    const delay=Number(r.trafficDelayMin)||0; const level=delay>=20?'Heavy':delay>=8?'Moderate':'Light / normal';
    $("trafficLevel").textContent=level; $("trafficMeta").textContent=r.mode==='DRIVING'?`Live delay: ${delay} min on the latest driving route.`:`Traffic delay is measured directly when the selected route is driving.`;
  }
  function recordRecommendationFeedback(value){
    const list=getJSON(FEEDBACK_KEY,[]); list.push({value,timestamp:new Date().toISOString(),route:lastRoute?.summary||''}); setJSON(FEEDBACK_KEY,list); refreshReports();
    const msg=$("routeSummary"); if(msg){const el=document.createElement('div');el.className='feedback-thanks';el.textContent=value?'Thanks — marked as useful.':'Thanks — we’ll count this as a recommendation improvement.';msg.appendChild(el);}
  }
  function renderAccuracyReport(){
    const el=$("accuracyValue"), meta=$("accuracyMeta"); if(!el)return; const list=getJSON(FEEDBACK_KEY,[]); if(!list.length){el.textContent='No feedback yet';meta.textContent='After each route, rate whether the recommendation was useful. Accuracy is calculated from your feedback.';return;} const good=list.filter(x=>x.value===1).length; const pct=Math.round(good/list.length*100); el.textContent=`${pct}% useful`; meta.textContent=`${good} positive rating${good===1?'':'s'} out of ${list.length} route feedback entr${list.length===1?'y':'ies'}.`;
  }
  function choosePreferredRoute(routes){
    if(!routes.length)return null;
    const lessWalking=$("lessWalkingPref")?.checked, fewerTransfers=$("fewerTransfersPref")?.checked, accessibility=$("accessibilityPref")?.checked;
    if(!lessWalking&&!fewerTransfers&&!accessibility)return routes[0];
    const scoreRouteOption=(route)=>{
      const leg=route.legs?.[0]; if(!leg)return 999999;
      const steps=leg.steps||[]; const walking=steps.filter(st=>st.travel_mode==='WALKING').reduce((a,st)=>a+(st.distance?.value||0),0);
      const transfers=Math.max(0,steps.filter(st=>st.transit).length-1);
      let score=(leg.duration?.value||0)/60;
      if(lessWalking)score+=walking/1000*18;
      if(fewerTransfers||accessibility)score+=transfers*12;
      return score;
    };
    return [...routes].sort((a,b)=>scoreRouteOption(a)-scoreRouteOption(b))[0];
  }
  function updateWeatherRouteNote(){
    const el=$("weatherRouteNote"); if(!el)return; const code=Number(window.__commuteitWeatherCode); if(!Number.isFinite(code)){el.classList.add('hidden');return;}
    const rainy=[51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code); el.classList.remove('hidden'); el.innerHTML=rainy?'<strong>🌧 Weather-aware tip:</strong> Rain is currently affecting Manila. Consider a route with fewer exposed walking links and allow extra travel time.':'<strong>☀ Weather-aware tip:</strong> Current Manila weather is suitable for normal walking and cycling conditions.';
  }

  async function loadCarpoolPosts(){
    const el=$("carpoolList"); if(!el)return;
    let posts=[];
    if(SB && user?.id){const {data,error}=await SB.from('carpool_posts').select('*').order('departure_at',{ascending:true}).limit(50); if(!error&&data) posts=data.map(x=>({id:x.id,remote_id:x.id,user_id:x.user_id,from:x.from_location,to:x.to_location,departure:x.departure_at,seats:x.seats,created:x.created_at}));}
    if(!posts.length) posts=getJSON(CARPOOL_KEY,[]);
    if(!posts.length){el.innerHTML='<div class="empty-state">No carpool posts yet. Create one to start matching.</div>';return;}
    const myFrom=($("carpoolFrom")?.value||'').trim().toLowerCase(), myTo=($("carpoolTo")?.value||'').trim().toLowerCase();
    posts.sort((a,b)=>{const am=myFrom&&a.from.toLowerCase().includes(myFrom)&&myTo&&a.to.toLowerCase().includes(myTo)?0:1;const bm=myFrom&&b.from.toLowerCase().includes(myFrom)&&myTo&&b.to.toLowerCase().includes(myTo)?0:1;return am-bm||new Date(a.departure)-new Date(b.departure)});
    el.innerHTML=posts.map(x=>`<div class="saved-item"><div><strong>${escapeHtml(x.from)} → ${escapeHtml(x.to)}</strong><p>${new Date(x.departure).toLocaleString()} • ${x.seats} seat${Number(x.seats)===1?'':'s'} available</p></div><div class="saved-actions">${x.user_id===user?.id?`<button data-carpool-delete="${x.id}">Delete</button>`:'<button type="button" data-carpool-contact="1">Match</button>'}</div></div>`).join('');
    el.querySelectorAll('[data-carpool-delete]').forEach(b=>b.onclick=()=>deleteCarpoolPost(b.dataset.carpoolDelete));
    el.querySelectorAll('[data-carpool-contact]').forEach(b=>b.onclick=()=>alert('Match request noted. Contact details are intentionally not exposed publicly in this prototype.'));
  }
  async function postCarpool(){
    const from=$("carpoolFrom")?.value.trim(),to=$("carpoolTo")?.value.trim(),departure=$("carpoolTime")?.value,seats=Math.max(1,Math.min(6,Number($("carpoolSeats")?.value||1)));
    if(!from||!to||!departure){$("carpoolMessage").textContent='Please enter From, To, departure time, and seats.';return;}
    const item={from,to,departure,seats,created:new Date().toISOString(),user_id:user?.id||null,id:Date.now()};
    if(SB&&user?.id){const {data,error}=await SB.from('carpool_posts').insert({user_id:user.id,from_location:from,to_location:to,departure_at:new Date(departure).toISOString(),seats}).select('*').single(); if(error){$("carpoolMessage").textContent=error.message;return;} item.id=data.id;item.remote_id=data.id;}
    const local=getJSON(CARPOOL_KEY,[]);local.unshift(item);setJSON(CARPOOL_KEY,local.slice(0,50));$("carpoolMessage").textContent='Carpool posted successfully.';loadCarpoolPosts();
  }
  async function deleteCarpoolPost(id){ if(SB&&user?.id) await SB.from('carpool_posts').delete().eq('id',id).eq('user_id',user.id); setJSON(CARPOOL_KEY,getJSON(CARPOOL_KEY,[]).filter(x=>String(x.id)!==String(id)));loadCarpoolPosts(); }
  async function loadGovernmentInsights(){
    const el=$("governmentInsights"); if(!el||!SB)return;
    const {data,error}=await SB.rpc('get_public_route_stats');
    if(!error&&data?.length){el.innerHTML=`<div class="planning-metrics"><div><strong>${data.reduce((a,x)=>a+Number(x.trip_count||0),0)}</strong><span>aggregated trips</span></div><div><strong>${data.length}</strong><span>top route groups</span></div><div><strong>${(data.reduce((a,x)=>a+Number(x.avg_co2||0),0)/Math.max(1,data.length)).toFixed(2)} kg</strong><span>average CO₂ per group</span></div></div><div class="planning-route-list">${data.slice(0,5).map((x,i)=>`<div><span>${i+1}</span><strong>${escapeHtml(x.route)}</strong><small>${x.trip_count} trips • ${Number(x.avg_duration||0).toFixed(0)} min average</small></div>`).join('')}</div>`;}
    else {const trips=getJSON(TRIPS_KEY,[]);el.innerHTML=`<div class="planning-metrics"><div><strong>${trips.length}</strong><span>trips available in this account</span></div><div><strong>${new Set(trips.map(t=>t.from+'→'+t.to)).size}</strong><span>route groups</span></div><div><strong>${trips.reduce((a,t)=>a+Number(t.co2||0),0).toFixed(2)} kg</strong><span>CO₂ represented locally</span></div></div>`;}
  }

  function modeLabel(mode){return ({BEST:"Recommended",DRIVING:"Drive",WALKING:"Walk",BICYCLING:"Bike",BUS:"Bus",TRAIN:"Train",TAXI:"Taxi",JEEPNEY:"Jeepney",TRANSIT:"Smart Commute"})[mode]||"Route"}
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

  $("openSidebar")?.addEventListener("click",openSidebar);
  $("closeSidebar")?.addEventListener("click",closeSidebar);
  $("sidebarBackdrop")?.addEventListener("click",closeSidebar);
  document.querySelectorAll(".side-link[data-section]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();navigateSection(a.dataset.section)}));
  $("commuteModeBtn")?.addEventListener("click",()=>openPlannerMode("commute"));
  $("privateVehicleBtn")?.addEventListener("click",()=>openPlannerMode("private"));
  $("backToPlannerChoices")?.addEventListener("click",showPlannerChooser);
  $("changeModeBtn")?.addEventListener("click",()=>{if(plannerCategory==="commute"){$("fromInput")?.focus();return;} $("plannerWorkspace")?.classList.add("hidden");document.querySelectorAll(".mode-option").forEach(b=>b.classList.remove("active"));});
  document.querySelectorAll(".mode-option[data-route-mode]").forEach(b=>b.addEventListener("click",()=>chooseRouteMode(b.dataset.routeMode)));
  function maybeAutoCommute(){
    if(plannerCategory !== "commute") return;
    clearTimeout(commuteAutoTimer);
    const from=$("fromInput")?.value.trim(),to=$("toInput")?.value.trim();
    if(!from || !to) return;
    commuteAutoTimer=setTimeout(()=>planRoute(),650);
  }
  $("swapRouteBtn")?.addEventListener("click",()=>{
    const from=$("fromInput"), to=$("toInput");
    if(!from || !to) return;
    const fromValue=from.value, toValue=to.value;
    const fromLat=from.dataset.lat, fromLng=from.dataset.lng;
    const toLat=to.dataset.lat, toLng=to.dataset.lng;
    from.value=toValue; to.value=fromValue;
    if(toLat !== undefined) from.dataset.lat=toLat; else delete from.dataset.lat;
    if(toLng !== undefined) from.dataset.lng=toLng; else delete from.dataset.lng;
    if(fromLat !== undefined) to.dataset.lat=fromLat; else delete to.dataset.lat;
    if(fromLng !== undefined) to.dataset.lng=fromLng; else delete to.dataset.lng;
    updateTrainFarePreview();
    maybeAutoCommute();
  });
  $("fromInput")?.addEventListener("input",()=>{
    const el=$("fromInput");
    if(el) { delete el.dataset.lat; delete el.dataset.lng; }
    updateTrainFarePreview();
    maybeAutoCommute();
  });
  $("toInput")?.addEventListener("input",()=>{
    const el=$("toInput");
    if(el) { delete el.dataset.lat; delete el.dataset.lng; }
    updateTrainFarePreview();
    maybeAutoCommute();
  });
  $("routeBtn")?.addEventListener("click",planRoute);
  $("clearRouteBtn")?.addEventListener("click",()=>{directionsRenderer?.setDirections({routes:[]});$("routeCards").innerHTML="";$("routeSummary").className="route-summary empty";$("routeSummary").innerHTML="<strong>Route details will appear here.</strong><span>Enter an origin and destination, then choose “Show route”.</span>"; if(userLocationMarker && map) userLocationMarker.setMap(map);});
  $("useLocationBtn")?.addEventListener("click",useMyLocation);
  $("impactPeriod")?.addEventListener("change", refreshDashboard);
  function swapFieldValues(fromId,toId){
    const from=$(fromId), to=$(toId);
    if(!from || !to) return;
    const value=from.value; from.value=to.value; to.value=value;
    if(from.dataset.lat || from.dataset.lng || to.dataset.lat || to.dataset.lng){
      const fromLat=from.dataset.lat, fromLng=from.dataset.lng;
      const toLat=to.dataset.lat, toLng=to.dataset.lng;
      if(toLat !== undefined) from.dataset.lat=toLat; else delete from.dataset.lat;
      if(toLng !== undefined) from.dataset.lng=toLng; else delete from.dataset.lng;
      if(fromLat !== undefined) to.dataset.lat=fromLat; else delete to.dataset.lat;
      if(fromLng !== undefined) to.dataset.lng=fromLng; else delete to.dataset.lng;
    }
  }
  $("dashSwapBtn")?.addEventListener("click",()=>swapFieldValues("dashFrom","dashTo"));
  $("carpoolSwapBtn")?.addEventListener("click",()=>{
    swapFieldValues("carpoolFrom","carpoolTo");
    loadCarpoolPosts();
  });
  $("dashPlanBtn")?.addEventListener("click",()=>{
    $("fromInput").value=$("dashFrom").value; $("toInput").value=$("dashTo").value;
    navigateSection("planner");
    openPlannerMode("private");
    chooseRouteMode("BEST");
    setTimeout(planRoute,250);
  });
  $("settingsLogoutBtn")?.addEventListener("click",()=>$("logoutBtn")?.click());
  $("logoutBtn")?.addEventListener("click",async()=>{
    const wasDemo=!!user?.demo;
    if (wasDemo) await resetDemoRemoteData();
    if (realtimeChannel && SB) { await SB.removeChannel(realtimeChannel); realtimeChannel = null; }
    if (SB) await SB.auth.signOut();
    [USER_KEY,SAVED_KEY,TRIPS_KEY,LAST_KEY,FEEDBACK_KEY,CARPOOL_KEY].forEach(k=>localStorage.removeItem(k));
    window.location.href="index.html";
  });
  $("postCarpoolBtn")?.addEventListener("click",postCarpool);
  ["carpoolFrom","carpoolTo"].forEach(id=>$(id)?.addEventListener("input",loadCarpoolPosts));

  $("saveNameBtn")?.addEventListener("click", saveNameSettings);
  $("settingsFirstName")?.addEventListener("keydown", e=>{if(e.key==="Enter") saveNameSettings();});
  $("settingsLastName")?.addEventListener("keydown", e=>{if(e.key==="Enter") saveNameSettings();});
  $("darkModeSetting")?.addEventListener("change", e=>applyDarkMode(e.target.checked, true));
  $("rememberSetting")?.addEventListener("change", e=>saveUserPreference("rememberMe", !!e.target.checked));
  restoreUserPreferences();

  $("clearLocalData")?.addEventListener("click",async()=>{if(confirm("Clear saved routes, trip history, and last route from this browser?")){if(user?.demo) await resetDemoRemoteData();localStorage.removeItem(SAVED_KEY);localStorage.removeItem(TRIPS_KEY);localStorage.removeItem(LAST_KEY);refreshDashboard();renderSaved();renderTrips();refreshReports()}});

  const hash=(location.hash||"#dashboard").slice(1);
  navigateSection(["dashboard","planner","trips","saved","reports","community","settings","about"].includes(hash)?hash:"dashboard");
  refreshDashboard();renderSaved();renderTrips();refreshReports();
  updateSettingsVisibility();
  populateNameSettings();
  restoreUserPreferences();
  if (SB) syncFromSupabase();
  window.CommuteITApp = { navigateSection, useMyLocation };
})();