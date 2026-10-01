/* CommuteIT live Manila clock + weather */
(() => {
  const clock = document.getElementById('clockToggle');
  const weatherBtn = document.getElementById('tempToggle');
  const weatherIcon = document.getElementById('weatherIcon');
  const weatherText = document.getElementById('weatherText');
  const weatherTemp = document.getElementById('weatherTemp');
  if (!clock && !weatherBtn) return;

  const prefs = window.CommuteITPreferences || {};
  const ownerKey = (() => {
    try {
      const u = JSON.parse(localStorage.getItem("commuteit_user") || "null");
      if (u?.demo || u?.anonymous) return "demo";
      if (u?.id) return "user_" + String(u.id).replace(/[^a-zA-Z0-9_-]/g,"_");
      if (u?.email) return "email_" + String(u.email).toLowerCase().replace(/[^a-zA-Z0-9_-]/g,"_");
    } catch {}
    return "device";
  })();
  const prefKey = name => `commuteit_site_preferences_${ownerKey}_${name}`;
  const prefGet = key => { try { return localStorage.getItem(prefKey(key)); } catch { return null; } };
  const prefSet = (key, value) => { try { localStorage.setItem(prefKey(key), value); } catch {} };
  let use12Hour = prefGet("time_12h") === "1";
  let useFahrenheit = prefGet("temp_f") === "1";
  let weatherC = null;
  let weatherTimer = null;

  const weatherCode = code => {
    if (code === 0) return ['☀', 'Sunny'];
    if ([1,2,3].includes(code)) return ['⛅', 'Partly cloudy'];
    if ([45,48].includes(code)) return ['🌫', 'Foggy'];
    if ([51,53,55,56,57].includes(code)) return ['🌦', 'Drizzle'];
    if ([61,63,65,66,67,80,81,82].includes(code)) return ['🌧', 'Rainy'];
    if ([71,73,75,77,85,86].includes(code)) return ['❄', 'Snowy'];
    if ([95,96,99].includes(code)) return ['⛈', 'Thunderstorm'];
    return ['🌤', 'Weather'];
  };

  function renderClock() {
    if (!clock) return;
    const now = new Date();
    const text = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: use12Hour
    }).format(now);
    clock.textContent = text;
    clock.setAttribute('aria-label', `Manila time ${text}. Click to switch format.`);
    clock.title = use12Hour ? 'Switch to 24-hour format' : 'Switch to 12-hour format';
  }

  function renderWeather() {
    if (!weatherTemp || weatherC === null) return;
    const [icon, label] = weatherCode(window.__commuteitWeatherCode);
    const value = useFahrenheit ? (weatherC * 9 / 5 + 32) : weatherC;
    weatherTemp.textContent = `${Math.round(value)}°${useFahrenheit ? 'F' : 'C'}`;
    if (weatherIcon) weatherIcon.textContent = icon;
    if (weatherText) weatherText.textContent = label;
    if (weatherBtn) {
      weatherBtn.title = useFahrenheit ? 'Switch to Celsius' : 'Switch to Fahrenheit';
      weatherBtn.setAttribute('aria-label', `${label}, ${Math.round(value)} degrees ${useFahrenheit ? 'Fahrenheit' : 'Celsius'}. Click to switch unit.`);
    }
  }

  function updateHazardAlert() {
    const alert = document.getElementById('hazardAlert');
    const title = document.getElementById('hazardAlertTitle');
    const text = document.getElementById('hazardAlertText');
    const time = document.getElementById('hazardAlertTime');
    const icon = document.getElementById('hazardAlertIcon');
    if (!alert || !title || !text) return;

    const data = window.__commuteitWeatherData || {};
    const code = Number(window.__commuteitWeatherCode);
    const rain = Number(data.rain || 0);
    const showers = Number(data.showers || 0);
    const precipitation = Number(data.precipitation || 0);
    const wind = Number(data.wind_speed_10m || 0);
    const thunderstorm = [95,96,99].includes(code);
    const heavyRain = [65,67,82].includes(code) || rain >= 7.5 || showers >= 7.5 || precipitation >= 7.5;
    const strongWind = wind >= 60;

    if (!(thunderstorm || heavyRain || strongWind)) {
      alert.classList.add('hidden');
      return;
    }

    if (thunderstorm) {
      icon.textContent = '⛈';
      title.textContent = 'Thunderstorm alert';
      text.textContent = 'Thunderstorms are currently detected around Manila. Heavy rain can increase the risk of flash floods and landslides.';
    } else if (heavyRain) {
      icon.textContent = '🌧';
      title.textContent = 'Heavy rain alert';
      text.textContent = 'Heavy rainfall is currently detected around Manila. Possible flash floods or landslides may affect travel routes.';
    } else {
      icon.textContent = '💨';
      title.textContent = 'Strong wind alert';
      text.textContent = 'Strong winds are currently detected around Manila. Expect possible travel disruptions and monitor official advisories.';
    }
    time.textContent = `Live update • ${new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())} Manila time`;
    alert.classList.remove('hidden');
  }

  async function loadWeather() {
    if (!weatherBtn) return;
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=14.5995&longitude=120.9842&current=temperature_2m,weather_code,precipitation,rain,showers,wind_speed_10m&timezone=Asia%2FManila';
      const response = await fetch(url, {cache:'no-store'});
      if (!response.ok) throw new Error('Weather request failed');
      const data = await response.json();
      weatherC = Number(data?.current?.temperature_2m);
      window.__commuteitWeatherCode = Number(data?.current?.weather_code);
      window.__commuteitWeatherData = data?.current || {};
      renderWeather();
      updateHazardAlert();
    } catch {
      if (weatherText) weatherText.textContent = 'Weather unavailable';
      if (weatherTemp) weatherTemp.textContent = '--°C';
      if (weatherIcon) weatherIcon.textContent = '•';
    }
  }

  clock?.addEventListener('click', () => { use12Hour = !use12Hour; prefSet("time_12h", use12Hour ? "1" : "0"); renderClock(); });
  weatherBtn?.addEventListener('click', () => { useFahrenheit = !useFahrenheit; prefSet("temp_f", useFahrenheit ? "1" : "0"); renderWeather(); });
  document.getElementById('hazardAlertClose')?.addEventListener('click', () => document.getElementById('hazardAlert')?.classList.add('hidden'));
  renderClock();
  setInterval(renderClock, 1000);
  loadWeather();
  weatherTimer = setInterval(loadWeather, 10 * 60 * 1000);
  window.addEventListener('beforeunload', () => clearInterval(weatherTimer));
})();
