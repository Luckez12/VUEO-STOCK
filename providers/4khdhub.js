// 4KHDHub Scraper for Nuvio Local Scrapers
// React Native compatible – no Node core modules, no async/await

const cheerio = require('cheerio-without-node-native');
console.log('[4KHDHub] Using cheerio-without-node-native for DOM parsing');

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
/* VUEO_PROVIDER_REPAIR_V16 */
/* VUEO_PROVIDER_REPAIR_V17 */
/* VUEO_FAST_DISCOVERY_V1 */
/* VUEO_DISCOVERY_REBUILD_V1 */
/* FOURK_MEMORY_SCOPE_GUARD_V1 */
function vueoTrace(stage, details) {
  try {
    if (typeof globalThis !== "undefined" && typeof globalThis.vueoTrace === "function") {
      globalThis.vueoTrace(stage, details || {});
    }
  } catch (_) {}
}

function vueoContextFromRaw(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  return typeof raw === "object" ? raw : null;
}

function vueoSharedTmdb(url, fallback) {
  function normalize(context) {
    var ctx = vueoContextFromRaw(context);
    if (!ctx || ctx.error) return null;
    var tmdb = ctx.tmdb && typeof ctx.tmdb === "object" ? ctx.tmdb : null;
    if (!tmdb) {
      tmdb = {
        id: ctx.tmdbId,
        title: ctx.mediaType === "movie" ? ctx.title : undefined,
        name: ctx.mediaType === "tv" ? ctx.title : undefined,
        original_title: ctx.mediaType === "movie" ? (ctx.originalTitle || ctx.title) : undefined,
        original_name: ctx.mediaType === "tv" ? (ctx.originalTitle || ctx.title) : undefined,
        release_date: ctx.mediaType === "movie" && ctx.year ? String(ctx.year) + "-01-01" : "",
        first_air_date: ctx.mediaType === "tv" && ctx.year ? String(ctx.year) + "-01-01" : "",
        external_ids: { imdb_id: ctx.imdbId || "" }
      };
    }
    vueoTrace("METADATA", {
      shared: true,
      title: ctx.title || tmdb.title || tmdb.name || "",
      year: ctx.year || "",
      imdbId: ctx.imdbId || "",
      aliases: ctx.aliases && ctx.aliases.length ? ctx.aliases.length : 0
    });
    return tmdb;
  }

  try {
    if (typeof globalThis !== "undefined") {
      var direct = normalize(globalThis.VUEO_DISCOVERY_CONTEXT);
      if (direct) return Promise.resolve(direct);
      if (typeof globalThis.vueoDiscoveryContext === "function") {
        return Promise.resolve(globalThis.vueoDiscoveryContext(url))
          .then(function(raw) {
            var shared = normalize(raw);
            if (shared) return shared;
            throw new Error("shared context unavailable");
          })
          .catch(function() {
            vueoTrace("METADATA_FALLBACK", { shared: false });
            return fallback();
          });
      }
    }
  } catch (_) {}

  vueoTrace("METADATA_FALLBACK", { shared: false });
  return fallback();
}


// Constants
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';

// Disable URL validation for faster results
global.DISABLE_4KHDHUB_URL_VALIDATION = true;

// Caches (in-memory only)
let domainsCache = null;
let domainsInFlight = null;
let resolvedUrlsCache = {}; // key -> array of resolved file-host URLs

// Headers
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection': 'keep-alive'
};

// Polyfill atob/btoa for Node test environments if missing (kept lightweight, no imports)
if (typeof atob === 'undefined') {
  try {
    // eslint-disable-next-line no-undef
    global.atob = function (b64) { return Buffer.from(b64, 'base64').toString('binary'); };
  } catch (e) {
    // ignore for RN
  }
}
if (typeof btoa === 'undefined') {
  try {
    // eslint-disable-next-line no-undef
    global.btoa = function (str) { return Buffer.from(str, 'binary').toString('base64'); };
  } catch (e) {
    // ignore for RN
  }
}

// Helper: HTTP
function makeRequest(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...DEFAULT_HEADERS,
      ...(options.headers || {})
    }
  }).then(function (response) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  });
}

// Base64 and misc helpers (RN-safe)
function base64Decode(str) {
  try {
    // Convert base64 -> binary string -> UTF-8
    // escape/unescape is deprecated but works in RN environments for this use case
    // eslint-disable-next-line no-undef
    return decodeURIComponent(escape(atob(str)));
  } catch (e) {
    return '';
  }
}

function base64Encode(str) {
  try {
    // eslint-disable-next-line no-undef
    return btoa(unescape(encodeURIComponent(str)));
  } catch (e) {
    return '';
  }
}

function rot13(str) {
  return (str || '').replace(/[A-Za-z]/g, function (char) {
    var start = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - start + 13) % 26) + start);
  });
}

function decodeFilename(filename) {
  if (!filename) return filename;
  try {
    var decoded = filename;
    if (decoded.indexOf('UTF-8') === 0) {
      decoded = decoded.substring(5);
    }
    return decodeURIComponent(decoded);
  } catch (e) {
    return filename;
  }
}

function getIndexQuality(str) {
  var match = (str || '').match(/(\d{3,4})[pP]/);
  return match ? parseInt(match[1], 10) : 2160;
}

function cleanTitle(title) {
  var decodedTitle = decodeFilename(title || '');
  var parts = decodedTitle.split(/[.\-_]/);
  var qualityTags = ['WEBRip','WEB-DL','WEB','BluRay','HDRip','DVDRip','HDTV','CAM','TS','R5','DVDScr','BRRip','BDRip','DVD','PDTV','HD'];
  var audioTags = ['AAC','AC3','DTS','MP3','FLAC','DD5','EAC3','Atmos'];
  var subTags = ['ESub','ESubs','Subs','MultiSub','NoSub','EnglishSub','HindiSub'];
  var codecTags = ['x264','x265','H264','HEVC','AVC'];

  var startIndex = parts.findIndex(function (part) {
    return qualityTags.some(function (tag) { return part.toLowerCase().indexOf(tag.toLowerCase()) !== -1; });
  });

  var endIndex = parts.map(function (part, index) {
    var hasTag = subTags.concat(audioTags).concat(codecTags).some(function (tag) {
      return part.toLowerCase().indexOf(tag.toLowerCase()) !== -1;
    });
    return hasTag ? index : -1;
  }).filter(function (i) { return i !== -1; }).pop() || -1;

  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    return parts.slice(startIndex, endIndex + 1).join('.');
  } else if (startIndex !== -1) {
    return parts.slice(startIndex).join('.');
  } else {
    return parts.slice(-3).join('.');
  }
}

function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


/* VUEO_TITLE_PROFILE_V1 */
function collectTmdbAliases(data, mediaType) {
  var output = [];
  var seen = Object.create(null);

  function add(value, priority) {
    var text = String(value || '').trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    output.push({ title: text, priority: Number(priority || 0) });
  }

  add(data && (data.title || data.name), 100);
  add(data && (data.original_title || data.original_name), 95);

  var altRoot = data && data.alternative_titles;
  var altItems = altRoot && Array.isArray(altRoot.titles)
    ? altRoot.titles
    : altRoot && Array.isArray(altRoot.results)
      ? altRoot.results
      : [];
  altItems.forEach(function(item) {
    if (!item) return;
    var country = String(item.iso_3166_1 || '').toUpperCase();
    var priority = country === 'US' || country === 'GB' ? 86 : (country === 'MY' || country === 'ID' ? 82 : 72);
    add(item.title || item.name, priority);
  });

  var translations = data && data.translations && Array.isArray(data.translations.translations)
    ? data.translations.translations
    : [];
  translations.forEach(function(item) {
    var row = item && item.data && typeof item.data === 'object' ? item.data : {};
    var lang = String(item && item.iso_639_1 || '').toLowerCase();
    var priority = lang === 'en' ? 88 : (lang === 'ms' || lang === 'id' ? 80 : 68);
    add(row.title || row.name, priority);
  });

  output.sort(function(a, b) { return b.priority - a.priority; });
  return output.map(function(item) { return item.title; }).slice(0, 12);
}

function cleanDiscoveryTitle4K(value) {
  return normalizeTitle(
    String(value || '')
      .replace(/\[(?:[^\]]{0,140})\]/g, ' ')
      .replace(/\b(?:19|20)\d{2}\b/g, ' ')
      .replace(/\bseason\s*\d{1,2}\b/gi, ' ')
      .replace(/\bs\d{1,2}\b/gi, ' ')
      .replace(/\b(?:2160p|1080p|720p|480p|4k|web[- ]?dl|webrip|bluray|hevc|h26[45]|10bit|dual audio|full movie|full series|all episodes)\b/gi, ' ')
  );
}

function bestAliasSimilarity4K(candidate, info) {
  var aliases = info && Array.isArray(info.aliases) && info.aliases.length
    ? info.aliases
    : [info && info.title, info && info.originalTitle];
  var cleanCandidate = cleanDiscoveryTitle4K(candidate);
  var best = 0;
  aliases.forEach(function(alias) {
    var cleanAlias = cleanDiscoveryTitle4K(alias);
    best = Math.max(best, calculateSimilarity(candidate, alias));
    if (cleanCandidate && cleanAlias) {
      if (cleanCandidate === cleanAlias) best = Math.max(best, 1);
      else if (cleanCandidate.indexOf(cleanAlias) !== -1 || cleanAlias.indexOf(cleanCandidate) !== -1) best = Math.max(best, 0.92);
      else best = Math.max(best, calculateSimilarity(cleanCandidate, cleanAlias));
    }
  });
  return best;
}

function buildDiscoveryQueries4K(info, mediaType, season) {
  var output = [];
  var seen = Object.create(null);
  var aliases = info && Array.isArray(info.aliases) && info.aliases.length
    ? info.aliases
    : [info && info.title, info && info.originalTitle];

  function add(value) {
    var text = String(value || '').trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    output.push(text);
  }

  aliases.slice(0, 6).forEach(function(alias) {
    add(alias);
    if (mediaType === 'tv' && season) add(alias + ' season ' + season);
    if (info && info.year) add(alias + ' ' + info.year);
  });

  return output.slice(0, 8);
}

function calculateSimilarity(str1, str2) {
  var s1 = normalizeTitle(str1);
  var s2 = normalizeTitle(str2);
  if (s1 === s2) return 1.0;
  var len1 = s1.length;
  var len2 = s2.length;
  if (len1 === 0) return len2 === 0 ? 1.0 : 0.0;
  if (len2 === 0) return 0.0;
  var matrix = Array(len1 + 1).fill(null).map(function () { return Array(len2 + 1).fill(0); });
  for (var i = 0; i <= len1; i++) matrix[i][0] = i;
  for (var j = 0; j <= len2; j++) matrix[0][j] = j;
  for (i = 1; i <= len1; i++) {
    for (j = 1; j <= len2; j++) {
      var cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  var maxLen = Math.max(len1, len2);
  return (maxLen - matrix[len1][len2]) / maxLen;
}

function findBestMatch(results, info, mediaType, season) {
  if (!results || results.length === 0) return null;
  var scored = results.map(function(r) {
    var score = bestAliasSimilarity4K(r.title, info) * 100;
    var rYear = null;
    var yMatch = String(r.year || r.title || '').match(/(19|20)\d{2}/);
    if (yMatch) rYear = parseInt(yMatch[0], 10);
    var targetYear = parseInt(info && info.year, 10);
    if (targetYear && !isNaN(targetYear)) {
      if (rYear === targetYear) score += 28;
      else if (rYear && Math.abs(rYear - targetYear) <= 1) score += 8;
      else if (rYear) score -= 34;
    }

    if (mediaType === 'tv' && season) {
      var explicitSeason = String(r.title || '').match(/\bseason\s*(\d{1,2})\b/i) || String(r.title || '').match(/\bs(\d{1,2})\b/i);
      if (explicitSeason) {
        if (Number(explicitSeason[1]) === Number(season)) score += 26;
        else score -= 120;
      }
    }
    return { item: r, score: score };
  });
  scored.sort(function(a, b) { return b.score - a.score; });
  if (!scored.length || scored[0].score < 55) return null;
  vueoTrace('CANDIDATE', { count: results.length, title: scored[0].item.title || '', score: Math.round(scored[0].score) });
  return scored[0].item;
}

// URL utils – replicate UHDMovies validation style
function validateVideoUrl(url, timeout) {
  console.log('[4KHDHub] Validating URL: ' + (url.substring(0, 100)) + '...');
  return fetch(url, {
    method: 'HEAD',
    headers: {
      'Range': 'bytes=0-1',
      'User-Agent': DEFAULT_HEADERS['User-Agent']
    }
  }).then(function (response) {
    if (response.ok || response.status === 206) {
      console.log('[4KHDHub] ✓ URL validation successful (' + response.status + ')');
      return true;
    } else {
      console.log('[4KHDHub] ✗ URL validation failed with status: ' + response.status);
      return false;
    }
  }).catch(function (error) {
    console.log('[4KHDHub] ✗ URL validation failed: ' + (error && error.message));
    return false;
  });
}

function getFilenameFromUrl(url) {
  try {
    // Commented out HEAD request for filename fetch
    // return fetch(url, {
    //   method: 'HEAD',
    //   headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] }
    // }).then(function (res) {
    //   var cd = res.headers.get('content-disposition');
    //   var filename = null;
    //   if (cd) {
    //     var match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
    //     if (match && match[1]) filename = (match[1] || '').replace(/["']/g, '');
    //   }
    //   if (!filename) {
    //     try {
    //       var uo = new URL(url);
    //       filename = uo.pathname.split('/').pop() || '';
    //       if (filename && filename.indexOf('.') !== -1) filename = filename.replace(/\.[^.]+$/, '');
    //     } catch (e) { /* ignore */ }
    //   }
    //   var decoded = decodeFilename(filename || '');
    //   return decoded || null;
    // }).catch(function () { return null; });
    
    // Fallback to URL-based filename extraction without HEAD request
    try {
      var uo = new URL(url);
      var filename = uo.pathname.split('/').pop() || '';
      if (filename && filename.indexOf('.') !== -1) filename = filename.replace(/\.[^.]+$/, '');
      var decoded = decodeFilename(filename || '');
      return Promise.resolve(decoded || null);
    } catch (e) { 
      return Promise.resolve(null); 
    }
  } catch (e) {
    return Promise.resolve(null);
  }
}

// Domains
function getDomains() {
  if (domainsCache) return Promise.resolve(domainsCache);
  if (domainsInFlight) return domainsInFlight;
  domainsInFlight = makeRequest(DOMAINS_URL)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      domainsCache = data || {};
      domainsInFlight = null;
      return domainsCache;
    })
    .catch(function() {
      domainsInFlight = null;
      return null;
    });
  return domainsInFlight;
}

// Resolve redirect link style used by 4KHDHub
function getRedirectLinks(url) {
  return makeRequest(url).then(function (res) { return res.text(); }).then(function (html) {
    var regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
    var combined = '';
    var m;
    while ((m = regex.exec(html)) !== null) {
      var val = m[1] || m[2];
      if (val) combined += val;
    }
    try {
      var decoded = base64Decode(rot13(base64Decode(base64Decode(combined))));
      var obj = JSON.parse(decoded);
      var encodedurl = base64Decode(obj.o || '').trim();
      var data = base64Decode(obj.data || '').trim();
      var blog = (obj.blog_url || '').trim();
      if (encodedurl) return encodedurl;
      if (blog && data) {
        return makeRequest(blog + '?re=' + data).then(function (r) { return r.text(); }).then(function (txt) { return (txt || '').trim(); }).catch(function () { return ''; });
      }
      return '';
    } catch (e) {
      return '';
    }
  }).catch(function () { return ''; });
}

function parse4KSearchCards(html, baseUrl) {
  var $ = cheerio.load(String(html || ''));
  var results = [];
  var seen = Object.create(null);

  function add(title, href, poster, year) {
    title = String(title || '').trim();
    href = String(href || '').trim();
    if (!title || !href) return;
    var absoluteUrl = href.indexOf('http') === 0 ? href : (baseUrl + (href.indexOf('/') === 0 ? '' : '/') + href);
    if (seen[absoluteUrl]) return;
    seen[absoluteUrl] = true;
    results.push({ title: title, url: absoluteUrl, poster: poster || '', year: year || '' });
  }

  $('a').each(function(i, el) {
    var $el = $(el);
    add(
      $el.find('h3.movie-card-title').text(),
      $el.attr('href'),
      $el.find('img').attr('src'),
      $el.find('p.movie-card-meta').text()
    );
  });

  $('div.card-grid a').each(function(i, el) {
    var $el = $(el);
    add($el.find('h3').text(), $el.attr('href'), $el.find('img').attr('src'), $el.text());
  });

  if (!results.length) {
    $('a[href]').each(function(i, el) {
      var $el = $(el);
      var href = $el.attr('href') || '';
      var title = $el.find('h2,h3').first().text() || $el.attr('title') || $el.text();
      if (!title || !href) return;
      if (!/movie|season|series|\/(?:19|20)\d{2}\//i.test(String(title) + ' ' + href)) return;
      add(title, href, $el.find('img').attr('src'), $el.text());
    });
  }

  return results;
}

// Search content
function searchContent(query) {
  return getDomains().then(function (domains) {
    if (!domains || !domains['4khdhub']) throw new Error('Failed to get domain information');
    var baseUrl = domains['4khdhub'];
    var searchUrl = baseUrl + '/?s=' + encodeURIComponent(query);
    return makeRequest(searchUrl).then(function (res) { return res.text(); }).then(function (html) {
      return parse4KSearchCards(html, baseUrl);
    });
  });
}

function extractCandidateUrlsFromHtml(html, baseUrl) {
  var $ = cheerio.load(String(html || ''));
  var output = [];
  var seen = Object.create(null);
  var selectors = [
    'div.download-item a',
    '.download-item a',
    'a[href*="hubdrive"]',
    'a[href*="hubcloud"]',
    'a[href*="pixeldrain"]',
    'a[href*="buzz"]',
    'a[href*="10gbps"]',
    'a[href*="drive"]',
    'a.btn[href]'
  ];
  selectors.forEach(function(selector) {
    $(selector).each(function(i, el) {
      var href = String($(el).attr('href') || '').trim();
      if (!href) return;
      try { href = new URL(href, baseUrl).href; } catch (_) {}
      var lower = href.toLowerCase();
      if (/\/(?:privacy-policy|terms-conditions|sign|login|register)(?:\/|$)/i.test(lower)) return;
      if (!/hubdrive|hubcloud|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|id=|download|s3|fsl|gamerxyt/i.test(lower)) return;
      if (seen[href]) return;
      seen[href] = true;
      output.push(href);
    });
  });
  return output.slice(0, 12);
}

// Load content page and collect download links (and episodes for TV)
function loadContent(url) {
  return makeRequest(url).then(function (res) { return res.text(); }).then(function (html) {
    var $ = cheerio.load(html);
    var title = ($('h1.page-title').text() || '').split('(')[0].trim();
    var poster = $('meta[property="og:image"]').attr('content') || '';
    var tags = [];
    $('div.mt-2 span.badge').each(function (i, el) { tags.push($(el).text()); });
    var year = parseInt(($('div.mt-2 span').first().text() || '').replace(/[^0-9]/g, ''), 10) || null;
    var description = $('div.content-section p.mt-4').text().trim() || '';
    var trailer = $('#trailer-btn').attr('data-trailer-url') || '';
    var isMovie = tags.indexOf('Movies') !== -1;

    // V17/V18: keep only extractor-worthy URLs; navigation links never enter the queue.
    var hrefs = extractCandidateUrlsFromHtml(html, url);

    var content = { title: title, poster: poster, tags: tags, year: year, description: description, trailer: trailer, type: isMovie ? 'movie' : 'series' };
    if (isMovie) {
      content.downloadLinks = hrefs;
      return content;
    }

    // Series handling (best-effort; falls back to general links)
    var episodesMap = {};
    $('div.episodes-list div.season-item').each(function (i, seasonEl) {
      var $season = $(seasonEl);
      var seasonText = $season.find('div.episode-number').text() || '';
      var seasonMatch = seasonText.match(/S?([1-9][0-9]*)/);
      var seasonNum = seasonMatch ? parseInt(seasonMatch[1], 10) : null;
      $season.find('div.episode-download-item').each(function (j, epEl) {
        var $ep = $(epEl);
        var epText = $ep.find('div.episode-file-info span.badge-psa').text() || '';
        var epMatch = epText.match(/Episode-0*([1-9][0-9]*)/);
        var episodeNum = epMatch ? parseInt(epMatch[1], 10) : null;
        var epLinks = [];
        $ep.find('a').each(function (k, a) {
          var h = $(a).attr('href'); if (h && h.trim()) epLinks.push(h);
        });
        if (seasonNum && episodeNum && epLinks.length > 0) {
          var key = seasonNum + '-' + episodeNum;
          if (!episodesMap[key]) episodesMap[key] = { season: seasonNum, episode: episodeNum, downloadLinks: [] };
          episodesMap[key].downloadLinks = episodesMap[key].downloadLinks.concat(epLinks);
        }
      });
    });

    var episodes = Object.keys(episodesMap).map(function (k) {
      var ep = episodesMap[k];
      ep.downloadLinks = Array.from(new Set(ep.downloadLinks));
      return ep;
    });

    if (episodes.length === 0 && hrefs.length > 0) {
      content.episodes = [{ season: 1, episode: 1, downloadLinks: hrefs }];
    } else {
      content.episodes = episodes;
    }
    return content;
  });
}

// Extract HubCloud links -> [{name,title,url,quality}]
function extractHubCloudLinks(url, referer) {
  var origin;
  try { origin = new URL(url).origin; } catch (e) { origin = ''; }

  function toAbsolute(href, base) {
    try { return new URL(href, base).href; } catch (e) { return href; }
  }

  function resolveBuzzServer(buttonLink) {
    var baseOrigin = (function () { try { return new URL(buttonLink).origin; } catch (e) { return origin; } })();
    var dlUrl = buttonLink.replace(/\/?$/, '') + '/download';
    return fetch(dlUrl, { headers: { 'Referer': buttonLink, 'User-Agent': DEFAULT_HEADERS['User-Agent'] }, redirect: 'manual' })
      .then(function (res) {
        var hx = res.headers.get('hx-redirect') || res.headers.get('location');
        if (hx) return toAbsolute(hx, baseOrigin);
        // Fallback: if manual redirect unsupported, use final response URL
        return res.url || buttonLink;
      }).catch(function () { return buttonLink; });
  }

  function resolveTenGbps(initialLink, headerDetails, size, qualityLabel, quality) {
    var current = initialLink;
    var baseOrigin = (function () { try { return new URL(initialLink).origin; } catch (e) { return origin; } })();
    var maxHops = 6;
    function step() {
      return fetch(current, { redirect: 'manual', headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] } })
        .then(function (res) {
          var loc = res.headers.get('location');
          if (!loc) {
            // Try current as final
            return null;
          }
          if (loc.indexOf('id=') !== -1) {
            var linkParam = (loc.split('link=')[1] || '').trim();
            if (linkParam) {
              try { linkParam = decodeURIComponent(linkParam); } catch (e) { /* ignore */ }
              return linkParam;
            }
            return null;
          } else {
            current = toAbsolute(loc, baseOrigin);
            return step();
          }
        });
    }
    return step().then(function (finalUrl) {
      if (!finalUrl) return null;
      return getFilenameFromUrl(finalUrl).then(function (actualFilename) {
        var displayFilename = actualFilename || headerDetails || 'Unknown';
        var titleParts = [];
        if (displayFilename) titleParts.push(displayFilename);
        if (size) titleParts.push(size);
        var finalTitle = titleParts.join('\n');
        return { name: '4KHDHub - 10Gbps Server' + qualityLabel, title: finalTitle, url: finalUrl, quality: quality };
      }).catch(function () {
        var displayFilename = headerDetails || 'Unknown';
        var titleParts = [];
        if (displayFilename) titleParts.push(displayFilename);
        if (size) titleParts.push(size);
        var finalTitle = titleParts.join('\n');
        return { name: '4KHDHub - 10Gbps Server' + qualityLabel, title: finalTitle, url: finalUrl, quality: quality };
      });
    }).catch(function () { return null; });
  }

  return makeRequest(url).then(function (res) { return res.text(); }).then(function (html) {
    var $ = cheerio.load(html);
    var href = url;
    if (url.indexOf('hubcloud.php') === -1) {
      var rawHref = $('#download').attr('href') || $('a[href*="hubcloud.php"]').attr('href') || $('.download-btn').attr('href') || $('a[href*="download"]').attr('href');
      if (!rawHref) throw new Error('Download element not found');
      href = toAbsolute(rawHref, origin);
    }
    return makeRequest(href).then(function (res2) { return res2.text(); }).then(function (html2) {
      var $$ = cheerio.load(html2);

      function buildTask(buttonText, buttonLink, headerDetails, size, quality) {
        var qualityLabel = quality ? (' - ' + quality + 'p') : '';
        // Pixeldrain normalization
        var pd = buttonLink.match(/pixeldrain\.(?:net|dev)\/u\/([a-zA-Z0-9]+)/);
        if (pd && pd[1]) buttonLink = 'https://pixeldrain.net/api/file/' + pd[1];

        if (buttonText.indexOf('BuzzServer') !== -1) {
          return resolveBuzzServer(buttonLink).then(function (finalUrl) {
            return getFilenameFromUrl(finalUrl).then(function (actualFilename) {
              var displayFilename = actualFilename || headerDetails || 'Unknown';
              var titleParts = [];
              if (displayFilename) titleParts.push(displayFilename);
              if (size) titleParts.push(size);
              var finalTitle = titleParts.join('\n');
            return { name: '4KHDHub - BuzzServer' + qualityLabel, title: finalTitle, url: finalUrl, quality: quality, size: size || null, fileName: actualFilename || null };
            }).catch(function () {
              var displayFilename = headerDetails || 'Unknown';
              var titleParts = [];
              if (displayFilename) titleParts.push(displayFilename);
              if (size) titleParts.push(size);
              var finalTitle = titleParts.join('\n');
            return { name: '4KHDHub - BuzzServer' + qualityLabel, title: finalTitle, url: finalUrl, quality: quality, size: size || null, fileName: null };
            });
          }).catch(function () { return null; });
        }
        if (buttonText.indexOf('10Gbps') !== -1) {
          return resolveTenGbps(buttonLink, headerDetails, size, qualityLabel, quality);
        }
        return getFilenameFromUrl(buttonLink).then(function (actualFilename) {
          var displayFilename = actualFilename || headerDetails || 'Unknown';
          var titleParts = [];
          if (displayFilename) titleParts.push(displayFilename);
          if (size) titleParts.push(size);
          var finalTitle = titleParts.join('\n');
          var name;
          if (buttonText.indexOf('FSL Server') !== -1) name = '4KHDHub - FSL Server' + qualityLabel;
          else if (buttonText.indexOf('S3 Server') !== -1) name = '4KHDHub - S3 Server' + qualityLabel;
          else if (/pixeldra/i.test(buttonText) || /pixeldra/i.test(buttonLink)) name = '4KHDHub - Pixeldrain' + qualityLabel;
          else if (buttonText.indexOf('Download File') !== -1) name = '4KHDHub - HubCloud' + qualityLabel;
          else name = '4KHDHub - HubCloud' + qualityLabel;
        return { name: name, title: finalTitle, url: buttonLink, quality: quality, size: size || null, fileName: actualFilename || null };
        }).catch(function () {
          var displayFilename = headerDetails || 'Unknown';
          var titleParts = [];
          if (displayFilename) titleParts.push(displayFilename);
          if (size) titleParts.push(size);
          var finalTitle = titleParts.join('\n');
          var name = '4KHDHub - HubCloud' + qualityLabel;
        return { name: name, title: finalTitle, url: buttonLink, quality: quality, size: size || null, fileName: null };
        });
      }

      // Iterate per card to capture per-quality sections.
      // FOURK_MEMORY_SCOPE_GUARD_V1: collect plain values first; start async work only after DOM traversal.
      var taskSpecs = [];
      var cards = $$('.card');
      if (cards.length > 0) {
        cards.each(function (ci, card) {
          var $card = $$(card);
          var header = $card.find('div.card-header').text() || $$('div.card-header').first().text() || '';
          var size = $card.find('i#size').text() || $$('i#size').first().text() || '';
          var quality = getIndexQuality(header);
          var headerDetails = cleanTitle(header);
          var localBtns = $card.find('div.card-body h2 a.btn');
          if (localBtns.length === 0) localBtns = $card.find('a.btn, .btn, a[href]');
          localBtns.each(function (i, el) {
            var $btn = $$(el);
            var text = ($btn.text() || '').trim();
            var link = $btn.attr('href');
            if (!link) return;
            link = toAbsolute(link, href);
            // Only consider plausible buttons
            if (!/(hubcloud|hubdrive|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|download|api\/file)/i.test(link) && text.toLowerCase().indexOf('download') === -1) return;
            taskSpecs.push({ text: text, link: link, headerDetails: headerDetails, size: size, quality: quality });
          });
        });
      }

      // Fallback: whole page buttons. V17: never feed navigation/privacy/sign links into extractors.
      if (taskSpecs.length === 0) {
        var buttons = $$.root().find('div.card-body h2 a.btn');
        if (buttons.length === 0) {
          var altSelectors = ['a.btn', '.btn', 'a[href]'];
          for (var si = 0; si < altSelectors.length && buttons.length === 0; si++) {
            buttons = $$.root().find(altSelectors[si]);
          }
        }
        var size = $$('i#size').first().text() || '';
        var header = $$('div.card-header').first().text() || '';
        var quality = getIndexQuality(header);
        var headerDetails = cleanTitle(header);
        buttons.each(function (i, el) {
          var $btn = $$(el);
          var text = ($btn.text() || '').trim();
          var link = $btn.attr('href');
          if (!link) return;
          link = toAbsolute(link, href);
          var lowerLink = String(link || '').toLowerCase();
          var lowerText = String(text || '').toLowerCase();
          if (/\/(?:privacy-policy|terms-conditions|sign|login|register)(?:\/|$)/i.test(lowerLink)) return;
          if (lowerLink === String(origin || '').toLowerCase() + '/' || lowerLink === String(href || '').toLowerCase()) return;
          if (!/(hubcloud|hubdrive|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|download|api\/file|gamerxyt)/i.test(lowerLink) && lowerText.indexOf('download') === -1) return;
          taskSpecs.push({ text: text, link: link, headerDetails: headerDetails, size: size, quality: quality });
        });
      }

      if (taskSpecs.length === 0) return [];
      var boundedSpecs = taskSpecs.slice(0, 10);
      $ = null;
      $$ = null;
      return Promise.all(boundedSpecs.map(function(spec) {
        return buildTask(spec.text, spec.link, spec.headerDetails, spec.size, spec.quality);
      })).then(function (arr) { return (arr || []).filter(function (x) { return !!x; }); });
    });
  }).catch(function () { return []; });
}

// Extract HubDrive links (wrapper around HubCloud if needed)
function extractHubDriveLinks(url, referer) {
  return makeRequest(url).then(function (res) { return res.text(); }).then(function (html) {
    var $ = cheerio.load(html);
    var size = $('i#size').text() || '';
    var header = $('div.card-header').text() || '';
    var quality = getIndexQuality(header);
    var headerDetails = cleanTitle(header);
    var filename = (headerDetails || header || 'Unknown').replace(/^4kHDHub\.com\s*[-_]?\s*/i, '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ').trim();
    var primaryBtn = $('.btn.btn-primary.btn-user.btn-success1.m-1').attr('href') || $('a.btn.btn-primary').attr('href') || $('a[href*="download"]').attr('href') || $('a.btn').attr('href');
    if (!primaryBtn) return [];
    if ((primaryBtn || '').toLowerCase().indexOf('hubcloud') !== -1) {
      return extractHubCloudLinks(primaryBtn, '4KHDHub');
    }
    var qualityLabel = quality ? (' - ' + quality + 'p') : '';
    return getFilenameFromUrl(primaryBtn).then(function (actualFilename) {
      var displayFilename = actualFilename || filename || 'Unknown';
      var titleParts = [];
      if (displayFilename) titleParts.push(displayFilename);
      if (size) titleParts.push(size);
      var finalTitle = titleParts.join('\n');
      return [{ name: '4KHDHub - HubDrive' + qualityLabel, title: finalTitle, url: primaryBtn, quality: quality }];
    }).catch(function () {
      var displayFilename = filename || 'Unknown';
      var titleParts = [];
      if (displayFilename) titleParts.push(displayFilename);
      if (size) titleParts.push(size);
      var finalTitle = titleParts.join('\n');
      return [{ name: '4KHDHub - HubDrive' + qualityLabel, title: finalTitle, url: primaryBtn, quality: quality }];
    });
  }).catch(function () { return []; });
}

// Dispatcher for a single link to final streams
function processExtractorLink(link) {
  var lower = (link || '').toLowerCase();
  if (lower.indexOf('hubdrive') !== -1) {
    return extractHubDriveLinks(link, '4KHDHub');
  } else if (lower.indexOf('hubcloud') !== -1) {
    return extractHubCloudLinks(link, '4KHDHub');
  } else if (lower.indexOf('workers.dev') !== -1 || lower.indexOf('r2.dev') !== -1) {
    // Cloudflare Workers / R2 links – treat as HubCloud direct files
    return getFilenameFromUrl(link).then(function (actualFilename) {
      var displayFilename = actualFilename || 'HubCloud File';
      var titleParts = [];
      if (displayFilename) titleParts.push(displayFilename);
      var finalTitle = titleParts.join('\n');
      return [{ name: '4KHDHub - HubCloud - 1080p', title: finalTitle, url: link, quality: 1080, size: null, fileName: actualFilename || null }];
    }).catch(function () {
      return [{ name: '4KHDHub - HubCloud - 1080p', title: 'HubCloud File', url: link, quality: 1080, size: null, fileName: null }];
    });
  } else if (lower.indexOf('pixeldrain') !== -1) {
    // Normalize pixeldrain URLs to API endpoint
    var converted = link;
    var m = link.match(/pixeldrain\.(?:net|dev)\/u\/([a-zA-Z0-9]+)/);
    if (m && m[1]) converted = 'https://pixeldrain.net/api/file/' + m[1];
    return getFilenameFromUrl(converted).then(function (actualFilename) {
      var displayFilename = actualFilename || 'Pixeldrain File';
      var title = displayFilename + '\nPixeldrain';
      return [{ name: '4KHDHub - Pixeldrain - 1080p', title: title, url: converted, quality: 1080, size: null, fileName: actualFilename || null }];
    }).catch(function () {
      var title = 'Pixeldrain File\nPixeldrain';
      return [{ name: '4KHDHub - Pixeldrain - 1080p', title: title, url: converted, quality: 1080, size: null, fileName: null }];
    });
  } else if (/\.m(ov|p4|kv)$|\.avi$/i.test(link)) {
    // Direct video link
    var filename = (function () {
      try { return decodeFilename(new URL(link).pathname.split('/').pop().replace(/\.[^/.]+$/, '').replace(/[._]/g, ' ')); } catch (e) { return 'Direct Link'; }
    })();
    return getFilenameFromUrl(link).then(function (actualFilename) {
      var displayFilename = actualFilename || filename || 'Unknown';
      return [{ name: '4KHDHub Direct Link', title: displayFilename + '\n[Direct Link]', url: link, quality: 1080, size: null, fileName: actualFilename || null }];
    }).catch(function () {
      return [{ name: '4KHDHub Direct Link', title: filename + '\n[Direct Link]', url: link, quality: 1080, size: null, fileName: null }];
    });
  }
  return Promise.resolve([]);
}

// Convert a list of resolved hosting URLs to final stream entries
function extractStreamingLinks(downloadLinks) {
  var tasks = (downloadLinks || []).map(function (lnk) {
    return processExtractorLink(lnk).then(function (res) { return res || []; }).catch(function () { return []; });
  });
  return Promise.all(tasks).then(function (arrs) {
    var flat = [].concat.apply([], arrs).filter(function (x) { return x && x.url; });
    // Filter out .zip and suspicious AMP
    var suspicious = ['www-google-com.cdn.ampproject.org', 'bloggingvector.shop', 'cdn.ampproject.org'];
    flat = flat.filter(function (x) {
      var u = (x.url || '').toLowerCase();
      if (u.endsWith('.zip')) return false;
      return !suspicious.some(function (p) { return u.indexOf(p) !== -1; });
    });
    // Deduplicate by URL
    var seen = {};
    var unique = [];
    flat.forEach(function (x) { if (!seen[x.url]) { seen[x.url] = 1; unique.push(x); } });
    return unique;
  });
}

// TMDB helper
function getTMDBDetails(tmdbId, mediaType) {
  var url = 'https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&append_to_response=alternative_titles,translations,external_ids';
  return vueoSharedTmdb(url, function() {
    return makeRequest(url).then(function(res) { return res.json(); });
  }).then(function(data) {
    if (mediaType === 'movie') {
      return { title: data.title, originalTitle: data.original_title, year: data.release_date ? data.release_date.split('-')[0] : null, aliases: collectTmdbAliases(data, mediaType) };
    }
    return { title: data.name, originalTitle: data.original_name, year: data.first_air_date ? data.first_air_date.split('-')[0] : null, aliases: collectTmdbAliases(data, mediaType) };
  }).catch(function() { return null; });
}

// Main entry – Promise-based, no async/await
function getStreams(tmdbId, type, season, episode) {
  type = type || 'movie';
  var cacheKey = '4khdhub_resolved_urls_v1_' + tmdbId + '_' + type + (season ? ('_s' + season + 'e' + (episode || '')) : '');
  var disableValidation = ((typeof URL_VALIDATION_ENABLED !== 'undefined') && (URL_VALIDATION_ENABLED === false)) ||
                          ((typeof DISABLE_4KHDHUB_URL_VALIDATION !== 'undefined') && (DISABLE_4KHDHUB_URL_VALIDATION === true));

  function finalizeToStreams(links) {
    var tasks = links.map(function (link) { return disableValidation ? Promise.resolve(true) : validateVideoUrl(link.url); });
    return Promise.all(tasks).then(function (vals) {
      var validated = links.filter(function (l, idx) { return !!vals[idx]; });
      return validated.map(function (l) {
        return {
          name: l.name,
          title: l.title || l.name,
          url: l.url,
          quality: (l.quality ? (l.quality + 'p') : '1080p'),
          size: l.size || null,
          fileName: l.fileName || null,
          type: 'direct',
          behaviorHints: { bingeGroup: '4khdhub-streams' }
        };
      });
    });
  }

  var cached = resolvedUrlsCache[cacheKey];
  if (cached && cached.length > 0) {
    return extractStreamingLinks(cached).then(function (streams) { return finalizeToStreams(streams); });
  }

  var tmdbType = (type === 'series' ? 'tv' : type);
  return getTMDBDetails(tmdbId, tmdbType).then(function (tmdb) {
    if (!tmdb || !tmdb.title) return [];
    var queries = buildDiscoveryQueries4K(tmdb, tmdbType, season);
    function findCandidate(index) {
      if (index >= queries.length) return Promise.resolve(null);
      return searchContent(queries[index]).then(function(results) {
        var best = findBestMatch(results || [], tmdb, tmdbType, season);
        return best || findCandidate(index + 1);
      }).catch(function() { return findCandidate(index + 1); });
    }

    return findCandidate(0).then(function (best) {
      if (!best) return [];
      return loadContent(best.url).then(function (content) {
        var downloadLinks = [];
        if (type === 'movie') {
          downloadLinks = content.downloadLinks || [];
        } else if ((type === 'series' || type === 'tv') && season && episode) {
          var target = (content.episodes || []).find(function (ep) { return ep.season === parseInt(season, 10) && ep.episode === parseInt(episode, 10); });
          downloadLinks = target ? (target.downloadLinks || []) : [];
        }
        if (!downloadLinks || downloadLinks.length === 0) return [];

        downloadLinks = downloadLinks.filter(function(lnk) {
          var value = String(lnk || '').toLowerCase();
          if (!value) return false;
          if (/\/(?:privacy-policy|terms-conditions|sign|login|register)(?:\/|$)/i.test(value)) return false;
          return /hubcloud|hubdrive|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|download|id=|gamerxyt/i.test(value);
        }).slice(0, 10);
        vueoTrace("EXTRACT_QUEUE", { links: downloadLinks.length });
        if (!downloadLinks.length) return [];

        // Resolve redirect-style links to file hosts
        var resolverTasks = downloadLinks.map(function (lnk) {
          var needs = (lnk || '').toLowerCase().indexOf('id=') !== -1;
          if (needs) {
            return getRedirectLinks(lnk).then(function (r) { return r && r.trim() ? r : null; }).catch(function () { return null; });
          }
          return Promise.resolve(lnk);
        });

        return Promise.all(resolverTasks).then(function (resolvedArr) {
          var resolved = resolvedArr.filter(function (x) { return x && x.trim(); });
          if (resolved.length === 0) return [];
          resolvedUrlsCache[cacheKey] = resolved; // cache in-memory
          return extractStreamingLinks(resolved).then(function (links) { return finalizeToStreams(links); });
        });
      });
    });
  }).catch(function () { return []; });
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  // RN global
  // eslint-disable-next-line no-undef
  global.getStreams = getStreams;
}


