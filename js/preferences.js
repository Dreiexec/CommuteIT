(() => {
  const COOKIE_DAYS = 180;
  function setCookie(name, value, days=COOKIE_DAYS) {
    const expires = new Date(Date.now() + days*864e5).toUTCString();
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}; expires=${expires}; path=/; SameSite=Lax`;
  }
  function getCookie(name) {
    const key = `${encodeURIComponent(name)}=`;
    const found = document.cookie.split('; ').find(row => row.startsWith(key));
    return found ? decodeURIComponent(found.slice(key.length)) : null;
  }
  function removeCookie(name) {
    document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
  }
  const storageGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const storageSet = (key, value) => { try { localStorage.setItem(key, String(value)); } catch {} };
  const storageRemove = key => { try { localStorage.removeItem(key); } catch {} };
  const api = {setCookie, getCookie, removeCookie, storageGet, storageSet, storageRemove};
  window.CommuteITPreferences = api;
})();
