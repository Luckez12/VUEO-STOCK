// 4KHDHub Scraper for Nuvio Local Scrapers
// React Native compatible – no Node core modules, no async/await
// FOURK_MEMORY_SCOPE_GUARD_V1
// VUEO_PROVIDER_REPAIR_V16

const cheerio = require('cheerio-without-node-native');
console.log('[4KHDHub] Using cheerio-without-node-native for DOM parsing');

// Constants
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
const FALLBACK_4KHDHUB_URL = 'https://4khdhub.one';
const REQUEST_TIMEOUT_MS = 4500;
const PROVIDER_BUDGET_MS = 19000;
// VUEO_FAST_DISCOVERY_V1: parallel alias discovery + confidence gate before host extraction.
const RESOLVED_CACHE_MAX_ENTRIES = 8;

// Direct file validation is disabled by default for Nuvio latency.
const URL_VALIDATION_ENABLED = false;

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

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function vueoSharedTmdb(url, fallback) {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.vueoDiscoveryContext === "function"
  ) {
    return globalThis.vueoDiscoveryContext(url)
      .then(function(context) {
        if (context && context.tmdb) {
          if (typeof globalThis.vueoTrace === "function") {
            globalThis.vueoTrace("METADATA", {
              shared: true,
              title: context.title || "",
              year: context.year || "",
              imdbId: context.imdbId || "",
              aliases: Array.isArray(context.aliases) ? context.aliases.length : 0
            });
          }
          return context.tmdb;
        }
        throw new Error("Shared discovery context is empty");
      })
      .catch(function(error) {
        if (typeof globalThis.vueoTrace === "function") {
          globalThis.vueoTrace("METADATA_FALLBACK", {
            reason: error && error.message ? error.message : String(error)
          });
        }
        return fallback();
      });
  }
  return fallback();
}

function vueoCandidateTrace(stage, details) {
  try {
    if (
      typeof globalThis !== "undefined" &&
      typeof globalThis.vueoTrace === "function"
    ) {
      globalThis.vueoTrace(stage, details || {});
    }
  } catch (_) {}
}

function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(new Error((label || '4KHDHub request') + ' timed out'));
    }, Math.max(1, Number(timeoutMs || 1)));

    Promise.resolve(promise).then(
      function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      function (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function collectValuesBounded(factories, concurrency, timeoutMs) {
  var jobs = Array.isArray(factories) ? factories : [];
  if (!jobs.length) return Promise.resolve([]);

  var limit = Math.max(1, Number(concurrency || 1));

  return new Promise(function (resolve) {
    var output = [];
    var next = 0;
    var active = 0;
    var done = false;

    var timer = setTimeout(
      finish,
      Math.max(1, Number(timeoutMs || 1))
    );

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(output);
    }

    function pump() {
      if (done) return;

      if (next >= jobs.length && active === 0) {
        finish();
        return;
      }

      while (!done && active < limit && next < jobs.length) {
        var factory = jobs[next++];
        active += 1;

        Promise.resolve()
          .then(factory)
          .then(function (value) {
            if (!done && value !== undefined && value !== null) {
              output.push(value);
            }
          })
          .catch(function () {})
          .then(function () {
            active -= 1;
            pump();
          });
      }
    }

    pump();
  });
}

function flattenUniqueStreams(groups) {
  var seen = {};
  var output = [];

  (groups || []).forEach(function (group) {
    (Array.isArray(group) ? group : []).forEach(function (item) {
      if (!item || !item.url || seen[item.url]) return;
      seen[item.url] = true;
      output.push(item);
    });
  });

  return output;
}


/*
 * Keep only small plain JS values after parsing host HTML. Cheerio DOM trees can
 * be much larger than the source HTML in QuickJS. Returning descriptors from a
 * short synchronous parse lets the DOM become collectible before any nested
 * host/network extraction starts.
 */
function absoluteUrl(raw, base) {
  try { return new URL(raw, base).toString(); } catch (e) { return String(raw || ''); }
}

function rememberResolvedUrls(key, values) {
  resolvedUrlsCache[key] = values;
  var keys = Object.keys(resolvedUrlsCache);
  while (keys.length > RESOLVED_CACHE_MAX_ENTRIES) {
    delete resolvedUrlsCache[keys.shift()];
  }
}

function extractCandidateUrlsFromHtml(html, baseUrl) {
  var $ = cheerio.load(String(html || ''));
  var candidates = [];
  var seen = {};

  function add(raw) {
    var value = String(raw || '').trim();
    if (!value) return;
    value = absoluteUrl(value, baseUrl);

    if (!/^https?:\/\//i.test(value) || value === baseUrl || seen[value]) return;
    if (!/(hubcloud|hubdrive|hubcdn|hblinks|hdstream4u|hubstream|pixeldrain|workers\.dev|r2\.dev|buzz|10gbps|download|api\/file|\.(?:m3u8|mp4|m4v|mkv)(?:$|[?#]))/i.test(value)) return;

    seen[value] = true;
    candidates.push(value);
  }

  $('a[href]').each(function (i, anchor) {
    add($(anchor).attr('href'));
  });

  var regex = /https?:\/\/[^\s"'<>\\]+/gi;
  var normalized = String(html || '').replace(/\\\//g, '/');
  var match;
  while ((match = regex.exec(normalized))) add(match[0]);

  return candidates;
}

function extractHubCloudEntryHref(html, sourceUrl) {
  if (sourceUrl.indexOf('hubcloud.php') !== -1) return sourceUrl;
  var $ = cheerio.load(String(html || ''));
  var rawHref =
    $('#download').attr('href') ||
    $('a[href*="hubcloud.php"]').attr('href') ||
    $('.download-btn').attr('href') ||
    $('a[href*="download"]').attr('href');
  return rawHref ? absoluteUrl(rawHref, sourceUrl) : '';
}

function extractHubCloudTaskSpecs(html, pageUrl) {
  var $ = cheerio.load(String(html || ''));
  var specs = [];

  function addSpec(text, link, headerDetails, size, quality) {
    link = String(link || '').trim();
    if (!link) return;
    specs.push({
      text: String(text || '').trim(),
      link: absoluteUrl(link, pageUrl),
      headerDetails: headerDetails || '',
      size: size || '',
      quality: quality || 0
    });
  }

  var cards = $('.card');
  if (cards.length > 0) {
    cards.each(function (ci, card) {
      var $card = $(card);
      var header = $card.find('div.card-header').text() || $('div.card-header').first().text() || '';
      var size = $card.find('i#size').text() || $('i#size').first().text() || '';
      var quality = getIndexQuality(header);
      var headerDetails = cleanTitle(header);
      var localBtns = $card.find('div.card-body h2 a.btn');
      if (localBtns.length === 0) localBtns = $card.find('a.btn, .btn, a[href]');

      localBtns.each(function (i, el) {
        var $btn = $(el);
        var text = ($btn.text() || '').trim();
        var link = $btn.attr('href');
        if (!link) return;
        var absolute = absoluteUrl(link, pageUrl);
        if (!/(hubcloud|hubdrive|hubcdn|hblinks|hdstream4u|hubstream|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|download|api\/file)/i.test(absolute) && text.toLowerCase().indexOf('download') === -1) return;
        addSpec(text, absolute, headerDetails, size, quality);
      });
    });
  }

  if (specs.length === 0) {
    var buttons = $.root().find('div.card-body h2 a.btn');
    if (buttons.length === 0) {
      var altSelectors = ['a.btn', '.btn', 'a[href]'];
      for (var si = 0; si < altSelectors.length && buttons.length === 0; si++) {
        buttons = $.root().find(altSelectors[si]);
      }
    }
    var fallbackSize = $('i#size').first().text() || '';
    var fallbackHeader = $('div.card-header').first().text() || '';
    var fallbackQuality = getIndexQuality(fallbackHeader);
    var fallbackDetails = cleanTitle(fallbackHeader);
    buttons.each(function (i, el) {
      var $btn = $(el);
      addSpec(($btn.text() || '').trim(), $btn.attr('href'), fallbackDetails, fallbackSize, fallbackQuality);
    });
  }

  return specs;
}

// Helper: HTTP
function makeRequest(url, options = {}) {
  var requestOptions = {
    ...options,
    headers: {
      ...DEFAULT_HEADERS,
      ...(options.headers || {})
    }
  };

  var timeoutMs =
    Number(
      requestOptions.timeoutMs ||
      REQUEST_TIMEOUT_MS
    );

  delete requestOptions.timeoutMs;

  return withSoftTimeout(
    fetch(url, requestOptions).then(function (response) {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    }),
    timeoutMs,
    '4KHDHub HTTP'
  );
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


/* VUEO_TITLE_PROFILE_V1 */
function collectTmdbAliases4K(data) {
  var output = [];
  var seen = {};

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    output.push({ title: text, priority: priority || 0 });
  }

  add(data && (data.title || data.name), 100);
  add(data && (data.original_title || data.original_name), 95);

  var alt = data && data.alternative_titles;
  var items =
    alt && Array.isArray(alt.titles)
      ? alt.titles
      : alt && Array.isArray(alt.results)
        ? alt.results
        : [];

  items.forEach(function(item) {
    add(
      item && (item.title || item.name),
      80
    );
  });

  var translations =
    data &&
    data.translations &&
    Array.isArray(data.translations.translations)
      ? data.translations.translations
      : [];

  translations.forEach(function(item) {
    add(
      item &&
      item.data &&
      (
        item.data.title ||
        item.data.name
      ),
      item && item.iso_639_1 === "en" ? 86 : 68
    );
  });

  output.sort(function(a, b) {
    return b.priority - a.priority;
  });

  return output.map(function(item) {
    return item.title;
  }).slice(0, 10);
}

function best4KSimilarity(candidate, aliases) {
  var best = 0;
  (aliases || []).forEach(function(alias) {
    best = Math.max(
      best,
      calculateSimilarity(candidate, alias)
    );
  });
  return best;
}


/* VUEO_DISCOVERY_REBUILD_V1 */
function cleanDiscoveryTitle4K(value) {
  return normalizeTitle(
    String(value || '')
      .replace(/\[(?:[^\]]{0,120})\]/g, ' ')
      .replace(/\b(?:19|20)\d{2}\b/g, ' ')
      .replace(/\bs\d{1,2}(?:\s*[-–]\s*s\d{1,2})?\b/gi, ' ')
      .replace(/\b(?:ep|episode|e)\s*[-#:]?\s*\d{1,3}\b/gi, ' ')
      .replace(/\b(?:2160p|1080p|720p|480p|4k|fhd|uhd|hdr|dv|dovi|bluray|web[- ]?dl|hevc|h26[45]|10bit|dual language|dual audio|multi audios?|hindi|english|tamil|telugu|series|movies?)\b/gi, ' ')
  );
}

function bestDiscoverySimilarity4K(candidate, aliases) {
  var cleanCandidate =
    cleanDiscoveryTitle4K(candidate);

  var best = 0;

  (aliases || []).forEach(function(alias) {
    var cleanAlias =
      cleanDiscoveryTitle4K(alias);

    if (!cleanCandidate || !cleanAlias) {
      return;
    }

    if (cleanCandidate === cleanAlias) {
      best = Math.max(best, 1);
    } else if (
      cleanCandidate.indexOf(cleanAlias) !== -1 ||
      cleanAlias.indexOf(cleanCandidate) !== -1
    ) {
      best = Math.max(best, 0.92);
    } else {
      best = Math.max(
        best,
        calculateSimilarity(
          cleanCandidate,
          cleanAlias
        )
      );
    }
  });

  return best;
}

function buildDiscoveryQueries4K(
  tmdb,
  mediaType,
  season
) {
  var output = [];
  var seen = {};

  function add(value) {
    var text =
      String(value || '')
        .trim();

    var key =
      normalizeTitle(text);

    if (
      !text ||
      !key ||
      seen[key]
    ) {
      return;
    }

    seen[key] = true;
    output.push(text);
  }

  (tmdb.aliases || [
    tmdb.title,
    tmdb.original_title
  ])
    .slice(0, 8)
    .forEach(function(alias) {
      /*
       * Raw title comes first. The old provider always appended the TMDB
       * year, which can make WordPress/site search miss a title that is
       * indexed only by its base name.
       */
      add(alias);

      if (tmdb.year) {
        add(
          alias +
          ' ' +
          tmdb.year
        );
      }

      if (mediaType === 'tv') {
        add(
          alias +
          ' season ' +
          season
        );

        add(
          alias +
          ' s' +
          String(season)
            .padStart(2, '0')
        );
      }
    });

  return output.slice(0, 14);
}

function isConfident4KMatch(item, query, targetYear, aliases) {
  if (!item) return false;

  var expected =
    aliases && aliases.length
      ? aliases
      : [query];

  var similarity =
    bestDiscoverySimilarity4K(
      item.title || '',
      expected
    );

  if (similarity >= 0.44) {
    return true;
  }

  var yearMatch =
    String(
      item.year ||
      item.title ||
      ''
    ).match(/(19|20)\d{2}/);

  var itemYear =
    yearMatch
      ? Number(yearMatch[0])
      : 0;

  return Boolean(
    targetYear &&
    itemYear === Number(targetYear) &&
    similarity >= 0.30
  );
}

function findBestMatch(
  results,
  query,
  targetYear,
  mediaType,
  aliases,
  requestedSeason
) {
  if (!results || results.length === 0) {
    return null;
  }

  var expected =
    aliases && aliases.length
      ? aliases
      : [query];

  var scored =
    results
      .filter(function(item) {
        return isConfident4KMatch(
          item,
          query,
          targetYear,
          expected
        );
      })
      .map(function(item) {
        var rawTitle =
          String(
            item.title ||
            ''
          );

        var score =
          bestDiscoverySimilarity4K(
            rawTitle,
            expected
          ) * 100;

        var path =
          String(
            item.url ||
            ''
          ).toLowerCase();

        var resultType =
          path.indexOf('-movie-') !== -1
            ? 'movie'
            : path.indexOf('-series-') !== -1
              ? 'tv'
              : '';

        if (resultType) {
          score +=
            resultType === mediaType
              ? 28
              : -80;
        }

        var yearMatch =
          String(
            item.year ||
            rawTitle
          ).match(/(19|20)\d{2}/);

        var itemYear =
          yearMatch
            ? Number(yearMatch[0])
            : 0;

        if (
          targetYear &&
          itemYear
        ) {
          var diff =
            Math.abs(
              Number(targetYear) -
              itemYear
            );

          if (diff === 0) {
            score += 15;
          } else if (diff <= 1) {
            score += 4;
          } else if (diff >= 5) {
            score -= 10;
          }
        }

        if (
          mediaType === 'tv' &&
          requestedSeason
        ) {
          var explicitSeason =
            rawTitle.match(/\bseason\s*(\d{1,2})\b/i) ||
            rawTitle.match(/\bs(\d{1,2})\b/i);

          if (explicitSeason) {
            if (Number(explicitSeason[1]) === Number(requestedSeason)) {
              score += 25;
            } else {
              score -= 120;
            }
          }

          var exactSeason =
            new RegExp(
              '\\\\bS0*' +
              Number(requestedSeason) +
              '\\\\b',
              'i'
            );

          var rangeSeason =
            new RegExp(
              '\\\\bS0*1\\\\s*[-–]\\\\s*S0*' +
              Number(requestedSeason) +
              '\\\\b',
              'i'
            );

          if (
            exactSeason.test(rawTitle) ||
            rangeSeason.test(rawTitle)
          ) {
            score += 10;
          }
        }

        return {
          item: item,
          score: score
        };
      });

  scored.sort(function(a, b) {
    return b.score - a.score;
  });

  vueoCandidateTrace("CANDIDATE", {
    count: scored.length,
    title: scored.length ? scored[0].item.title : "",
    score: scored.length ? scored[0].score : 0
  });

  if (
    !scored.length ||
    scored[0].score < 44
  ) {
    return null;
  }

  console.log(
    '[4KHDHub] Discovery selected title="' +
    scored[0].item.title +
    '" score=' +
    scored[0].score.toFixed(1)
  );

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

  domainsInFlight = makeRequest(
    DOMAINS_URL,
    { timeoutMs: 2800 }
  )
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var value = data && String(data['4khdhub'] || '').trim();
      domainsCache = Object.assign({}, data || {}, {
        '4khdhub': value || FALLBACK_4KHDHUB_URL
      });
      return domainsCache;
    })
    .catch(function () {
      domainsCache = { '4khdhub': FALLBACK_4KHDHUB_URL };
      return domainsCache;
    })
    .then(function(value) {
      domainsInFlight = null;
      return value;
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

// Search content
function parse4KSearchCards(
  html,
  baseUrl
) {
  var $ =
    cheerio.load(
      html
    );

  var results = [];
  var seen = {};

  function add(
    title,
    href,
    poster,
    yearText
  ) {
    var cleanTitle =
      String(title || '')
        .replace(/\s+/g, ' ')
        .trim();

    var rawHref =
      String(href || '')
        .trim();

    if (
      !cleanTitle ||
      !rawHref
    ) {
      return;
    }

    var absoluteUrl =
      rawHref.indexOf('http') === 0
        ? rawHref
        : (
            baseUrl +
            (
              rawHref.indexOf('/') === 0
                ? ''
                : '/'
            ) +
            rawHref
          );

    if (
      seen[absoluteUrl] ||
      /\/(?:category|tag|author|page)\//i
        .test(absoluteUrl)
    ) {
      return;
    }

    seen[absoluteUrl] = true;

    results.push({
      title: cleanTitle,
      url: absoluteUrl,
      poster:
        String(
          poster ||
          ''
        ),
      year:
        String(
          yearText ||
          cleanTitle
        )
    });
  }

  /*
   * VUEO_DISCOVERY_REBUILD_V1
   * Current layout uses movie-card-title, while older mirrors have used
   * card-grid and generic post cards. Collect all supported layouts.
   */
  $('a[href]').each(function(i, el) {
    var anchor = $(el);
    var href =
      anchor.attr('href') ||
      '';

    var title =
      anchor
        .find('h3.movie-card-title')
        .text()
        .trim() ||
      anchor
        .find('h2,h3')
        .first()
        .text()
        .trim() ||
      anchor.attr('title') ||
      anchor
        .find('img')
        .attr('alt') ||
      '';

    var meta =
      anchor
        .find('p.movie-card-meta')
        .text()
        .trim() ||
      anchor
        .closest('article,li,div')
        .find('.movie-card-meta,.meta')
        .first()
        .text()
        .trim();

    if (
      title &&
      href &&
      (
        /-(?:series|movie)-\d+\/?$/i
          .test(href) ||
        /\/(?:series|movies?)\//i
          .test(href) ||
        anchor
          .find('h3.movie-card-title')
          .length
      )
    ) {
      add(
        title,
        href,
        anchor
          .find('img')
          .attr('src') ||
          '',
        meta
      );
    }
  });

  $('div.card-grid a').each(function(i, el) {
    var anchor =
      $(el);

    add(
      anchor
        .find('h3')
        .text()
        .trim(),
      anchor.attr('href'),
      anchor
        .find('img')
        .attr('src') ||
        '',
      anchor.text()
    );
  });

  return results;
}

function searchWordPress4K(query) {
  return getDomains().then(function(domains) {
    var baseUrl = domains && domains['4khdhub'] ? domains['4khdhub'] : FALLBACK_4KHDHUB_URL;
    var url = baseUrl + '/wp-json/wp/v2/search?per_page=20&type=post&search=' + encodeURIComponent(query);
    return makeRequest(url, { timeoutMs: 2400 })
      .then(function(res) { if (!res.ok) return []; return res.json(); })
      .then(function(items) {
        if (!Array.isArray(items)) return [];
        return items.map(function(item) {
          var title = String(item && item.title || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          var href = String(item && item.url || '').trim();
          if (!title || !href) return null;
          return { title: title, url: href, poster: '', year: title };
        }).filter(Boolean);
      })
      .catch(function() { return []; });
  });
}

function searchContent(query) {
  return getDomains()
    .then(function(domains) {
      var baseUrl =
        domains &&
        domains['4khdhub']
          ? domains['4khdhub']
          : FALLBACK_4KHDHUB_URL;

      var searchUrl =
        baseUrl +
        '/?s=' +
        encodeURIComponent(query);

      return makeRequest(
        searchUrl,
        {
          timeoutMs: 3200
        }
      )
        .then(function(res) {
          return res.text();
        })
        .then(function(html) {
          return parse4KSearchCards(
            html,
            baseUrl
          );
        });
    });
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

    // Collect all relevant links across multiple selectors (do not stop at first)
    var hrefsSet = new Set();
    var selectors = [
      'div.download-item a',
      '.download-item a',
      'a[href*="hubdrive"]',
      'a[href*="hubcloud"]',
      'a[href*="pixeldrain"]',
      'a[href*="buzz"]',
      'a[href*="10gbps"]',
      'a[href*="drive"]',
      'a.btn[href]',
      'a.btn',
      'a[href]'
    ];
    for (var s = 0; s < selectors.length; s++) {
      $(selectors[s]).each(function (i, el) {
        var h = ($(el).attr('href') || '').trim();
        if (!h) return;
        // Keep only plausible download/intermediate links
        var keep = /hubdrive|hubcloud|hubcdn|hblinks|hdstream4u|hubstream|pixeldrain|buzz|10gbps|workers\.dev|r2\.dev|id=|download|s3|fsl/i.test(h);
        if (keep) hrefsSet.add(h);
      });
    }
    var hrefs = Array.from(hrefsSet);

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

    if (Object.keys(episodesMap).length === 0) {
      $('div.download-item').each(function (i, block) {
        var $block = $(block);
        var match =
          $block.text().match(
            /\bS(\d{1,2})E(\d{1,3})\b/i
          );

        if (!match) return;

        var seasonNum =
          parseInt(match[1], 10);

        var episodeNum =
          parseInt(match[2], 10);

        if (!seasonNum || !episodeNum) return;

        var epLinks = [];

        $block.find('a[href]').each(function (j, anchor) {
          var href =
            ($(anchor).attr('href') || '').trim();

          if (href) epLinks.push(href);
        });

        if (!epLinks.length) return;

        var key =
          seasonNum + '-' + episodeNum;

        if (!episodesMap[key]) {
          episodesMap[key] = {
            season: seasonNum,
            episode: episodeNum,
            downloadLinks: []
          };
        }

        episodesMap[key].downloadLinks =
          episodesMap[key].downloadLinks.concat(
            epLinks
          );
      });
    }

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
    return absoluteUrl(href, base || origin);
  }

  function resolveBuzzServer(buttonLink) {
    var baseOrigin = (function () { try { return new URL(buttonLink).origin; } catch (e) { return origin; } })();
    var dlUrl = buttonLink.replace(/\/?$/, '') + '/download';
    return withSoftTimeout(
      fetch(dlUrl, { headers: { 'Referer': buttonLink, 'User-Agent': DEFAULT_HEADERS['User-Agent'] }, redirect: 'manual' }),
      3200,
      '4KHDHub Buzz redirect'
    ).then(function (res) {
      var hx = res.headers.get('hx-redirect') || res.headers.get('location');
      if (hx) return toAbsolute(hx, baseOrigin);
      return res.url || buttonLink;
    }).catch(function () { return buttonLink; });
  }

  function resolveTenGbps(initialLink, headerDetails, size, qualityLabel, quality) {
    var current = initialLink;
    var baseOrigin = (function () { try { return new URL(initialLink).origin; } catch (e) { return origin; } })();
    var maxHops = 6;

    function step(hop) {
      if (hop >= maxHops) return Promise.resolve(null);
      return withSoftTimeout(
        fetch(current, { redirect: 'manual', headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] } }),
        2600,
        '4KHDHub 10Gbps redirect'
      ).then(function (res) {
        var loc = res.headers.get('location');
        if (!loc) return null;
        if (loc.indexOf('id=') !== -1) {
          var linkParam = (loc.split('link=')[1] || '').trim();
          if (linkParam) {
            try { linkParam = decodeURIComponent(linkParam); } catch (e) {}
            return linkParam;
          }
          return null;
        }
        current = toAbsolute(loc, baseOrigin);
        return step(hop + 1);
      });
    }

    return step(0).then(function (finalUrl) {
      if (!finalUrl) return null;
      return getFilenameFromUrl(finalUrl).then(function (actualFilename) {
        var displayFilename = actualFilename || headerDetails || 'Unknown';
        var titleParts = [];
        if (displayFilename) titleParts.push(displayFilename);
        if (size) titleParts.push(size);
        return { name: '4KHDHub - 10Gbps Server' + qualityLabel, title: titleParts.join('\n'), url: finalUrl, quality: quality };
      }).catch(function () {
        var displayFilename = headerDetails || 'Unknown';
        var titleParts = [];
        if (displayFilename) titleParts.push(displayFilename);
        if (size) titleParts.push(size);
        return { name: '4KHDHub - 10Gbps Server' + qualityLabel, title: titleParts.join('\n'), url: finalUrl, quality: quality };
      });
    }).catch(function () { return null; });
  }

  function buildTask(buttonText, buttonLink, headerDetails, size, quality) {
    var qualityLabel = quality ? (' - ' + quality + 'p') : '';
    var pd = buttonLink.match(/pixeldrain\.(?:net|dev)\/u\/([a-zA-Z0-9]+)/);
    if (pd && pd[1]) buttonLink = 'https://pixeldrain.net/api/file/' + pd[1];

    if (buttonText.indexOf('BuzzServer') !== -1) {
      return resolveBuzzServer(buttonLink).then(function (finalUrl) {
        return getFilenameFromUrl(finalUrl).then(function (actualFilename) {
          var displayFilename = actualFilename || headerDetails || 'Unknown';
          var titleParts = [];
          if (displayFilename) titleParts.push(displayFilename);
          if (size) titleParts.push(size);
          return { name: '4KHDHub - BuzzServer' + qualityLabel, title: titleParts.join('\n'), url: finalUrl, quality: quality, size: size || null, fileName: actualFilename || null };
        }).catch(function () {
          var displayFilename = headerDetails || 'Unknown';
          var titleParts = [];
          if (displayFilename) titleParts.push(displayFilename);
          if (size) titleParts.push(size);
          return { name: '4KHDHub - BuzzServer' + qualityLabel, title: titleParts.join('\n'), url: finalUrl, quality: quality, size: size || null, fileName: null };
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
      var name;
      if (buttonText.indexOf('FSL Server') !== -1) name = '4KHDHub - FSL Server' + qualityLabel;
      else if (buttonText.indexOf('S3 Server') !== -1) name = '4KHDHub - S3 Server' + qualityLabel;
      else if (/pixeldra/i.test(buttonText) || /pixeldra/i.test(buttonLink)) name = '4KHDHub - Pixeldrain' + qualityLabel;
      else name = '4KHDHub - HubCloud' + qualityLabel;
      return { name: name, title: titleParts.join('\n'), url: buttonLink, quality: quality, size: size || null, fileName: actualFilename || null };
    }).catch(function () {
      var displayFilename = headerDetails || 'Unknown';
      var titleParts = [];
      if (displayFilename) titleParts.push(displayFilename);
      if (size) titleParts.push(size);
      return { name: '4KHDHub - HubCloud' + qualityLabel, title: titleParts.join('\n'), url: buttonLink, quality: quality, size: size || null, fileName: null };
    });
  }

  var href = url;

  return makeRequest(url)
    .then(function (res) { return res.text(); })
    .then(function (html) {
      href = extractHubCloudEntryHref(html, url);
      if (!href) throw new Error('Download element not found');
      return href;
    })
    .then(function (resolvedHref) {
      return makeRequest(resolvedHref)
        .then(function (res2) { return res2.text(); });
    })
    .then(function (html2) {
      return extractHubCloudTaskSpecs(html2, href);
    })
    .then(function (specs) {
      if (!specs.length) return [];
      return collectValuesBounded(
        specs.map(function (spec) {
          return function () {
            return buildTask(spec.text, spec.link, spec.headerDetails, spec.size, spec.quality);
          };
        }),
        3,
        7200
      ).then(function (arr) {
        return (arr || []).filter(function (x) { return !!x; });
      });
    })
    .catch(function () { return []; });
}

// Extract HubDrive links (wrapper around HubCloud if needed)
function extractHubDriveLinks(url, referer, depth) {
  return makeRequest(
    url,
    {
      headers: {
        'Referer': referer || FALLBACK_4KHDHUB_URL + '/'
      },
      timeoutMs: 4200
    }
  )
    .then(function (res) { return res.text(); })
    .then(function (html) {
      return extractCandidateUrlsFromHtml(html, url);
    })
    .then(function (candidates) {
      if (!candidates.length) return [];
      return collectValuesBounded(
        candidates.map(function (candidate) {
          return function () {
            return processExtractorLink(candidate, url, Number(depth || 0) + 1)
              .catch(function () { return []; });
          };
        }),
        3,
        7200
      ).then(flattenUniqueStreams);
    })
    .catch(function () { return []; });
}

function resolvePotentialMediaUrl(url, referer, label) {
  return makeRequest(
    url,
    {
      redirect: 'follow',
      headers: {
        'Referer':
          referer || FALLBACK_4KHDHUB_URL + '/',
        'Range': 'bytes=0-1'
      },
      timeoutMs: 3200
    }
  )
    .then(function (response) {
      var finalUrl =
        response.url || url;

      var contentType =
        String(
          response.headers &&
          response.headers.get &&
          response.headers.get('content-type') ||
          ''
        ).toLowerCase();

      var playable =
        /\.(?:m3u8|mp4|m4v|mkv)(?:$|[?#])/i.test(finalUrl) ||
        contentType.indexOf('video/') === 0 ||
        contentType.indexOf('application/octet-stream') !== -1 ||
        contentType.indexOf('application/vnd.apple.mpegurl') !== -1;

      if (!playable) return [];

      return [{
        name: '4KHDHub - ' + (label || 'Direct'),
        title: label || '4KHDHub Direct',
        url: finalUrl,
        quality: getIndexQuality(finalUrl),
        headers: {
          'User-Agent': DEFAULT_HEADERS['User-Agent'],
          'Referer':
            referer || FALLBACK_4KHDHUB_URL + '/'
        }
      }];
    })
    .catch(function () {
      return [];
    });
}

function extractIntermediateLinks(url, referer, depth) {
  var currentDepth = Number(depth || 0);
  if (currentDepth >= 2) return Promise.resolve([]);

  return makeRequest(
    url,
    {
      headers: {
        'Referer': referer || FALLBACK_4KHDHUB_URL + '/'
      },
      timeoutMs: 3800
    }
  )
    .then(function (response) {
      var finalUrl = response.url || url;
      var contentType = String(
        response.headers && response.headers.get && response.headers.get('content-type') || ''
      ).toLowerCase();

      if (
        /\.(?:m3u8|mp4|m4v|mkv)(?:$|[?#])/i.test(finalUrl) ||
        contentType.indexOf('video/') === 0 ||
        contentType.indexOf('application/octet-stream') !== -1
      ) {
        return {
          streams: [{
            name: '4KHDHub Direct Link',
            title: 'Direct',
            url: finalUrl,
            quality: getIndexQuality(finalUrl),
            headers: {
              'User-Agent': DEFAULT_HEADERS['User-Agent'],
              'Referer': referer || url
            }
          }]
        };
      }

      return response.text().then(function (html) {
        return {
          finalUrl: finalUrl,
          candidates: extractCandidateUrlsFromHtml(html, finalUrl)
        };
      });
    })
    .then(function (state) {
      if (state.streams) return state.streams;
      var candidates = state.candidates || [];
      if (!candidates.length) return [];

      return collectValuesBounded(
        candidates.map(function (candidate) {
          return function () {
            return processExtractorLink(candidate, state.finalUrl, currentDepth + 1)
              .catch(function () { return []; });
          };
        }),
        3,
        6500
      ).then(flattenUniqueStreams);
    })
    .catch(function () { return []; });
}

// Dispatcher for a single link to final streams
function processExtractorLink(
  link,
  referer,
  depth
) {
  var lower =
    String(link || '').toLowerCase();

  var currentDepth =
    Number(depth || 0);

  if (lower.indexOf('hubdrive') !== -1) {
    return extractHubDriveLinks(
      link,
      referer || FALLBACK_4KHDHUB_URL + '/',
      currentDepth
    );
  }

  if (lower.indexOf('hubcloud') !== -1) {
    return extractHubCloudLinks(
      link,
      referer || '4KHDHub'
    ).then(function (items) {
      return (items || []).map(function (item) {
        item.headers =
          item.headers || {
            'User-Agent': DEFAULT_HEADERS['User-Agent'],
            'Referer': link
          };
        return item;
      });
    });
  }

  if (
    lower.indexOf('hubcdn.fans') !== -1 ||
    lower.indexOf('hubcdn') !== -1
  ) {
    return resolvePotentialMediaUrl(
      link,
      referer,
      'HubCDN'
    ).then(function (items) {
      if (items.length) return items;

      return extractIntermediateLinks(
        link,
        referer,
        currentDepth
      );
    });
  }

  if (
    lower.indexOf('hblinks') !== -1 ||
    lower.indexOf('hdstream4u') !== -1 ||
    lower.indexOf('hubstream') !== -1
  ) {
    return extractIntermediateLinks(
      link,
      referer,
      currentDepth
    );
  }

  if (
    lower.indexOf('workers.dev') !== -1 ||
    lower.indexOf('r2.dev') !== -1
  ) {
    return getFilenameFromUrl(link)
      .then(function (actualFilename) {
        var displayFilename =
          actualFilename || 'HubCloud File';

        return [{
          name: '4KHDHub - HubCloud - 1080p',
          title: displayFilename,
          url: link,
          quality: 1080,
          size: null,
          fileName: actualFilename || null,
          headers: {
            'User-Agent': DEFAULT_HEADERS['User-Agent'],
            'Referer':
              referer || FALLBACK_4KHDHUB_URL + '/'
          }
        }];
      })
      .catch(function () {
        return [{
          name: '4KHDHub - HubCloud - 1080p',
          title: 'HubCloud File',
          url: link,
          quality: 1080,
          size: null,
          fileName: null,
          headers: {
            'User-Agent': DEFAULT_HEADERS['User-Agent'],
            'Referer':
              referer || FALLBACK_4KHDHUB_URL + '/'
          }
        }];
      });
  }

  if (lower.indexOf('pixeldrain') !== -1) {
    var converted = link;
    var m =
      link.match(
        /pixeldrain\.(?:net|dev)\/u\/([a-zA-Z0-9]+)/
      );

    if (m && m[1]) {
      converted =
        'https://pixeldrain.net/api/file/' +
        m[1];
    }

    return getFilenameFromUrl(converted)
      .then(function (actualFilename) {
        var displayFilename =
          actualFilename || 'Pixeldrain File';

        return [{
          name: '4KHDHub - Pixeldrain - 1080p',
          title:
            displayFilename +
            '\nPixeldrain',
          url: converted,
          quality: 1080,
          size: null,
          fileName:
            actualFilename || null,
          headers: {
            'User-Agent': DEFAULT_HEADERS['User-Agent'],
            'Referer':
              referer || FALLBACK_4KHDHUB_URL + '/'
          }
        }];
      })
      .catch(function () {
        return [{
          name: '4KHDHub - Pixeldrain - 1080p',
          title: 'Pixeldrain File\nPixeldrain',
          url: converted,
          quality: 1080,
          size: null,
          fileName: null,
          headers: {
            'User-Agent': DEFAULT_HEADERS['User-Agent'],
            'Referer':
              referer || FALLBACK_4KHDHUB_URL + '/'
          }
        }];
      });
  }

  if (
    /\.(?:m3u8|mp4|m4v|mkv|avi)(?:$|[?#])/i.test(link)
  ) {
    var filename =
      (function () {
        try {
          return decodeFilename(
            new URL(link)
              .pathname
              .split('/')
              .pop()
              .replace(/\.[^/.]+$/, '')
              .replace(/[._]/g, ' ')
          );
        } catch (e) {
          return 'Direct Link';
        }
      })();

    return getFilenameFromUrl(link)
      .then(function (actualFilename) {
        var displayFilename =
          actualFilename ||
          filename ||
          'Unknown';

        return [{
          name: '4KHDHub Direct Link',
          title:
            displayFilename +
            '\n[Direct Link]',
          url: link,
          quality:
            getIndexQuality(link),
          size: null,
          fileName:
            actualFilename || null,
          headers: {
            'User-Agent': DEFAULT_HEADERS['User-Agent'],
            'Referer':
              referer || FALLBACK_4KHDHUB_URL + '/'
          }
        }];
      })
      .catch(function () {
        return [{
          name: '4KHDHub Direct Link',
          title:
            filename +
            '\n[Direct Link]',
          url: link,
          quality:
            getIndexQuality(link),
          size: null,
          fileName: null,
          headers: {
            'User-Agent': DEFAULT_HEADERS['User-Agent'],
            'Referer':
              referer || FALLBACK_4KHDHUB_URL + '/'
          }
        }];
      });
  }

  if (currentDepth < 2) {
    return extractIntermediateLinks(
      link,
      referer,
      currentDepth
    );
  }

  return Promise.resolve([]);
}

// Convert a list of resolved hosting URLs to final stream entries
function extractStreamingLinks(
  downloadLinks
) {
  return collectValuesBounded(
    (downloadLinks || []).map(function (lnk) {
      return function () {
        return processExtractorLink(
          lnk,
          FALLBACK_4KHDHUB_URL + '/',
          0
        ).catch(function () {
          return [];
        });
      };
    }),
    4,
    10500
  ).then(function (groups) {
    var flat =
      flattenUniqueStreams(groups);

    var suspicious = [
      'www-google-com.cdn.ampproject.org',
      'bloggingvector.shop',
      'cdn.ampproject.org'
    ];

    return flat.filter(function (item) {
      var value =
        String(item.url || '').toLowerCase();

      if (value.endsWith('.zip')) {
        return false;
      }

      return !suspicious.some(
        function (pattern) {
          return value.indexOf(pattern) !== -1;
        }
      );
    });
  });
}

// TMDB helper
function getTMDBDetails(tmdbId, mediaType) {
  var url =
    'https://api.themoviedb.org/3/' +
    mediaType +
    '/' +
    tmdbId +
    '?api_key=' +
    TMDB_API_KEY +
    '&append_to_response=alternative_titles,translations,external_ids';

  return vueoSharedTmdb(
    url,
    function() {
      return makeRequest(url)
        .then(function(res) {
          return res.json();
        });
    }
  )
    .then(function(data) {
      return {
        title:
          mediaType === 'movie'
            ? data.title
            : data.name,
        original_title:
          mediaType === 'movie'
            ? data.original_title
            : data.original_name,
        year:
          (
            mediaType === 'movie'
              ? data.release_date
              : data.first_air_date
          )
            ? (
                mediaType === 'movie'
                  ? data.release_date
                  : data.first_air_date
              ).split('-')[0]
            : null,
        aliases:
          collectTmdbAliases4K(data)
      };
    })
    .catch(function() {
      return null;
    });
}

// Main entry – Promise-based, no async/await
function getStreams(
  tmdbId,
  type,
  season,
  episode
) {
  type =
    type === 'movie'
      ? 'movie'
      : 'tv';

  var requestedSeason =
    Math.max(
      1,
      parseInt(season || 1, 10)
    );

  var requestedEpisode =
    Math.max(
      1,
      parseInt(episode || 1, 10)
    );

  var cacheKey =
    '4khdhub_resolved_urls_v2_' +
    tmdbId +
    '_' +
    type +
    (
      type === 'tv'
        ? '_s' +
          requestedSeason +
          'e' +
          requestedEpisode
        : ''
    );

  var disableValidation =
    URL_VALIDATION_ENABLED === false;

  function finalizeToStreams(links) {
    var input =
      Array.isArray(links)
        ? links
        : [];

    var validationFactories =
      input.map(function (link) {
        return function () {
          if (disableValidation) {
            return Promise.resolve({
              link: link,
              ok: true
            });
          }

          return validateVideoUrl(
            link.url
          ).then(function (ok) {
            return {
              link: link,
              ok: ok
            };
          });
        };
      });

    return collectValuesBounded(
      validationFactories,
      4,
      4800
    ).then(function (results) {
      return results
        .filter(function (entry) {
          return entry && entry.ok && entry.link;
        })
        .map(function (entry) {
          var link =
            entry.link;

          var qualityNumber =
            Number(link.quality || 0);

          return {
            name:
              link.name ||
              '4KHDHub',
            title:
              link.title ||
              link.name ||
              '4KHDHub',
            url: link.url,
            quality:
              qualityNumber
                ? qualityNumber + 'p'
                : 'Auto',
            size:
              link.size || null,
            fileName:
              link.fileName || null,
            type: 'direct',
            headers:
              Object.assign(
                {
                  'User-Agent':
                    DEFAULT_HEADERS['User-Agent']
                },
                link.headers || {}
              ),
            behaviorHints: {
              bingeGroup:
                '4khdhub-streams'
            }
          };
        });
    });
  }

  var cached =
    resolvedUrlsCache[cacheKey];

  if (cached && cached.length > 0) {
    return withSoftTimeout(
      extractStreamingLinks(cached)
        .then(finalizeToStreams),
      PROVIDER_BUDGET_MS,
      '4KHDHub cached provider'
    ).catch(function () {
      return [];
    });
  }

  var work =
    getTMDBDetails(
      tmdbId,
      type
    ).then(function (tmdb) {
      if (!tmdb || !tmdb.title) {
        return [];
      }

      var queries =
        buildDiscoveryQueries4K(
          tmdb,
          type,
          requestedSeason
        );

      console.log(
        '[4KHDHub] Discovery queries=' +
        queries.length +
        ' primary="' +
        String(
          queries[0] ||
          ''
        ) +
        '"'
      );

      var primary = queries[0] || tmdb.title;
      return Promise.all([
        searchWordPress4K(primary),
        searchContent(primary).catch(function() { return []; })
      ]).then(function(primaryGroups) {
        var primaryResults = [];
        var primarySeen = {};
        primaryGroups.forEach(function(group) {
          (Array.isArray(group) ? group : []).forEach(function(item) {
            if (!item || !item.url || primarySeen[item.url]) return;
            primarySeen[item.url] = true;
            primaryResults.push(item);
          });
        });
        var primaryBest = findBestMatch(primaryResults, tmdb.title, tmdb.year, type, tmdb.aliases, requestedSeason);
        if (primaryBest) return [[primaryBest]];

        return collectValuesBounded(
          queries.slice(1, 6).map(function (query) {
            return function () {
              return searchContent(query).catch(function () { return []; });
            };
          }),
          3,
          5200
        );
      }).then(function (groups) {
        var resultSeen = {};
        var results = [];

        groups.forEach(function (group) {
          (Array.isArray(group) ? group : [])
            .forEach(function (item) {
              if (
                !item ||
                !item.url ||
                resultSeen[item.url]
              ) {
                return;
              }

              resultSeen[item.url] = true;
              results.push(item);
            });
        });

        if (!results.length) {
          return [];
        }

        var best =
          findBestMatch(
            results,
            tmdb.title,
            tmdb.year,
            type,
            tmdb.aliases,
            requestedSeason
          );

        if (!best) {
          console.log('[4KHDHub] no title-confident search result; skipping host extraction');
          return [];
        }

        return loadContent(
          best.url
        ).then(function (content) {
          /*
           * Reject an obvious movie/series mismatch instead of silently
           * playing a same-name title of the wrong media type.
           */
          if (
            content &&
            content.type &&
            (
              (
                type === 'movie' &&
                content.type !== 'movie'
              ) ||
              (
                type === 'tv' &&
                content.type === 'movie'
              )
            )
          ) {
            return [];
          }

          var downloadLinks = [];

          if (type === 'movie') {
            downloadLinks =
              content.downloadLinks || [];
          } else {
            var target =
              (content.episodes || [])
                .find(function (ep) {
                  return (
                    ep.season === requestedSeason &&
                    ep.episode === requestedEpisode
                  );
                });

            downloadLinks =
              target
                ? target.downloadLinks || []
                : [];
          }

          downloadLinks =
            Array.from(
              new Set(
                (downloadLinks || [])
                  .map(function (value) {
                    return String(value || '').trim();
                  })
                  .filter(Boolean)
              )
            );

          if (!downloadLinks.length) {
            return [];
          }

          return collectValuesBounded(
            downloadLinks.map(function (lnk) {
              return function () {
                var needs =
                  String(lnk)
                    .toLowerCase()
                    .indexOf('id=') !== -1;

                if (!needs) {
                  return Promise.resolve(lnk);
                }

                return getRedirectLinks(
                  lnk
                )
                  .then(function (resolved) {
                    return (
                      resolved &&
                      resolved.trim()
                        ? resolved.trim()
                        : null
                    );
                  })
                  .catch(function () {
                    return null;
                  });
              };
            }),
            4,
            6500
          ).then(function (resolvedArr) {
            var resolved =
              resolvedArr
                .filter(function (value) {
                  return (
                    value &&
                    String(value).trim()
                  );
                });

            if (!resolved.length) {
              return [];
            }

            resolved =
              Array.from(
                new Set(resolved)
              );

            rememberResolvedUrls(
              cacheKey,
              resolved
            );

            return extractStreamingLinks(
              resolved
            ).then(finalizeToStreams);
          });
        });
      });
    });

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    '4KHDHub provider'
  ).catch(function (error) {
    console.log(
      '[4KHDHub] ' +
      (
        error &&
        error.message
          ? error.message
          : String(error)
      )
    );

    return [];
  });
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  // RN global
  // eslint-disable-next-line no-undef
  global.getStreams = getStreams;
}


