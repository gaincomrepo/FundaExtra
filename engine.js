/* AM-ENGINE: gedeelde rekenkern van de Aankoopmakelaar (draait in de pagina en in node). */
(function (root) {
  var AM = {};

  AM.interp = function (pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
    }
    return pts[pts.length - 1][1];
  };

  AM.LABELPT = { 'A+++++': 1, 'A++++': 1, 'A+++': 1, 'A++': 1, 'A+': 1, 'A': 1, 'B': 0.85, 'C': 0.65, 'D': 0.5, 'E': 0.35, 'F': 0.2, 'G': 0.1 };
  AM.STATUS = { b: 'Beschikbaar', o: 'Onder bod', p: 'Onder optie', v: 'Verkocht o.v.', x: 'Van de markt' };

  function r1(x) { return Math.round(x * 10) / 10; }

  /* Malus voor ligging richting Rotterdam / Den Haag (zuidwesten). */
  AM.zuidwest = function (h, cfg) {
    if (h.lat == null || h.lon == null) return 0;
    var z = cfg.zuidwest;
    if (h.lon >= z.lonGrens) return 0;
    return Math.max(0, Math.min(z.max, (z.latGrens - h.lat) * z.perGraad));
  };

  /* Puntentelling. Geeft {tot, delen:{...}, malus:{vlaggen, zuidwest}, voorlopig}. */
  AM.score = function (h, cfg) {
    var g = cfg.gewicht, k = cfg.krommen, d = h.d || null, delen = {};
    delen.reis = h.reis == null ? g.reis * 0.4 : g.reis * AM.interp(k.reis, h.reis);
    delen.perceel = h.perceel ? g.perceel * AM.interp(k.perceel, h.perceel) : g.perceel * 0.3;
    delen.prijs = h.prijs ? g.prijs * AM.interp(k.prijs, h.prijs) : g.prijs * 0.5;
    var pf = Math.min(1, (h.perceel || 0) / 5000);
    if (d && d.pr != null && d.gr != null && d.w != null) delen.ligging = g.ligging * ((d.pr + d.gr + d.w) / 9);
    else delen.ligging = g.ligging * (0.22 + 0.45 * pf);
    if (d && d.vrij != null) delen.type = g.type * (d.vrij >= 2 ? 1 : d.vrij === 1 ? 0.4 : 0);
    else delen.type = g.type * ((h.perceel || 0) >= 1000 ? 0.75 : 0.5);
    var woonF = h.woon ? AM.interp(k.woon, h.woon) : 0.5;
    var labelF = AM.LABELPT[h.label] != null ? AM.LABELPT[h.label] : 0.5;
    var staatF = (d && d.sta != null) ? d.sta / 3 : 0.5;
    delen.woning = g.woning * (0.5 * woonF + 0.3 * labelF + 0.2 * staatF);
    delen.bij = g.bij * ((d && d.bij != null) ? Math.min(2, d.bij) / 2 : 0.5);
    var mv = 0;
    if (d && d.vl) for (var i = 0; i < d.vl.length; i++) mv += cfg.vlagPunten[d.vl[i][0]] || 0;
    if (h.azc && h.azc.km != null && !(d && d.vl && d.vl.some(function (v) { return /azc|opvang|asiel/i.test(v[1]); }))) {
      var az = cfg.azc || { rood: 3, oranje: 6, malusRood: 5, malusOranje: 2 };
      if (h.azc.km <= az.rood) mv += az.malusRood; else if (h.azc.km <= az.oranje) mv += az.malusOranje;
    }
    mv = Math.min(cfg.vlagMax, mv);
    var mz = AM.zuidwest(h, cfg);
    var som = 0, kk;
    for (kk in delen) { delen[kk] = r1(delen[kk]); som += delen[kk]; }
    var tot = Math.max(0, Math.min(100, som - mv - mz));
    return { tot: r1(tot), delen: delen, malus: { vlaggen: r1(mv), zuidwest: r1(mz) }, voorlopig: !(d && d.pr != null) };
  };

  AM.TOP = 85;
  AM.band = function (tot) { return tot >= AM.TOP ? 'top' : tot >= 75 ? 'sterk' : tot >= 65 ? 'kans' : 'zwak'; };
  AM.BANDNAAM = { top: 'Topmatch', sterk: 'Sterk', kans: 'Kansrijk', zwak: 'Zwak' };

  AM.fundaUrl = function (h) { return 'https://www.funda.nl' + h.pad; };
  /* Funda-app: op Android een intent-link naar de app (valt terug op de website); op iOS/overig opent de gewone https-link via universal links in de app. */
  AM.fundaApp = function (h, ua) {
    var u = AM.fundaUrl(h);
    if (/Android/i.test(ua || '')) return 'intent://www.funda.nl' + h.pad + '#Intent;scheme=https;package=nl.funda.android;S.browser_fallback_url=' + encodeURIComponent(u) + ';end';
    return u;
  };
  AM.kadaster = function (h) { return h.kad ? 'https://kadastralekaart.com/kaart/perceel/' + h.kad : null; };
  /* PDOK-luchtfoto (actueel, hoge resolutie) en kadastrale perceelgrenzen als losse WMS-beelden rond het adrespunt. */
  AM.bbox = function (h, w, hg, m) {
    var d = (m || 90) / 111320, dl = d * (w / hg) / Math.cos(h.lat * Math.PI / 180);
    return [h.lat - d, h.lon - dl, h.lat + d, h.lon + dl].map(function (x) { return x.toFixed(6); }).join(',');
  };
  AM.luchtfotoImg = function (h, w, hg, m) {
    if (h.lat == null) return null;
    return 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Actueel_orthoHR&STYLES=&CRS=EPSG:4326&FORMAT=image/jpeg&WIDTH=' + w + '&HEIGHT=' + hg + '&BBOX=' + AM.bbox(h, w, hg, m);
  };
  AM.perceelImg = function (h, w, hg, m) {
    if (h.lat == null) return null;
    return 'https://service.pdok.nl/kadaster/kadastralekaart/wms/v5_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Perceelvlak&STYLES=&CRS=EPSG:4326&FORMAT=image/png&TRANSPARENT=true&WIDTH=' + w + '&HEIGHT=' + hg + '&BBOX=' + AM.bbox(h, w, hg, m);
  };
  AM.fotoUrl = function (h) { return h.ft ? 'https://cloud.funda.nl/valentina_media/' + h.ft + '.jpg?options=width=228' : null; };
  /* Luchtfoto: Google Maps satelliet, recht van boven, met speld op het adres. */
  AM.luchtfoto = function (h) {
    if (h.lat != null && h.lon != null) {
      var ll = h.lat.toFixed(6) + ',' + h.lon.toFixed(6);
      return 'https://www.google.com/maps/place/' + ll + '/@' + ll + ',180m/data=!3m1!1e3';
    }
    return 'https://www.google.com/maps/place/' + encodeURIComponent(h.adres + ', ' + h.pc + ' ' + h.plaats) + '/data=!3m1!1e3';
  };
  AM.route = function (h, cfg) {
    var van = (h.lat != null) ? h.lat.toFixed(6) + ',' + h.lon.toFixed(6) : encodeURIComponent(h.adres + ', ' + h.plaats);
    return 'https://www.google.com/maps/dir/?api=1&origin=' + van + '&destination=' + cfg.amsterdam[1] + ',' + cfg.amsterdam[0] + '&travelmode=driving';
  };

  function num(s) { var n = parseInt(String(s == null ? '' : s).replace(/[^0-9]/g, ''), 10); return isNaN(n) ? null : n; }

  /* Zet de regels uit de Funda-zoekpagina (path|adres|postcode|plaats|prijs|woon|perceel|slk|label|makelaar|badge) om. */
  AM.parseRegels = function (tekst) {
    var uit = [], regels = String(tekst).split(/\r?\n/);
    for (var i = 0; i < regels.length; i++) {
      var r = regels[i].trim();
      if (r.indexOf('/detail/') !== 0) continue;
      var f = r.split('|');
      if (f.length < 11) continue;
      var foto = null;
      if (/^(https?:\/\/[^|]*valentina_media\/)?\d+\/\d+\/\d+(\.jpg)?(\?[^|]*)?$/.test(f[f.length - 1].trim())) { foto = f.pop().trim().replace(/^.*valentina_media\//, '').replace(/\.jpg.*$/, ''); }
      if (foto === null && f.length >= 12 && f[f.length - 1].trim() === '-') f.pop();
      if (f.length < 11) continue;
      var badge = f[f.length - 1].trim();
      var mak = f.slice(9, f.length - 1).join('|').replace(/\s*\|+\s*/g, ' | ').trim();
      var pad = f[0].trim();
      var m = pad.match(/\/(\d{6,})\/?$/);
      if (!m) continue;
      var bl = badge.toLowerCase();
      var st = bl.indexOf('verkocht onder voorbehoud') >= 0 ? 'v' : bl.indexOf('onder bod') >= 0 ? 'o' : bl.indexOf('onder optie') >= 0 ? 'p' : /(^|[;,]\s*)verkocht/.test(bl) ? 'x' : 'b';
      var adres = f[1].trim();
      var nb = bl.indexOf('nieuwbouw') >= 0 || /bouwnr|bouwkavel|bouwnummer/i.test(adres) || pad.indexOf('/nieuwbouw') >= 0;
      var label = f[8].trim().toUpperCase();
      if (!AM.LABELPT[label]) label = '';
      uit.push({
        id: m[1], pad: pad.replace(/\/?$/, '/'), adres: adres, pc: f[2].trim().toUpperCase(), plaats: f[3].trim(),
        prijs: num(f[4]) || 0, woon: num(f[5]), perceel: num(f[6]), slk: num(f[7]), label: label,
        mak: mak === '-' ? '' : mak, st: st, nb: nb ? 1 : 0, ft: foto, nieuwBadge: /(^|[;,]\s*)nieuw(\s*$|\s*[;,])/.test(bl) ? 1 : 0
      });
    }
    return uit;
  };

  /* Afstand in km (grote-cirkel) en opvang in de buurt. */
  AM.km = function (a, b) { var R = 6371, dl = (b.lat - a.lat) * Math.PI / 180, dn = (b.lon - a.lon) * Math.PI / 180, x = Math.sin(dl / 2), y = Math.sin(dn / 2) * Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180); return 2 * R * Math.asin(Math.sqrt(x * x + y * y)); };
  AM.azcNabij = function (h, lijst, maxKm) {
    if (h.lat == null || !lijst) return [];
    return lijst.map(function (l) { return { l: l, km: AM.km(h, l) }; }).filter(function (x) { return x.km <= (maxKm || 10); }).sort(function (a, b) { return a.km - b.km; });
  };
  AM.azcKleur = function (h, cfg) { var az = (cfg && cfg.azc) || { rood: 3, oranje: 6 }; if (!h.azc || h.azc.km == null) return ''; return h.azc.km <= az.rood ? 'rood' : h.azc.km <= az.oranje ? 'oranje' : ''; };
  AM.dagen = function (a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); };

  if (typeof module !== 'undefined' && module.exports) module.exports = AM;
  root.AM = AM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
