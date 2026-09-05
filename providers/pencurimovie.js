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
  return searchSite(baseUrl, info.title).then(function(items) {
    items.sort(function(a, b) {
      return scoreCandidate(b, info, mediaType) - scoreCandidate(a, info, mediaType);
    });

    var best = items[0];
    var bestScore = best ? scoreCandidate(best, info, mediaType) : 0;

    if (best) {
      return best;
    }

    if (
      info.originalTitle &&
      normalizeTitle(info.originalTitle) !== normalizeTitle(info.title)
    ) {
      return searchSite(cachedBaseUrl || baseUrl, info.originalTitle).then(function(extra) {
        var combined = items.concat(extra);
        var unique = {};
        combined = combined.filter(function(item) {
          if (!item || !item.href || unique[item.href]) return false;
          unique[item.href] = true;
          return true;
        });
        combined.sort(function(a, b) {
          return scoreCandidate(b, info, mediaType) - scoreCandidate(a, info, mediaType);
        });
        return combined[0] || null;
      });
    }

    return best || null;
  }).then(function(best) {
    if (!best) throw new Error("No PencuriMovie title match");
    var score = scoreCandidate(best, info, mediaType);
    if (score < 34) throw new Error("PencuriMovie match confidence too low");
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
  while ((absolute = absoluteRegex.exec(source))) {
    add(absolute[0], "");
  }

  var keyedRegex =
    /(?:file|src|source|url)\s*[:=]\s*(["'])([^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)\1/gi;
  var keyed;
  while ((keyed = keyedRegex.exec(source))) {
    add(keyed[2], keyed[0]);
  }

  var sourceTagRegex = /<source\b[^>]*>/gi;
  var sourceTag;
  while ((sourceTag = sourceTagRegex.exec(source))) {
    add(getAttr(sourceTag[0], "src"), sourceTag[0]);
  }

  return found;
}

function extractSubtitles(text, baseUrl) {
  var source = unescapeScriptText(text);
  var output = [];
  var seen = {};

  function add(url, label) {
    var absolute = safeUrl(url, baseUrl);
    if (!absolute || seen[absolute]) return;
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
    var src = getAttr(track[0], "src");
    if (!src || !/\.(?:vtt|srt)(?:$|[?#])/i.test(src)) continue;
    add(src, getAttr(track[0], "label") || getAttr(track[0], "srclang"));
  }

  var rawRegex = /https?:\/\/[^"'<>\\\s]+?\.(?:vtt|srt)(?:\?[^"'<>\\\s]*)?/gi;
  var raw;
  while ((raw = rawRegex.exec(source))) add(raw[0], "Subtitle");

  return output;
}


function extractMovieplayIframes(text, baseUrl) {
  var source = unescapeScriptText(text);
  var output = [];
  var seen = {};

  var blockRegex =
    /<div\b[^>]*class\s*=\s*(["'])[^"']*\bmovieplay\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/gi;
  var block;

  while ((block = blockRegex.exec(source))) {
    var iframeRegex = /<iframe\b[^>]*>/gi;
    var frame;
    while ((frame = iframeRegex.exec(block[0]))) {
      var raw =
        getAttr(frame[0], "data-src") ||
        getAttr(frame[0], "data-lazy-src") ||
        getAttr(frame[0], "src");
      var url = safeUrl(raw, baseUrl);
      if (!url || seen[url]) continue;
      seen[url] = true;
      output.push(url);
    }
  }

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

function resolveEmbed(url, referer, depth) {
  var absolute = safeUrl(url, referer);
  if (!absolute) {
    return Promise.resolve({ streams: [], subtitles: [] });
  }

  if (isDirectMedia(absolute)) {
    return Promise.resolve({
      streams: [{
        url: absolute,
        quality: inferQuality(absolute, ""),
        referer: referer || absolute
      }],
      subtitles: []
    });
  }

  return requestText(
    absolute,
    referer ? { "Referer": referer } : {},
    depth === 0 ? 1800 : 1300
  ).then(function(result) {
    var resolved = { streams: [], subtitles: [] };
    var finalUrl = result.url || absolute;

    if (isDirectMedia(finalUrl)) {
      resolved.streams.push({
        url: finalUrl,
        quality: inferQuality(finalUrl, ""),
        referer: referer || absolute
      });
      return resolved;
    }

    extractDirectMedia(result.text, finalUrl).forEach(function(item) {
      resolved.streams.push({
        url: item.url,
        quality: item.quality,
        referer: finalUrl
      });
    });

    resolved.subtitles = extractSubtitles(result.text, finalUrl);

    if (resolved.streams.length || depth >= 1) {
      return resolved;
    }

    var redirectTarget = extractRedirectTarget(result.text, finalUrl);
    var nested = extractIframes(result.text, finalUrl);
    if (redirectTarget) nested.unshift(redirectTarget);

    nested = nested.slice(0, 3);
    if (!nested.length) return resolved;

    return Promise.all(
      nested.map(function(child) {
        return resolveEmbed(child, finalUrl, depth + 1).catch(function() {
          return { streams: [], subtitles: [] };
        });
      })
    ).then(function(children) {
      children.forEach(function(child) {
        mergeResolved(resolved, child);
      });
      return resolved;
    });
  }).catch(function() {
    return { streams: [], subtitles: [] };
  });
}

function resolvePlaybackPage(pageUrl) {
  return requestText(pageUrl, {}, 1800).then(function(result) {
    updateBaseFromUrl(result.url);

    var resolved = {
      streams: extractDirectMedia(result.text, result.url).map(function(item) {
        return {
          url: item.url,
          quality: item.quality,
          referer: result.url
        };
      }),
      subtitles: extractSubtitles(result.text, result.url)
    };

    if (resolved.streams.length) return resolved;

    var iframes = extractMovieplayIframes(result.text, result.url);
    if (!iframes.length) {
      iframes = extractIframes(result.text, result.url);
    }
    if (!iframes.length) {
      throw new Error("PencuriMovie playback iframe not found");
    }

    return resolveEmbed(iframes[0], result.url, 0).then(function(child) {
      mergeResolved(resolved, child);
      return resolved;
    });
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
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": referer
      }
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
      return requestText(
        match.href,
        { "Referer": trimSlash(cachedBaseUrl || baseUrl) + "/" },
        1800
      ).then(function(detail) {
        updateBaseFromUrl(detail.url);

        if (type === "movie") {
          return {
            targetUrl: detail.url,
            detailHtml: detail.text
          };
        }

        var selected = parseEpisodeTarget(
          detail.text,
          detail.url,
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
        var immediate = extractDirectMedia(target.detailHtml, target.targetUrl);
        var frames = extractMovieplayIframes(target.detailHtml, target.targetUrl);
        if (!frames.length) frames = extractIframes(target.detailHtml, target.targetUrl);

        if (immediate.length) {
          return {
            streams: immediate.map(function(item) {
              return {
                url: item.url,
                quality: item.quality,
                referer: target.targetUrl
              };
            }),
            subtitles: extractSubtitles(target.detailHtml, target.targetUrl)
          };
        }

        if (frames.length) {
          return resolveEmbed(frames[0], target.targetUrl, 0).then(function(child) {
            var resolved = {
              streams: [],
              subtitles: extractSubtitles(target.detailHtml, target.targetUrl)
            };
            mergeResolved(resolved, child);
            return resolved;
          });
        }
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

  return withSoftTimeout(work, 8200, "PencuriMovie provider")
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
