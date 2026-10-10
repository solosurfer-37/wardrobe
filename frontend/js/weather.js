(function () {
  const $ = id => document.getElementById(id);
  // Elements can be removed from the card (e.g. the tip line is commented out in index.html):
  // write only to the ones that exist, so one missing element never breaks the whole card.
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const card = $('weather-card');
  if (!card) return;

  const MAP = c =>
    c === 0 || c === 1 ? ['clear', 'Clear sky', 'sun'] :
    c === 2 || c === 3 ? ['cloud', 'Cloudy', 'cloud'] :
    c === 45 || c === 48 ? ['cloud', 'Foggy', 'cloud-fog'] :
    (c >= 51 && c <= 67) || (c >= 80 && c <= 82) ? ['rain', 'Rainy', 'cloud-rain'] :
    (c >= 71 && c <= 77) || c === 85 || c === 86 ? ['snow', 'Snowfall', 'snowflake'] :
    c >= 95 ? ['storm', 'Thunderstorm', 'cloud-lightning'] : ['cloud', 'Cloudy', 'cloud'];

  function tip(t, cond) {
    if (cond === 'rain' || cond === 'storm') return 'Carry a waterproof jacket, skip suede shoes.';
    if (cond === 'snow') return 'Layer up: sweater + heavy jacket + boots.';
    if (t >= 32) return 'Hot day. Go light: cotton tee, shorts, sandals.';
    if (t >= 24) return 'Pleasant. T-shirt or light shirt works great.';
    if (t >= 15) return 'Mild. Add a light jacket or hoodie.';
    return 'Chilly. Sweater + jacket recommended.';
  }

  function fx(cond) {
    const box = $('wx-fx');
    if (!box) return;
    box.innerHTML = '';
    if (cond !== 'rain' && cond !== 'storm' && cond !== 'snow') return;
    const snow = cond === 'snow', n = snow ? 30 : 45;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i');
      d.className = snow ? 'flake' : 'drop';
      d.style.left = Math.random() * 100 + '%';
      d.style.animationDuration = (snow ? 3 + Math.random() * 3 : 0.6 + Math.random() * 0.6) + 's';
      d.style.animationDelay = -Math.random() * 3 + 's';
      box.appendChild(d);
    }
  }

  function render(d, placeName) {
    const [cond, desc, icon] = MAP(d.weather_code);
    const t = Math.round(d.temperature_2m);
    card.dataset.cond = cond;
    const loc = $('wx-loc');
    if (loc) loc.innerHTML = '<i data-lucide="map-pin"></i> ' + placeName;
    setText('wx-desc', desc);
    setText('wx-temp', t);
    setText('wx-feels', Math.round(d.apparent_temperature) + '°');
    setText('wx-hum', d.relative_humidity_2m);
    setText('wx-wind', Math.round(d.wind_speed_10m));
    setText('wx-tip', tip(t, cond));
    const ic = $('wx-icon');
    if (ic) ic.setAttribute('data-lucide', icon);
    fx(cond);
    window.lucide && lucide.createIcons();
  }

  async function load(lat, lon, placeName) {
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m`;
      const r = await fetch(u);
      const j = await r.json();
      render(j.current, placeName);
    } catch (e) {
      setText('wx-desc', 'Unavailable');
      setText('wx-tip', 'Weather load nahi hua. Internet check kar.');
    }
  }

  async function place(lat, lon) {
    try {
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const j = await r.json();
      return j.city || j.locality || 'Your location';
    } catch { return 'Your location'; }
  }

    const fallback = () => load(26.9124, 75.7873, 'Jaipur');
  const CACHE_KEY = 'wx_geo';
  const TTL = 30 * 60 * 1000; // 30 min

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      return c && Date.now() - c.t < TTL ? c : null;
    } catch { return null; }
  }

  async function fresh() {
    navigator.geolocation.getCurrentPosition(
      async p => {
        const { latitude: lat, longitude: lon } = p.coords;
        const name = await place(lat, lon);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lon, name, t: Date.now() }));
        load(lat, lon, name);
      },
      () => {
        // deny/fail hua: dobara na puche, 30 min tak Jaipur
        localStorage.setItem(CACHE_KEY, JSON.stringify({ lat: 26.9124, lon: 75.7873, name: 'Jaipur', t: Date.now() }));
        fallback();
      },
      { timeout: 6000, maximumAge: TTL }
    );
  }

  const cached = readCache();
  if (cached) load(cached.lat, cached.lon, cached.name);
  else if (navigator.geolocation) fresh();
  else fallback();
})();

