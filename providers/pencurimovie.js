"use strict";

var PROVIDER_NAME = "PencuriMovie";
var FALLBACK_BASE_URL = "https://ww21.pencurimovie.sbs";
var DOMAIN_CONFIG_URL = "https://raw.githubusercontent.com/Asm0d3usX/CloudX/builds/Website.json";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ms;q=0.8,id;q=0.7"
};

var cachedBaseUrl = null;
var cachedBaseUrlPromise = null;

function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function(resolve, reject) {
    var settled = false;
    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      reject(new Error((label || "Request") + " timed out"));
    }, timeoutMs);

    Promise.resolve(promise).then(
      function(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      function(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function requestText(url, headers, timeoutMs) {
  var request = fetch(url, {
    method: "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow"
  }).then(function(response) {
    if (response && response.ok === false) {
      throw new Error("HTTP " + response.status + " for " + url);
    }
    return Promise.resolve(response.text()).then(function(text) {
      return {
        text: String(text || ""),
        url: String(response && response.url || url)
      };
    });
  });

  var requestLabel = "PencuriMovie request";
  try {
    var parsedLabel = new URL(url);
    requestLabel += " " + parsedLabel.hostname + parsedLabel.pathname + parsedLabel.search;
  } catch (_) {}
  return withSoftTimeout(request, timeoutMs || 2200, requestLabel);
}

function requestJson(url, headers, timeoutMs) {
  return requestText(url, headers, timeoutMs).then(function(result) {
    try {
      return JSON.parse(result.text);
    } catch (_) {
      throw new Error("Invalid JSON from " + url);
    }
  });
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function safeUrl(value, base) {
  var raw = decodeHtml(String(value || "").trim());
  if (!raw) return "";
  if (raw.indexOf("//") === 0) raw = "https:" + raw;
  try {
    return new URL(raw, base || FALLBACK_BASE_URL).toString();
  } catch (_) {
    return raw;
  }
}

function updateBaseFromUrl(url) {
  try {
    var parsed = new URL(url);
    if (parsed && parsed.origin && parsed.hostname.indexOf("pencurimovie") !== -1) {
      cachedBaseUrl = trimSlash(parsed.origin);
    }
  } catch (_) {}
}

function getBaseUrl() {
  if (cachedBaseUrl) return Promise.resolve(cachedBaseUrl);

  /*
   * Fast path: use the currently verified live domain immediately.
   * Do not make every provider run depend on GitHub Website.json.
   */
  cachedBaseUrl = FALLBACK_BASE_URL;
  return Promise.resolve(cachedBaseUrl);
}

function refreshBaseUrl() {
  if (cachedBaseUrlPromise) return cachedBaseUrlPromise;

  cachedBaseUrlPromise = requestJson(DOMAIN_CONFIG_URL, {}, 900)
    .then(function(data) {
      var values = data && data.pencurimovie;
      var first = Array.isArray(values) ? values[0] : values;
      var resolved = trimSlash(first);
      if (!resolved || resolved.indexOf("http") !== 0) {
        throw new Error("PencuriMovie domain config is empty");
      }
      cachedBaseUrl = resolved;
      return cachedBaseUrl;
    })
    .catch(function() {
      return cachedBaseUrl || FALLBACK_BASE_URL;
    })
    .then(function(value) {
      cachedBaseUrlPromise = null;
      return value;
    });

  return cachedBaseUrlPromise;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&#(\d+);/g, function(_, num) {
      var code = Number(num);
      return isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getAttr(tag, name) {
  var pattern = new RegExp(
    "\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "\\s*=\\s*([\"'])([\\s\\S]*?)\\1",
    "i"
  );
  var match = String(tag || "").match(pattern);
  if (match) return decodeHtml(match[2]);

  pattern = new RegExp(
    "\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "\\s*=\\s*([^\\s>]+)",
    "i"
  );
  match = String(tag || "").match(pattern);
  return match ? decodeHtml(match[1]) : "";
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\[[^\]]*(?:dub|sub)[^\]]*\]/g, " ")
    .replace(/\b(?:malay\s*dub(?:bed)?|sub\s*indo|indo\s*sub|english\s*sub)\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(candidate, expected) {
  var left = normalizeTitle(candidate);
  var right = normalizeTitle(expected);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.indexOf(right) !== -1 || right.indexOf(left) !== -1) return 82;

  var a = left.split(" ").filter(function(word) { return word.length > 1; });
  var b = right.split(" ").filter(function(word) { return word.length > 1; });
  var set = {};
  a.forEach(function(word) { set[word] = true; });

  var matched = b.filter(function(word) { return set[word]; }).length;
  if (!matched) return 0;

  var recall = matched / Math.max(b.length, 1);
  var precision = matched / Math.max(a.length, 1);
  return Math.round((recall * 0.72 + precision * 0.28) * 72);
}

function yearFrom(value) {
  var match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function getTmdbInfo(tmdbId, mediaType) {
  var endpoint = mediaType === "movie" ? "movie" : "tv";
  var url =
    "https://api.themoviedb.org/3/" + endpoint + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY;

  return requestJson(url, { "Accept": "application/json" }, 1400).then(function(data) {
    return {
      tmdbId: String(tmdbId),
      title: String(data && (data.title || data.name) || ""),
      originalTitle: String(data && (data.original_title || data.original_name) || ""),
      year: String(data && (data.release_date || data.first_air_date) || "").split("-")[0]
    };
  });
}

function parseSearchResults(html, baseUrl) {
  var results = [];
  var seen = {};

  function addFromBlock(block) {
    var anchorMatch = String(block || "").match(/<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>/i);
    if (!anchorMatch) return;

    var tag = anchorMatch[0];
    var href = safeUrl(getAttr(tag, "href"), baseUrl);
    if (!href || seen[href]) return;

    var title = getAttr(tag, "oldtitle") || getAttr(tag, "title");
    if (title) title = title.split("(")[0].trim();

    if (!title) {
      var h2 = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
      title = h2 ? stripTags(h2[1]) : "";
    }

    if (!title) return;

    var rawYear = yearFrom(getAttr(tag, "oldtitle")) || yearFrom(block);
    var isSeries =
      /mli-eps/i.test(block) ||
      /\/series(?:\/|$)/i.test(href) ||
      /tvseason/i.test(block);

    seen[href] = true;
    results.push({
      title: title,
      href: href,
      year: rawYear,
      isSeries: isSeries
    });
  }

  var cardRegex =
    /<div\b[^>]*class\s*=\s*(["'])[^"']*\bml-item\b[^"']*\1[^>]*>([\s\S]*?)(?=<div\b[^>]*class\s*=\s*(["'])[^"']*\bml-item\b[^"']*\3[^>]*>|$)/gi;
  var card;
  while ((card = cardRegex.exec(html))) {
    addFromBlock(card[0]);
  }

  if (!results.length) {
    var anchorRegex = /<a\b[^>]*(?:oldtitle|title)\s*=\s*(["'])[\s\S]*?\1[^>]*>/gi;
    var anchor;
    while ((anchor = anchorRegex.exec(html))) {
      addFromBlock(anchor[0]);
    }
  }

  return results;
}

function scoreCandidate(item, info, mediaType) {
  var score = Math.max(
    titleScore(item.title, info.title),
    titleScore(item.title, info.originalTitle)
  );

  if (info.year && item.year && info.year === item.year) score += 28;
  if (mediaType === "tv" && item.isSeries) score += 24;
  if (mediaType === "movie" && !item.isSeries) score += 18;
  if (mediaType === "tv" && !item.isSeries) score -= 24;

  return score;
}


function slugifyTitle(value) {
  var text = String(value || "");

  try {
    if (typeof text.normalize === "function") {
      text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    }
  } catch (_) {}

  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function extractPageIdentity(html) {
  var source = String(html || "");
  var title = "";

  var heading = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!heading) heading = source.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  if (!heading) heading = source.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
  if (heading) title = stripTags(heading[1]);

  if (!title) {
    var og = source.match(
      /<meta\b[^>]*property\s*=\s*(["'])og:title\1[^>]*content\s*=\s*(["'])([\s\S]*?)\2[^>]*>/i
    );
    if (og) title = decodeHtml(og[3]);
  }

  var original = source.match(/Original\s+title\s*:\s*([^<\r\n]+)/i);

  return {
    title: String(title || "").replace(/\s*[-|]\s*pencuri.*$/i, "").trim(),
    year: yearFrom(original ? stripTags(original[1]) : title)
  };
}

function isDirectPencuriMatch(result, info, mediaType) {
  if (!result || !result.text) return false;

  var body = String(result.text || "");
  var finalUrl = String(result.url || "");
  var lower = finalUrl.toLowerCase();

  if (
    body.length < 300 ||
    /(?:page not found|404 not found|nothing found)/i.test(body)
  ) {
    return false;
  }

  if (mediaType === "tv" && lower.indexOf("/series/") === -1) return false;
  if (mediaType === "movie" && lower.indexOf("/series/") !== -1) return false;

  var slug = slugifyTitle(info.title);
  var pathSlug = "";
  try {
    var parts = new URL(finalUrl).pathname.split("/").filter(Boolean);
    pathSlug = parts.length ? parts[parts.length - 1] : "";
  } catch (_) {}

  if (slug && pathSlug.indexOf(slug) === 0) return true;

  var identity = extractPageIdentity(body);
  var score = Math.max(
    titleScore(identity.title, info.title),
    titleScore(identity.title, info.originalTitle)
  );

  if (score < 52) return false;
  if (info.year && identity.year && String(info.year) !== String(identity.year)) {
    return false;
  }

  return true;
}

function buildPencuriDirectCandidates(baseUrl, info, mediaType) {
  var titles = [info.title];
  if (
    info.originalTitle &&
    normalizeTitle(info.originalTitle) !== normalizeTitle(info.title)
  ) {
    titles.push(info.originalTitle);
  }

  var output = [];
  var seen = Object.create(null);

  titles.forEach(function(title) {
    var slug = slugifyTitle(title);
    if (!slug) return;

    var paths;
    if (mediaType === "movie") {
      paths = info.year
        ? ["/" + slug + "-" + info.year + "/", "/" + slug + "/"]
        : ["/" + slug + "/"];
    } else {
      paths = info.year
        ? [
            "/series/" + slug + "-" + info.year + "/",
            "/series/" + slug + "/"
          ]
        : ["/series/" + slug + "/"];
    }

    paths.forEach(function(path) {
      var url = trimSlash(cachedBaseUrl || baseUrl) + path;
      if (seen[url]) return;
      seen[url] = true;
      output.push(url);
    });
  });

  return output;
}

function tryDirectPencuriPage(baseUrl, info, mediaType) {
  var candidates = buildPencuriDirectCandidates(baseUrl, info, mediaType);
  if (!candidates.length) return Promise.resolve(null);

  function tryIndex(index) {
    if (index >= candidates.length) return Promise.resolve(null);

    var url = candidates[index];
    var timeoutMs = index === 0 ? 1400 : 700;

    return requestText(
      url,
      { "Referer": trimSlash(cachedBaseUrl || baseUrl) + "/" },
      timeoutMs
    ).then(function(result) {
      updateBaseFromUrl(result.url || url);

      if (!isDirectPencuriMatch(result, info, mediaType)) {
        return tryIndex(index + 1);
      }

      console.log(
        "[PencuriMovie] direct permalink hit " + (result.url || url)
      );

      return {
        title: info.title,
        href: result.url || url,
        year: info.year,
        isSeries: mediaType === "tv",
        __detailHtml: result.text
      };
    }).catch(function() {
      return tryIndex(index + 1);
    });
  }

  return tryIndex(0);
}

function searchSite(baseUrl, query) {
  function run(domain) {
    var url = trimSlash(domain) + "/?s=" + encodeURIComponent(query);
    return requestText(url, { "Referer": trimSlash(domain) + "/" }, 1800)
      .then(function(result) {
        updateBaseFromUrl(result.url);
        return parseSearchResults(result.text, result.url);
      });
  }

  return run(baseUrl).catch(function(firstError) {
    return refreshBaseUrl().then(function(refreshed) {
      if (!refreshed || trimSlash(refreshed) === trimSlash(baseUrl)) {
        throw firstError;
      }
      console.log("[PencuriMovie] Retrying with refreshed domain " + refreshed);
      return run(refreshed);
    });
  });
}

function findBestTitle(baseUrl, info, mediaType) {
  return tryDirectPencuriPage(baseUrl, info, mediaType).then(function(direct) {
    if (direct) return direct;

    console.log("[PencuriMovie] direct permalink miss, using site search");

    return searchSite(baseUrl, info.title).then(function(items) {
      items.sort(function(a, b) {
        return scoreCandidate(b, info, mediaType) - scoreCandidate(a, info, mediaType);
      });

      var best = items[0] || null;
      if (best && scoreCandidate(best, info, mediaType) >= 30) {
        return best;
      }

      if (
        !best &&
        info.originalTitle &&
        normalizeTitle(info.originalTitle) !== normalizeTitle(info.title)
      ) {
        return searchSite(
          cachedBaseUrl || baseUrl,
          info.originalTitle
        ).then(function(extra) {
          extra.sort(function(a, b) {
            return scoreCandidate(b, info, mediaType) -
              scoreCandidate(a, info, mediaType);
          });
          return extra[0] || null;
        });
      }

      return best;
    });
  }).then(function(best) {
    if (!best) throw new Error("No PencuriMovie title match");

    if (!best.__detailHtml) {
      var score = scoreCandidate(best, info, mediaType);
      if (score < 24) {
        throw new Error("PencuriMovie match confidence too low");
      }
    }

    return best;
  });
}

function parseEpisodeTarget(html, pageUrl, requestedSeason, requestedEpisode) {
  var seasonNumber = Number(requestedSeason || 1);
  var episodeNumber = Number(requestedEpisode || 1);
  var matches = [];

  var seasonRegex =
    /<div\b[^>]*class\s*=\s*(["'])[^"']*\btvseason\b[^"']*\1[^>]*>([\s\S]*?)(?=<div\b[^>]*class\s*=\s*(["'])[^"']*\btvseason\b[^"']*\3[^>]*>|$)/gi;

  var seasonBlock;
  while ((seasonBlock = seasonRegex.exec(html))) {
    var block = seasonBlock[0];
    var strong = block.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
    var blockSeason = strong ? Number((stripTags(strong[1]).match(/season\s*(\d+)/i) || [])[1]) : null;

    var anchorRegex = /<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>[\s\S]*?<\/a>/gi;
    var anchor;
    while ((anchor = anchorRegex.exec(block))) {
      var tagAndText = anchor[0];
      var tag = (tagAndText.match(/<a\b[^>]*>/i) || [])[0] || "";
      var text = stripTags(tagAndText);
      var epMatch = text.match(/episode\s*(\d+)/i);
      if (!epMatch) continue;

      var href = safeUrl(getAttr(tag, "href"), pageUrl);
      if (!href) continue;

      matches.push({
        season: blockSeason || 1,
        episode: Number(epMatch[1]),
        href: href,
        name: text.replace(/^.*?episode\s*\d+\s*[-:]?\s*/i, "").trim()
      });
    }
  }

  if (!matches.length) {
    var allAnchorRegex = /<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>[\s\S]*?<\/a>/gi;
    var any;
    while ((any = allAnchorRegex.exec(html))) {
      var item = any[0];
      var itemTag = (item.match(/<a\b[^>]*>/i) || [])[0] || "";
      var itemText = stripTags(item);
      var itemEp = itemText.match(/episode\s*(\d+)/i);
      if (!itemEp) continue;
      var itemHref = safeUrl(getAttr(itemTag, "href"), pageUrl);
      if (!itemHref) continue;
      matches.push({
        season: 1,
        episode: Number(itemEp[1]),
        href: itemHref,
        name: ""
      });
    }
  }

  var exact = matches.find(function(item) {
    return item.season === seasonNumber && item.episode === episodeNumber;
  });

  if (!exact && seasonNumber === 1) {
    exact = matches.find(function(item) {
      return item.episode === episodeNumber;
    });
  }

  if (!exact) {
    throw new Error(
      "PencuriMovie episode S" + seasonNumber + "E" + episodeNumber + " not found"
    );
  }

  return exact;
}


function unescapeScriptText(value) {
  return decodeHtml(String(value || ""))
    .replace(/\\u002f/gi, "/")
    .replace(/\\x2f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");
}

function isDirectMedia(url) {
  return /\.(?:m3u8|mp4)(?:$|[?#])/i.test(String(url || ""));
}

function inferQuality(url, label) {
  var value = (String(label || "") + " " + String(url || "")).toLowerCase();
  if (/\b2160p?\b|\b4k\b/.test(value)) return "2160p";
  if (/\b1440p?\b/.test(value)) return "1440p";
  if (/\b1080p?\b/.test(value)) return "1080p";
  if (/\b720p?\b/.test(value)) return "720p";
  if (/\b480p?\b/.test(value)) return "480p";
  if (/\b360p?\b/.test(value)) return "360p";
  return "Auto";
}

function getHeaderValue(headers, name) {
  try {
    if (headers && typeof headers.get === "function") {
      return headers.get(name) || headers.get(String(name || "").toLowerCase()) || "";
    }
  } catch (_) {}
  return "";
}

function requestRaw(url, options, timeoutMs, label) {
  var supplied = options || {};
  var fetchOptions = {
    method: supplied.method || "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, supplied.headers || {}),
    redirect: supplied.redirect || "follow"
  };

  if (supplied.body !== undefined) fetchOptions.body = supplied.body;

  var request = fetch(url, fetchOptions).then(function(response) {
    var status = Number(response && response.status || 0);
    var manualRedirect = fetchOptions.redirect === "manual" && status >= 300 && status < 400;

    if (!manualRedirect && response && response.ok === false) {
      throw new Error("HTTP " + status + " for " + url);
    }

    return Promise.resolve(response.text()).then(function(text) {
      return {
        text: String(text || ""),
        url: String(response && response.url || url),
        status: status,
        headers: response && response.headers
      };
    });
  });

  return withSoftTimeout(
    request,
    timeoutMs || 2200,
    label || "PencuriMovie extractor request"
  );
}

function requestPostForm(url, data, headers, timeoutMs) {
  var body = Object.keys(data || {}).map(function(key) {
    return encodeURIComponent(key) + "=" + encodeURIComponent(String(data[key] == null ? "" : data[key]));
  }).join("&");

  return requestRaw(url, {
    method: "POST",
    headers: Object.assign({
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    }, headers || {}),
    body: body,
    redirect: "follow"
  }, timeoutMs || 2200, "PencuriMovie POST " + url);
}

function extractDirectMedia(text, baseUrl) {
  var source = unescapeScriptText(text);
  var found = [];
  var seen = {};

  function add(value, label) {
    var url = safeUrl(value, baseUrl);
    if (!url || !isDirectMedia(url) || seen[url]) return;
    seen[url] = true;
    found.push({
      url: url,
      quality: inferQuality(url, label)
    });
  }

  var absoluteRegex = /https?:\/\/[^"'<>\\\s]+?\.(?:m3u8|mp4)(?:\?[^"'<>\\\s]*)?/gi;
  var absolute;
  while ((absolute = absoluteRegex.exec(source))) add(absolute[0], "");

  var keyedRegex =
    /(?:file|src|source|url)\s*[:=]\s*(["'])([^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)\1/gi;
  var keyed;
  while ((keyed = keyedRegex.exec(source))) add(keyed[2], keyed[0]);

  var sourceTagRegex = /<source\b[^>]*>/gi;
  var sourceTag;
  while ((sourceTag = sourceTagRegex.exec(source))) {
    add(getAttr(sourceTag[0], "src"), sourceTag[0]);
  }

  return found;
}

function extractJwPlayerMedia(text, baseUrl) {
  var source = unpackPackedScripts(unescapeScriptText(text));
  var found = extractDirectMedia(source, baseUrl);
  var seen = {};
  found.forEach(function(item) { seen[item.url] = true; });

  function add(raw, label, type) {
    var url = safeUrl(raw, baseUrl);
    if (!url || seen[url]) return;

    var lower = String(url).toLowerCase();
    var typeLower = String(type || "").toLowerCase();

    var looksPlayable =
      isDirectMedia(url) ||
      /\.txt(?:$|[?#])/i.test(url) ||
      typeLower.indexOf("mpegurl") !== -1 ||
      typeLower.indexOf("m3u8") !== -1 ||
      typeLower.indexOf("mp4") !== -1 ||
      typeLower.indexOf("video") !== -1;

    if (!looksPlayable) return;
    seen[url] = true;
    found.push({
      url: url,
      quality: inferQuality(url, label)
    });
  }

  var objectRegex = /\{[\s\S]{0,600}?\}/g;
  var objectMatch;
  while ((objectMatch = objectRegex.exec(source))) {
    var block = objectMatch[0];
    var file = block.match(/\b(?:file|src)\s*:\s*(["'])(.*?)\1/i);
    if (!file) continue;
    var label = (block.match(/\b(?:label|quality)\s*:\s*(["'])(.*?)\1/i) || [])[2] || "";
    var type = (block.match(/\btype\s*:\s*(["'])(.*?)\1/i) || [])[2] || "";
    add(file[2], label, type);
  }

  var bareFileRegex = /\b(?:file|src)\s*:\s*(["'])(https?:\/\/[^"']+)\1/gi;
  var bare;
  while ((bare = bareFileRegex.exec(source))) add(bare[2], "", "");

  return found;
}

function extractSubtitles(text, baseUrl) {
  var source = unpackPackedScripts(unescapeScriptText(text));
  var output = [];
  var seen = {};

  function add(url, label) {
    var absolute = safeUrl(url, baseUrl);
    if (!absolute || seen[absolute]) return;
    if (!/\.(?:vtt|srt)(?:$|[?#])/i.test(absolute)) return;

    seen[absolute] = true;
    var lower = String(label || "").toLowerCase();
    var lang = lower.indexOf("malay") !== -1 || /\bms\b/.test(lower) ? "ms" :
      lower.indexOf("indones") !== -1 || /\bid\b/.test(lower) ? "id" :
      lower.indexOf("english") !== -1 || /\ben\b/.test(lower) ? "en" : "und";

    output.push({
      label: label || (lang === "und" ? "Subtitle" : lang.toUpperCase()),
      language: label || lang,
      lang: lang,
      url: absolute,
      default: false,
      format: /\.srt(?:$|[?#])/i.test(absolute) ? "srt" : "vtt"
    });
  }

  var trackRegex = /<track\b[^>]*>/gi;
  var track;
  while ((track = trackRegex.exec(source))) {
    add(
      getAttr(track[0], "src"),
      getAttr(track[0], "label") || getAttr(track[0], "srclang")
    );
  }

  var objectRegex = /\{[\s\S]{0,500}?\}/g;
  var objectMatch;
  while ((objectMatch = objectRegex.exec(source))) {
    var block = objectMatch[0];
    var file = block.match(/\b(?:file|src)\s*:\s*(["'])(.*?\.(?:vtt|srt)(?:\?[^"']*)?)\1/i);
    if (!file) continue;
    var label = (block.match(/\b(?:label|srclang|language)\s*:\s*(["'])(.*?)\1/i) || [])[2] || "";
    add(file[2], label);
  }

  var rawRegex = /https?:\/\/[^"'<>\\\s]+?\.(?:vtt|srt)(?:\?[^"'<>\\\s]*)?/gi;
  var raw;
  while ((raw = rawRegex.exec(source))) add(raw[0], "Subtitle");

  return output;
}

function extractIframes(text, baseUrl) {
  var source = unescapeScriptText(text);
  var output = [];
  var seen = {};
  var regex = /<iframe\b[^>]*>/gi;
  var match;

  while ((match = regex.exec(source))) {
    var tag = match[0];
    var raw =
      getAttr(tag, "data-src") ||
      getAttr(tag, "data-lazy-src") ||
      getAttr(tag, "src");

    var url = safeUrl(raw, baseUrl);
    if (!url || seen[url]) continue;

    var lower = url.toLowerCase();
    if (
      lower.indexOf("youtube.com") !== -1 ||
      lower.indexOf("youtu.be") !== -1 ||
      lower.indexOf("youtube-nocookie.com") !== -1 ||
      lower.indexOf("about:blank") === 0
    ) {
      continue;
    }

    seen[url] = true;
    output.push(url);
  }

  return output;
}

/*
 * Jsoup's "div.movieplay iframe" selector handles nested divs. A regex that
 * stops on the first </div> does not. This balanced scan mirrors the DOM
 * selector closely enough for the PencuriMovie server tabs.
 */
function extractMovieplayIframes(text, baseUrl) {
  var source = unescapeScriptText(text);
  var output = [];
  var seen = {};
  var openRegex = /<div\b[^>]*>/gi;
  var open;

  while ((open = openRegex.exec(source))) {
    var openTag = open[0];
    var className = getAttr(openTag, "class");
    if (!/(^|\s)movieplay(\s|$)/i.test(className)) continue;

    var blockStart = open.index;
    var scanStart = openRegex.lastIndex;
    var tokenRegex = /<div\b[^>]*>|<\/div\s*>/gi;
    tokenRegex.lastIndex = scanStart;

    var depth = 1;
    var endIndex = source.length;
    var token;
    while ((token = tokenRegex.exec(source))) {
      if (/^<div\b/i.test(token[0])) depth += 1;
      else depth -= 1;

      if (depth === 0) {
        endIndex = tokenRegex.lastIndex;
        break;
      }
    }

    var block = source.slice(blockStart, endIndex);
    extractIframes(block, baseUrl).forEach(function(url) {
      if (seen[url]) return;
      seen[url] = true;
      output.push(url);
    });

    openRegex.lastIndex = endIndex;
  }

  return output;
}

function extractRedirectTarget(text, baseUrl) {
  var source = unescapeScriptText(text);

  var meta = source.match(
    /<meta\b[^>]*http-equiv\s*=\s*(["'])?refresh\1?[^>]*content\s*=\s*(["'])([\s\S]*?)\2[^>]*>/i
  );
  if (meta) {
    var target = meta[3].match(/url\s*=\s*(.+)$/i);
    if (target) return safeUrl(target[1].replace(/^["']|["']$/g, ""), baseUrl);
  }

  var locationMatch = source.match(
    /(?:window\.)?location(?:\.href)?\s*=\s*(["'])(https?:\/\/[^"']+)\1/i
  );
  return locationMatch ? safeUrl(locationMatch[2], baseUrl) : "";
}

function followRedirectCloudstream(url, referer) {
  var absolute = safeUrl(url, referer);
  if (!absolute) return Promise.resolve("");

  return requestRaw(absolute, {
    method: "GET",
    headers: referer ? { "Referer": referer } : {},
    redirect: "manual"
  }, 1400, "PencuriMovie redirect " + absolute).then(function(result) {
    var location = getHeaderValue(result.headers, "location");
    if (location) return safeUrl(location, absolute);

    var meta = extractRedirectTarget(result.text, absolute);
    if (meta) return meta;

    /*
     * Some fetch implementations ignore redirect:"manual". In that case
     * response.url is already the final URL, which is still useful.
     */
    return result.url || absolute;
  }).catch(function() {
    return absolute;
  });
}

function mergeResolved(target, source) {
  var streamSeen = {};
  target.streams.forEach(function(item) { streamSeen[item.url] = true; });
  (source.streams || []).forEach(function(item) {
    if (!item || !item.url || streamSeen[item.url]) return;
    streamSeen[item.url] = true;
    target.streams.push(item);
  });

  var subtitleSeen = {};
  target.subtitles.forEach(function(item) { subtitleSeen[item.url] = true; });
  (source.subtitles || []).forEach(function(item) {
    if (!item || !item.url || subtitleSeen[item.url]) return;
    subtitleSeen[item.url] = true;
    target.subtitles.push(item);
  });

  return target;
}

function emptyResolved() {
  return { streams: [], subtitles: [] };
}

function resolvedFromText(text, pageUrl, headers) {
  return {
    streams: extractJwPlayerMedia(text, pageUrl).map(function(item) {
      return {
        url: item.url,
        quality: item.quality,
        referer: pageUrl,
        headers: headers || {}
      };
    }),
    subtitles: extractSubtitles(text, pageUrl)
  };
}

function extractScriptBodies(text) {
  var source = String(text || "");
  var scripts = [];
  var regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  var match;
  while ((match = regex.exec(source))) scripts.push(match[1]);
  return scripts;
}

/*
 * Cloudstream uses JsUnpacker/getAndUnpack for Dean Edwards P.A.C.K.E.R.
 * We intercept the packer's eval so the decoded source is returned instead
 * of executing the decoded player code.
 */
function unpackPackedScripts(text) {
  var source = String(text || "");
  var additions = [];

  extractScriptBodies(source).forEach(function(body) {
    if (body.indexOf("eval(function(p,a,c,k,e") === -1) return;

    try {
      var candidate = body.trim().replace(/;\s*$/, "");
      var factory = Function(
        "safeEval",
        "return (function(eval){ return (" + candidate + "); })(safeEval);"
      );
      var decoded = factory(function(code) { return String(code || ""); });
      if (decoded && typeof decoded === "string") additions.push(decoded);
    } catch (_) {}
  });

  return additions.length ? source + "\n" + additions.join("\n") : source;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (_) {
    return "";
  }
}

function hostOf(url) {
  try {
    return String(new URL(url).hostname || "").toLowerCase();
  } catch (_) {
    return "";
  }
}

function hostMatches(host, domains) {
  var value = String(host || "").toLowerCase();
  return (domains || []).some(function(domain) {
    var d = String(domain || "").toLowerCase();
    return value === d || value.slice(-(d.length + 1)) === "." + d;
  });
}

var STREAMWISH_DOMAINS = [
  "streamwish.to", "mwish.pro", "dwish.pro", "embedwish.com", "hgcloud.to",
  "wishembed.pro", "kswplayer.info", "wishfast.top", "streamwish.site",
  "sfastwish.com", "strwish.xyz", "strwish.com", "flaswish.com", "awish.pro",
  "obeywish.com", "jodwish.com", "swhoi.com", "multimovies.cloud",
  "uqloads.xyz", "doodporn.xyz", "cdnwish.com", "asnwish.com",
  "nekowish.my.id", "neko-stream.click", "swdyu.com", "wishonly.site",
  "playerwish.com", "streamhls.to", "hlswish.com", "hglink.to"
];

var VIDHIDE_DOMAINS = [
  "vidhidepro.com", "vidhidehub.com", "vidhidevip.com", "vidhidepre.com",
  "smoothpre.com", "dhtpre.com", "peytonepre.com", "filelions.live",
  "filelions.online", "filelions.to", "kinoger.be", "vidhide.com",
  "rubyvidhub.com", "server2.shop"
];

var FILEMOON_DOMAINS = ["filemoon.to", "filemoon.in", "filemoon.sx"];
var STREAMTAPE_DOMAINS = [
  "streamtape.com", "streamtape.net", "streamtape.xyz",
  "watchadsontape.com", "shavetape.cash"
];
var DOOD_DOMAINS = [
  "dood.la", "dood.pm", "dood.to", "dood.so", "dood.ws", "dood.yt",
  "dood.li", "dood.watch", "dood.cx", "dood.sh", "dood.wf",
  "ds2play.com", "ds2video.com", "vide0.net", "myvidplay.com", "playmogo.com"
];
var MIXDROP_DOMAINS = [
  "mixdrop.co", "mixdrop.bz", "mixdrop.ch", "mixdrop.to",
  "mixdrop.si", "mixdrop.ps", "mixdrop.ag"
];
var VIDMOLY_DOMAINS = ["vidmoly.net", "vidmoly.me", "vidmoly.to", "vidmoly.biz"];
var LULU_DOMAINS = ["luluvdo.com", "luluvdoo.com", "lulustream.com", "kinoger.pw"];
var VOE_DOMAINS = [
  "voe.sx", "donaldlineelse.com", "charlestoughrace.com", "yip.su",
  "metagnathtuggers.com", "tubelessceliolymph.com", "simpulumlamerop.com",
  "urochsunloath.com", "nathanfromsubject.com"
];

function extractStreamWish(url, referer) {
  var origin = originOf(url);
  var resolvedUrl = url;

  try {
    var parsed = new URL(url);
    var match = parsed.pathname.match(/\/(?:f|e)\/([^/?#]+)/i);
    if (match) resolvedUrl = origin + "/" + match[1];
  } catch (_) {}

  var headers = {
    "Accept": "*/*",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Referer": origin + "/",
    "Origin": origin,
    "User-Agent": USER_AGENT
  };

  return requestRaw(resolvedUrl, {
    headers: Object.assign({}, headers, referer ? { "Referer": referer } : {}),
    redirect: "follow"
  }, 2500, "StreamWish " + resolvedUrl).then(function(result) {
    return resolvedFromText(result.text, result.url || resolvedUrl, headers);
  });
}

function extractVidHide(url, referer) {
  var embed = String(url || "")
    .replace("/d/", "/v/")
    .replace("/download/", "/v/")
    .replace("/file/", "/v/")
    .replace("/f/", "/v/");

  var origin = originOf(embed);
  var headers = {
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Origin": origin,
    "User-Agent": USER_AGENT
  };
  if (referer) headers["Referer"] = referer;

  return requestRaw(embed, {
    headers: headers,
    redirect: "follow"
  }, 2500, "VidHide " + embed).then(function(result) {
    return resolvedFromText(result.text, result.url || embed, headers);
  });
}

function extractFileMoon(url, referer) {
  var defaultHeaders = {
    "Referer": url,
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "User-Agent": USER_AGENT
  };
  if (referer) defaultHeaders["Referer"] = referer;

  return requestRaw(url, {
    headers: defaultHeaders,
    redirect: "follow"
  }, 2400, "FileMoon " + url).then(function(initial) {
    var frames = extractIframes(initial.text, initial.url || url);

    if (!frames.length) {
      return resolvedFromText(initial.text, initial.url || url, defaultHeaders);
    }

    return requestRaw(frames[0], {
      headers: Object.assign({}, defaultHeaders, {
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": initial.url || url
      }),
      redirect: "follow"
    }, 2400, "FileMoon iframe " + frames[0]).then(function(frame) {
      return resolvedFromText(frame.text, frame.url || frames[0], defaultHeaders);
    });
  });
}

function randomToken(length) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var output = "";
  for (var i = 0; i < length; i++) {
    output += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return output;
}

function extractDood(url) {
  var embedUrl = String(url || "").replace("/d/", "/e/");

  return requestRaw(embedUrl, {
    redirect: "follow"
  }, 2200, "Dood " + embedUrl).then(function(page) {
    var base = originOf(page.url || embedUrl);
    var md5Match = page.text.match(/\/pass_md5\/[^'"\s<]+/i);
    if (!md5Match) return emptyResolved();

    var md5Url = base + md5Match[0];
    return requestRaw(md5Url, {
      headers: { "Referer": page.url || embedUrl },
      redirect: "follow"
    }, 1800, "Dood pass_md5").then(function(md5) {
      var token = "";
      try {
        token = new URL(md5Url).pathname.split("/").filter(Boolean).pop() || "";
      } catch (_) {}

      var trueUrl = String(md5.text || "").trim() + randomToken(10) + "?token=" + token;
      if (!/^https?:\/\//i.test(trueUrl)) return emptyResolved();

      return {
        streams: [{
          url: trueUrl,
          quality: inferQuality(page.text, ""),
          referer: base + "/",
          headers: { "Referer": base + "/" }
        }],
        subtitles: []
      };
    });
  });
}

function extractMixDrop(url) {
  var embed = String(url || "").replace("/f/", "/e/");

  return requestRaw(embed, {
    redirect: "follow"
  }, 2300, "MixDrop " + embed).then(function(result) {
    var unpacked = unpackPackedScripts(result.text);
    var match = unpacked.match(/wurl.*?=.*?(["'])(.*?)\1\s*;/i);

    if (match && match[2]) {
      var direct = safeUrl(match[2], result.url || embed);
      return {
        streams: [{
          url: direct,
          quality: inferQuality(direct, ""),
          referer: url,
          headers: { "Referer": url }
        }],
        subtitles: extractSubtitles(unpacked, result.url || embed)
      };
    }

    return resolvedFromText(unpacked, result.url || embed, { "Referer": url });
  });
}

function extractVidmoly(url, referer) {
  var embed = String(url || "");
  if (embed.indexOf("/w/") !== -1) {
    embed = embed.replace("/w/", "/embed-") + ".html";
  }

  var headers = {
    "User-Agent": USER_AGENT,
    "Sec-Fetch-Dest": "iframe"
  };
  if (referer) headers["Referer"] = referer;

  return requestRaw(embed, {
    headers: headers,
    redirect: "follow"
  }, 2300, "Vidmoly " + embed).then(function(result) {
    return resolvedFromText(result.text, result.url || embed, headers);
  });
}

function extractLulu(url, referer) {
  var parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return Promise.resolve(emptyResolved());
  }

  var segments = parsed.pathname.split("/").filter(Boolean);
  var filecode = segments.length ? segments[segments.length - 1] : "";
  if (!filecode) return Promise.resolve(emptyResolved());

  var postUrl = parsed.origin + "/dl";
  return requestPostForm(postUrl, {
    op: "embed",
    file_code: filecode,
    auto: "1",
    referer: referer || ""
  }, referer ? { "Referer": referer } : {}, 2300).then(function(result) {
    return resolvedFromText(result.text, result.url || postUrl, {
      "Referer": referer || parsed.origin + "/"
    });
  });
}

function evalStringExpression(expression) {
  var expr = String(expression || "").trim().replace(/;\s*$/, "");
  if (!expr) return "";

  /*
   * StreamTape's Cloudstream extractor evaluates the small RHS expression used
   * to build the botlink. This equivalent evaluates only that extracted RHS.
   */
  try {
    return String(Function("return (" + expr + ");")() || "");
  } catch (_) {
    var protocolRelative = expr.match(/(["'])(\/\/[^"']+)\1/);
    return protocolRelative ? protocolRelative[2] : "";
  }
}

function extractStreamTape(url) {
  return requestRaw(url, {
    redirect: "follow"
  }, 2300, "StreamTape " + url).then(function(result) {
    var lines = String(result.text || "").split(/\r?\n/);
    var line = lines.find(function(value) {
      return value.indexOf("botlink').innerHTML") !== -1 ||
        value.indexOf('botlink").innerHTML') !== -1;
    });

    if (!line) return emptyResolved();

    var marker = line.indexOf(").innerHTML");
    if (marker === -1) return emptyResolved();

    var rhs = line.slice(marker + ").innerHTML".length).replace(/^\s*=\s*/, "");
    var value = evalStringExpression(rhs);
    if (!value) return emptyResolved();

    var direct = value.indexOf("//") === 0 ? "https:" + value : safeUrl(value, result.url || url);
    if (direct.indexOf("stream=1") === -1) {
      direct += (direct.indexOf("?") === -1 ? "?" : "&") + "stream=1";
    }

    return {
      streams: [{
        url: direct,
        quality: "Auto",
        referer: url,
        headers: { "Referer": url }
      }],
      subtitles: []
    };
  });
}

function base64DecodeText(value) {
  var input = String(value || "").replace(/\s+/g, "");

  try {
    if (typeof atob === "function") return atob(input);
  } catch (_) {}

  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(input, "base64").toString("binary");
    }
  } catch (_) {}

  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  var output = "";
  var i = 0;

  while (i < input.length) {
    var enc1 = chars.indexOf(input.charAt(i++));
    var enc2 = chars.indexOf(input.charAt(i++));
    var enc3 = chars.indexOf(input.charAt(i++));
    var enc4 = chars.indexOf(input.charAt(i++));

    var chr1 = (enc1 << 2) | (enc2 >> 4);
    var chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    var chr3 = ((enc3 & 3) << 6) | enc4;

    output += String.fromCharCode(chr1);
    if (enc3 !== 64 && enc3 !== -1) output += String.fromCharCode(chr2);
    if (enc4 !== 64 && enc4 !== -1) output += String.fromCharCode(chr3);
  }

  return output;
}

function rot13(value) {
  return String(value || "").replace(/[A-Za-z]/g, function(char) {
    var code = char.charCodeAt(0);
    var base = code >= 97 ? 97 : 65;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function decryptVoeF7(encoded) {
  try {
    var value = rot13(encoded);
    ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(function(pattern) {
      value = value.split(pattern).join("_");
    });
    value = value.replace(/_/g, "");

    var stage1 = base64DecodeText(value);
    var shifted = "";
    for (var i = 0; i < stage1.length; i++) {
      shifted += String.fromCharCode(stage1.charCodeAt(i) - 3);
    }

    var reversed = shifted.split("").reverse().join("");
    return JSON.parse(base64DecodeText(reversed));
  } catch (_) {
    return null;
  }
}

function extractVoe(url, referer) {
  function read(pageUrl) {
    return requestRaw(pageUrl, {
      headers: referer ? { "Referer": referer } : {},
      redirect: "follow"
    }, 2300, "Voe " + pageUrl);
  }

  return read(url).then(function(first) {
    var redirect = String(first.text || "").match(
      /window\.location\.href\s*=\s*'([^']+)'\s*;?/i
    );

    var pagePromise = redirect && redirect[1]
      ? read(safeUrl(redirect[1], first.url || url))
      : Promise.resolve(first);

    return pagePromise.then(function(page) {
      var script = String(page.text || "").match(
        /<script\b[^>]*type\s*=\s*(["'])application\/json\1[^>]*>([\s\S]*?)<\/script>/i
      );
      if (!script) return emptyResolved();

      var raw = String(script[2] || "").trim();
      var encoded = "";

      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) encoded = String(parsed[0] || "");
      } catch (_) {}

      if (!encoded) {
        var encodedMatch = raw.match(/^\s*\[\s*"([\s\S]*?)"\s*\]\s*$/);
        if (encodedMatch) encoded = encodedMatch[1];
      }

      var decrypted = decryptVoeF7(encoded);
      if (!decrypted) return emptyResolved();

      var streams = [];
      var origin = originOf(page.url || url);

      if (decrypted.source) {
        streams.push({
          url: safeUrl(decrypted.source, page.url || url),
          quality: inferQuality(decrypted.source, ""),
          referer: origin + "/",
          headers: { "Origin": origin, "Referer": origin + "/" }
        });
      }

      if (decrypted.direct_access_url) {
        streams.push({
          url: safeUrl(decrypted.direct_access_url, page.url || url),
          quality: inferQuality(decrypted.direct_access_url, ""),
          referer: url,
          headers: { "Referer": url }
        });
      }

      return { streams: streams, subtitles: [] };
    });
  });
}

function extractGenericHost(url, referer, depth) {
  return requestRaw(url, {
    headers: referer ? { "Referer": referer } : {},
    redirect: "follow"
  }, 2300, "Generic extractor " + url).then(function(result) {
    var resolved = resolvedFromText(
      result.text,
      result.url || url,
      referer ? { "Referer": referer } : {}
    );

    if (resolved.streams.length || Number(depth || 0) >= 1) return resolved;

    var nested = extractIframes(result.text, result.url || url).slice(0, 2);
    if (!nested.length) return resolved;

    return Promise.all(nested.map(function(child) {
      return loadExtractorEquivalent(child, result.url || url, Number(depth || 0) + 1)
        .catch(function() { return emptyResolved(); });
    })).then(function(children) {
      children.forEach(function(child) { mergeResolved(resolved, child); });
      return resolved;
    });
  });
}


function firstNonEmptyResolved(tasks, timeoutMs) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return Promise.resolve(emptyResolved());
  }

  return new Promise(function(resolve) {
    var pending = tasks.length;
    var settled = false;

    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(value || emptyResolved());
    }

    tasks.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          var count =
            value && Array.isArray(value.streams)
              ? value.streams.length
              : 0;

          if (count > 0) {
            finish(value);
            return;
          }

          pending -= 1;
          if (pending <= 0) finish(emptyResolved());
        })
        .catch(function() {
          pending -= 1;
          if (pending <= 0) finish(emptyResolved());
        });
    });

    setTimeout(function() {
      finish(emptyResolved());
    }, timeoutMs);
  });
}


function nativeWebViewAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}


function sanitizeNativePlaybackHeaders(rawHeaders, mirrorUrl) {
  var blocked = {
    "host": true,
    "connection": true,
    "accept-encoding": true,
    "range": true,
    "origin": true
  };

  var headers = {};
  var input =
    rawHeaders && typeof rawHeaders === "object"
      ? rawHeaders
      : {};

  Object.keys(input).forEach(function(key) {
    var lower = String(key).toLowerCase();
    if (blocked[lower]) return;
    headers[String(key)] = String(input[key]);
  });

  headers["User-Agent"] =
    headers["User-Agent"] ||
    headers["user-agent"] ||
    USER_AGENT;
  headers["Accept"] =
    headers["Accept"] ||
    headers["accept"] ||
    "*/*";

  /*
   * Cloudstream sets ExtractorLink.referer to the player mirror URL even when
   * the intercepted WebView request carried another transient Referer.
   */
  delete headers["referer"];
  headers["Referer"] = mirrorUrl;

  return headers;
}

function nativeTransportScore(url) {
  var value = String(url || "").toLowerCase();
  if (value.indexOf(".m3u8") !== -1) return 30;
  if (value.indexOf(".mp4") !== -1) return 20;
  if (value.indexOf(".m4v") !== -1) return 20;
  if (value.indexOf("/sora/") !== -1) return 10;
  return 0;
}

function resolveWithNativeWebView(url, referer, label) {
  if (!nativeWebViewAvailable()) {
    return Promise.resolve(emptyResolved());
  }

  var absolute = safeUrl(url, referer);
  if (!absolute) return Promise.resolve(emptyResolved());

  console.log(
    "[" + PROVIDER_NAME + "] native WebView start host=" + hostOf(absolute)
  );

  return globalThis.webviewResolve(absolute, {
    referer: referer || absolute,
    timeoutMs: 13000,
    finishAfterFirstMs: 600,
    clickDelaysMs: [
      650,
      1300,
      2200,
      3400,
      5000,
      7000,
      9500,
      12000
    ],
    match: [
      "/sora/",
      ".m3u8",
      ".mp4",
      ".m4v"
    ],
    blocked: [
      "doubleclick",
      "googlesyndication",
      "/ads/",
      "vast"
    ],
    injectAbyssHook: true
  }).then(function(result) {
    var nativeStreams =
      result && Array.isArray(result.streams)
        ? result.streams
        : [];

    var streams = nativeStreams
      .map(function(item) {
        if (!item || !item.url) return null;

        var headers = sanitizeNativePlaybackHeaders(
          item.headers,
          absolute
        );

        return {
          url: String(item.url),
          quality: inferQuality(
            item.url,
            item.label || label || PROVIDER_NAME
          ),
          referer: absolute,
          headers: headers,
          serverLabel:
            label ||
            item.label ||
            "WebView"
        };
      })
      .filter(Boolean)
      .sort(function(a, b) {
        var transport =
          nativeTransportScore(b.url) -
          nativeTransportScore(a.url);
        if (transport !== 0) return transport;

        return String(a.quality || "").localeCompare(
          String(b.quality || "")
        );
      });

    console.log(
      "[" + PROVIDER_NAME + "] native WebView streams=" + streams.length
    );

    return {
      streams: streams,
      subtitles: []
    };
  }).catch(function(error) {
    console.log(
      "[" + PROVIDER_NAME + "] native WebView failed host=" +
      hostOf(absolute) +
      " error=" +
      (error && error.message ? error.message : String(error))
    );
    return emptyResolved();
  });
}

function extractorNameFor(url) {
  var host = hostOf(url);

  if (hostMatches(host, STREAMWISH_DOMAINS)) return "StreamWish";
  if (hostMatches(host, VIDHIDE_DOMAINS)) return "VidHidePro";
  if (hostMatches(host, FILEMOON_DOMAINS) || host.indexOf("filemoon") !== -1) return "FileMoon";
  if (hostMatches(host, DOOD_DOMAINS) || host.indexOf("dood.") !== -1) return "Dood";
  if (hostMatches(host, MIXDROP_DOMAINS) || host.indexOf("mixdrop.") !== -1) return "MixDrop";
  if (hostMatches(host, STREAMTAPE_DOMAINS) || host.indexOf("streamtape.") !== -1) return "StreamTape";
  if (hostMatches(host, VIDMOLY_DOMAINS) || host.indexOf("vidmoly.") !== -1) return "Vidmoly";
  if (hostMatches(host, LULU_DOMAINS) || host.indexOf("luluvdo") !== -1 || host.indexOf("lulustream") !== -1) return "LuluStream";
  if (hostMatches(host, VOE_DOMAINS) || host === "voe.sx") return "Voe";
  if (
    host.indexOf("palankyurok.com") !== -1 ||
    host.indexOf("abyss") !== -1 ||
    host.indexOf("ezpla") !== -1 ||
    host.indexOf("seekp") !== -1 ||
    host.indexOf("p2pst") !== -1 ||
    host.indexOf("upns") !== -1
  ) return "BrowserPlayer";

  return "Generic";
}

function dispatchExtractor(url, referer, depth) {
  var name = extractorNameFor(url);
  console.log("[PencuriMovie] extractor=" + name + " host=" + hostOf(url));

  var work;
  if (name === "StreamWish") work = extractStreamWish(url, referer);
  else if (name === "VidHidePro") work = extractVidHide(url, referer);
  else if (name === "FileMoon") work = extractFileMoon(url, referer);
  else if (name === "Dood") work = extractDood(url);
  else if (name === "MixDrop") work = extractMixDrop(url);
  else if (name === "StreamTape") work = extractStreamTape(url);
  else if (name === "Vidmoly") work = extractVidmoly(url, referer);
  else if (name === "LuluStream") work = extractLulu(url, referer);
  else if (name === "Voe") work = extractVoe(url, referer);
  else if (name === "BrowserPlayer") work = resolveWithNativeWebView(url, referer, "BrowserPlayer");
  else work = extractGenericHost(url, referer, depth || 0);

  return Promise.resolve(work).then(function(resolved) {
    var streams = resolved && Array.isArray(resolved.streams) ? resolved.streams.length : 0;
    console.log("[PencuriMovie] " + name + " streams=" + streams);

    /*
     * A recognised host can change its frontend. If the specific extraction
     * produced nothing, try the generic packed/JWPlayer parser before giving up.
     */
    if (streams) return resolved || emptyResolved();

    return extractGenericHost(url, referer, 1)
      .catch(function() {
        return resolved || emptyResolved();
      })
      .then(function(genericResolved) {
        var genericStreams =
          genericResolved && Array.isArray(genericResolved.streams)
            ? genericResolved.streams.length
            : 0;

        if (genericStreams) return genericResolved;

        return resolveWithNativeWebView(
          url,
          referer,
          name === "Generic" ? "WebView" : name
        );
      });
  });
}

function loadExtractorEquivalent(url, referer, depth) {
  var absolute = safeUrl(url, referer);
  if (!absolute) return Promise.resolve(emptyResolved());

  if (isDirectMedia(absolute)) {
    return Promise.resolve({
      streams: [{
        url: absolute,
        quality: inferQuality(absolute, ""),
        referer: referer || absolute,
        headers: referer ? { "Referer": referer } : {}
      }],
      subtitles: []
    });
  }

  var directName = extractorNameFor(absolute);
  if (directName === "BrowserPlayer") {
    console.log("[PencuriMovie] native direct host=" + hostOf(absolute));
    return resolveWithNativeWebView(
      absolute,
      referer || absolute,
      "BrowserPlayer"
    );
  }

  return followRedirectCloudstream(absolute, referer).then(function(finalUrl) {
    finalUrl = finalUrl || absolute;
    console.log(
      "[PencuriMovie] iframe=" + hostOf(absolute) +
      (finalUrl !== absolute ? " redirect=" + hostOf(finalUrl) : "")
    );
    return dispatchExtractor(finalUrl, referer || absolute, depth || 0);
  });
}

function resolveMovieplayFrames(html, pageUrl) {
  var direct = extractJwPlayerMedia(html, pageUrl);
  var resolved = {
    streams: direct.map(function(item) {
      return {
        url: item.url,
        quality: item.quality,
        referer: pageUrl,
        headers: { "Referer": pageUrl }
      };
    }),
    subtitles: extractSubtitles(html, pageUrl)
  };

  if (resolved.streams.length) return Promise.resolve(resolved);

  var frames = extractMovieplayIframes(html, pageUrl);
  if (!frames.length) {
    throw new Error("PencuriMovie movieplay iframe not found");
  }

  console.log("[PencuriMovie] movieplay iframes=" + frames.length);

  /*
   * Cloudstream calls loadExtractor for every iframe in div.movieplay.
   * Run them in parallel so multiple servers do not multiply total latency.
   */
  return firstNonEmptyResolved(
    frames.map(function(frame) {
      return loadExtractorEquivalent(frame, pageUrl, 0).catch(function(error) {
        console.log(
          "[PencuriMovie] extractor failed host=" + hostOf(frame) +
          " error=" + (error && error.message ? error.message : String(error))
        );
        return emptyResolved();
      });
    }),
    16000
  ).then(function(child) {
    mergeResolved(resolved, child);
    return resolved;
  });
}

function resolvePlaybackPage(pageUrl) {
  return requestText(pageUrl, {}, 1800).then(function(result) {
    updateBaseFromUrl(result.url);
    return resolveMovieplayFrames(result.text, result.url || pageUrl);
  });
}

function buildStreams(resolved, info, mediaType, season, episode) {
  var subtitles = resolved && Array.isArray(resolved.subtitles) ? resolved.subtitles : [];
  var sources = resolved && Array.isArray(resolved.streams) ? resolved.streams : [];
  var seen = {};

  var episodeLabel =
    mediaType === "tv"
      ? " S" + String(season || 1).padStart(2, "0") +
        "E" + String(episode || 1).padStart(2, "0")
      : "";

  return sources.map(function(source, index) {
    if (!source || !source.url || seen[source.url]) return null;
    seen[source.url] = true;

    var referer = source.referer || cachedBaseUrl || FALLBACK_BASE_URL;

    return {
      name:
        PROVIDER_NAME +
        (sources.length > 1 ? " Server " + (index + 1) : ""),
      title: (info.title || PROVIDER_NAME) + episodeLabel,
      url: source.url,
      quality: source.quality || inferQuality(source.url, ""),
      subtitles: subtitles,
      headers: Object.assign({
        "User-Agent": USER_AGENT,
        "Referer": referer
      }, source.headers || {})
    };
  }).filter(Boolean);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var requestedSeason = Number(season || 1);
  var requestedEpisode = Number(episode || 1);

  console.log(
    "[PencuriMovie] Request tmdbId=" + tmdbId +
    " type=" + type +
    (type === "tv" ? " S" + requestedSeason + "E" + requestedEpisode : "")
  );

  var info;
  var baseUrl;

  var work = Promise.all([
    getTmdbInfo(tmdbId, type),
    getBaseUrl()
  ])
    .then(function(values) {
      info = values[0];
      baseUrl = values[1];

      if (!info || !info.title) throw new Error("TMDB title is empty");

      return findBestTitle(baseUrl, info, type);
    })
    .then(function(match) {
      var detailPromise = match.__detailHtml
        ? Promise.resolve({
            text: match.__detailHtml,
            url: match.href
          })
        : requestText(
            match.href,
            { "Referer": trimSlash(cachedBaseUrl || baseUrl) + "/" },
            1400
          );

      return detailPromise.then(function(detail) {
        updateBaseFromUrl(detail.url || match.href);

        if (type === "movie") {
          return {
            targetUrl: detail.url || match.href,
            detailHtml: detail.text
          };
        }

        var selected = parseEpisodeTarget(
          detail.text,
          detail.url || match.href,
          requestedSeason,
          requestedEpisode
        );

        return {
          targetUrl: selected.href,
          detailHtml: null
        };
      });
    })
    .then(function(target) {
      if (target.detailHtml && type === "movie") {
        return resolveMovieplayFrames(target.detailHtml, target.targetUrl);
      }

      return resolvePlaybackPage(target.targetUrl);
    })
    .then(function(resolved) {
      var streams = buildStreams(
        resolved,
        info,
        type,
        type === "tv" ? requestedSeason : null,
        type === "tv" ? requestedEpisode : null
      );

      console.log("[PencuriMovie] Direct streams found=" + streams.length);
      return streams;
    });

  return withSoftTimeout(work, 19500, "PencuriMovie provider")
    .catch(function(error) {
      console.error(
        "[PencuriMovie] " +
        (error && error.message ? error.message : String(error))
      );
      return [];
    });
}

module.exports = {
  getStreams: getStreams
};
