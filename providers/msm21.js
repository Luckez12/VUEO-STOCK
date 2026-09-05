"use strict";

var PROVIDER_NAME = "MSM21";
var BASE_URL = "https://pencurimoviesubmalay26.site";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "ms-MY,ms;q=0.9,en-US;q=0.8,en;q=0.7"
};

var currentBaseUrl = BASE_URL.replace(/\/+$/, "");
var MIRROR_CACHE = Object.create(null);
var MIRROR_CACHE_TTL_MS = 90000;

function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error((label || "Request") + " timed out"));
    }, timeoutMs);

    Promise.resolve(promise).then(
      function(value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      function(error) {
        if (done) return;
        done = true;
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
        url: String(response && response.url || url),
        status: Number(response && response.status || 0),
        headers: response && response.headers
      };
    });
  });

  return withSoftTimeout(request, timeoutMs || 1800, "MSM21 request " + url);
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

function updateBaseFromUrl(url) {
  try {
    var parsed = new URL(url);
    if (!parsed.origin) return;
    currentBaseUrl = trimSlash(parsed.origin);
  } catch (_) {}
}

function safeUrl(value, base) {
  var raw = decodeHtml(String(value || "").trim());
  if (!raw) return "";
  if (raw.indexOf("//") === 0) raw = "https:" + raw;
  try {
    return new URL(raw, base || currentBaseUrl).toString();
  } catch (_) {
    return raw;
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;|&#47;/gi, "/")
    .replace(/&#(\d+);/g, function(full, number) {
      var code = Number(number);
      return isFinite(code) ? String.fromCharCode(code) : full;
    });
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttr(tag, name) {
  var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var quoted = new RegExp("\\b" + escaped + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i");
  var match = String(tag || "").match(quoted);
  if (match) return decodeHtml(match[2]);

  var bare = new RegExp("\\b" + escaped + "\\s*=\\s*([^\\s>]+)", "i");
  match = String(tag || "").match(bare);
  return match ? decodeHtml(match[1]) : "";
}

function hasClass(tag, className) {
  var classes = getAttr(tag, "class").split(/\s+/);
  return classes.some(function(value) {
    return value.toLowerCase() === String(className || "").toLowerCase();
  });
}

function extractBalancedBlocksByClass(html, tagName, className) {
  var source = String(html || "");
  var escapedTag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var openRegex = new RegExp("<" + escapedTag + "\\b[^>]*>", "gi");
  var blocks = [];
  var open;

  while ((open = openRegex.exec(source))) {
    if (!hasClass(open[0], className)) continue;

    var start = open.index;
    var tokenRegex = new RegExp("<" + escapedTag + "\\b[^>]*>|<\\/" + escapedTag + "\\s*>", "gi");
    tokenRegex.lastIndex = openRegex.lastIndex;
    var depth = 1;
    var end = source.length;
    var token;

    while ((token = tokenRegex.exec(source))) {
      if (new RegExp("^<" + escapedTag + "\\b", "i").test(token[0])) depth += 1;
      else depth -= 1;
      if (depth === 0) {
        end = tokenRegex.lastIndex;
        break;
      }
    }

    blocks.push(source.slice(start, end));
    openRegex.lastIndex = end;
  }

  return blocks;
}

function extractBalancedBlocksByTag(html, tagName) {
  var source = String(html || "");
  var escapedTag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var openRegex = new RegExp("<" + escapedTag + "\\b[^>]*>", "gi");
  var blocks = [];
  var open;

  while ((open = openRegex.exec(source))) {
    var start = open.index;
    var tokenRegex = new RegExp("<" + escapedTag + "\\b[^>]*>|<\\/" + escapedTag + "\\s*>", "gi");
    tokenRegex.lastIndex = openRegex.lastIndex;
    var depth = 1;
    var end = source.length;
    var token;

    while ((token = tokenRegex.exec(source))) {
      if (new RegExp("^<" + escapedTag + "\\b", "i").test(token[0])) depth += 1;
      else depth -= 1;
      if (depth === 0) {
        end = tokenRegex.lastIndex;
        break;
      }
    }

    blocks.push(source.slice(start, end));
    openRegex.lastIndex = end;
  }

  return blocks;
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
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

  var leftWords = left.split(" ").filter(function(word) { return word.length > 1; });
  var rightWords = right.split(" ").filter(function(word) { return word.length > 1; });
  var set = Object.create(null);
  leftWords.forEach(function(word) { set[word] = true; });
  var matched = rightWords.filter(function(word) { return set[word]; }).length;
  if (!matched) return 0;

  var recall = matched / Math.max(rightWords.length, 1);
  var precision = matched / Math.max(leftWords.length, 1);
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

  return requestJson(url, { "Accept": "application/json" }, 1500).then(function(data) {
    return {
      tmdbId: String(tmdbId),
      title: String(data && (data.title || data.name) || ""),
      originalTitle: String(data && (data.original_title || data.original_name) || ""),
      year: String(data && (data.release_date || data.first_air_date) || "").split("-")[0]
    };
  });
}

function rewriteToCurrentDomain(url) {
  var absolute = safeUrl(url, currentBaseUrl);
  if (!absolute) return absolute;

  try {
    var target = new URL(absolute);
    var current = new URL(currentBaseUrl);
    var host = String(target.hostname || "").toLowerCase();
    var oldSite =
      host.indexOf("pencurimovie") !== -1 ||
      host.indexOf("movisubmalay") !== -1;

    if (!oldSite || !current.hostname) return absolute;

    target.protocol = current.protocol;
    target.hostname = current.hostname;
    target.port = current.port;
    return target.toString();
  } catch (_) {
    return absolute;
  }
}

function parseSearchResults(html, pageUrl) {
  var blocks = extractBalancedBlocksByClass(html, "div", "display-item");
  var results = [];
  var seen = Object.create(null);

  blocks.forEach(function(block, rank) {
    var anchorMatch = block.match(/<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>/i);
    if (!anchorMatch) return;

    var anchor = anchorMatch[0];
    var href = rewriteToCurrentDomain(safeUrl(getAttr(anchor, "href"), pageUrl));
    if (!href || seen[href]) return;

    var rawTitle = stripTags(getAttr(anchor, "title"));
    if (!rawTitle) {
      var h3 = block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
      rawTitle = h3 ? stripTags(h3[1]) : "";
    }
    if (!rawTitle) return;

    var year = "";
    var yearMatch = rawTitle.match(/\s*\(((?:19|20)\d{2})\)\s*$/);
    if (yearMatch) year = yearMatch[1];

    var title = rawTitle.replace(/\s*\(((?:19|20)\d{2})\)\s*$/, "").trim() || rawTitle;
    var ptype = String(getAttr(anchor, "data-ptype") || "").toLowerCase();
    var isSeries = ptype.indexOf("tv") !== -1 || /\/tvshows\//i.test(href);

    seen[href] = true;
    results.push({
      title: title,
      year: year,
      href: href,
      isSeries: isSeries,
      rank: rank
    });
  });

  return results;
}

function scoreCandidate(item, info, mediaType) {
  var score = Math.max(
    titleScore(item.title, info.title),
    titleScore(item.title, info.originalTitle)
  );

  if (item.year && info.year && item.year === info.year) score += 30;
  if (mediaType === "tv" && item.isSeries) score += 24;
  if (mediaType === "movie" && !item.isSeries) score += 18;
  if (mediaType === "tv" && !item.isSeries) score -= 25;
  if (mediaType === "movie" && item.isSeries) score -= 25;
  score += Math.max(0, 12 - Number(item.rank || 0));
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

function extractDetailIdentity(html) {
  var source = String(html || "");
  var title = "";

  var detailsTitle = source.match(
    /<[^>]*class\s*=\s*(["'])[^"']*\bdetails-title\b[^"']*\1[^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>/i
  );
  if (detailsTitle) title = stripTags(detailsTitle[2]);

  if (!title) {
    var og = source.match(
      /<meta\b[^>]*property\s*=\s*(["'])og:title\1[^>]*content\s*=\s*(["'])([\s\S]*?)\2[^>]*>/i
    );
    if (!og) {
      og = source.match(
        /<meta\b[^>]*content\s*=\s*(["'])([\s\S]*?)\1[^>]*property\s*=\s*(["'])og:title\3[^>]*>/i
      );
      if (og) title = decodeHtml(og[2]);
    } else {
      title = decodeHtml(og[3]);
    }
  }

  if (!title) {
    var heading = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if (heading) title = stripTags(heading[1]);
  }

  var original = source.match(/Original\s+title\s*:\s*([^<\r\n]+)/i);
  var year =
    yearFrom(title) ||
    yearFrom(original ? stripTags(original[1]) : "");

  if (!year) {
    var yearRow = source.match(
      />\s*Year\s*:\s*<\/[^>]+>[\s\S]{0,500}?<a\b[^>]*>([\s\S]*?)<\/a>/i
    );
    if (yearRow) year = yearFrom(stripTags(yearRow[1]));
  }

  return {
    title: String(title || "").replace(/\s*[-|]\s*movisubmalay.*$/i, "").trim(),
    year: year
  };
}

function isDirectPageMatch(result, info, mediaType) {
  if (!result || !result.text) return false;

  var url = String(result.url || "");
  var lowerUrl = url.toLowerCase();
  var body = String(result.text || "");

  if (mediaType === "movie" && lowerUrl.indexOf("/movies/") === -1) return false;
  if (mediaType === "tv" && lowerUrl.indexOf("/tvshows/") === -1) return false;

  /*
   * Canonical slug URLs are generated from TMDB title/year. If the site returned
   * a real detail page, do not burn several more seconds re-searching WordPress.
   */
  if (
    /(?:page not found|404 not found|nothing found)/i.test(body) ||
    body.length < 300
  ) {
    return false;
  }

  var expectedSlug = slugifyTitle(info.title);
  var pathSlug = "";
  try {
    var path = new URL(url).pathname.split("/").filter(Boolean);
    pathSlug = path.length ? path[path.length - 1] : "";
  } catch (_) {}

  if (expectedSlug && pathSlug.indexOf(expectedSlug) === 0) return true;

  var identity = extractDetailIdentity(body);
  if (!identity.title) return false;

  var score = Math.max(
    titleScore(identity.title, info.title),
    titleScore(identity.title, info.originalTitle)
  );

  if (score < 52) return false;
  if (info.year && identity.year && String(info.year) !== String(identity.year)) return false;

  return true;
}

function buildDirectCandidates(info, mediaType) {
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
        ? ["/movies/" + slug + "-" + info.year + "/", "/movies/" + slug + "/"]
        : ["/movies/" + slug + "/"];
    } else {
      paths = info.year
        ? ["/tvshows/" + slug + "/", "/tvshows/" + slug + "-" + info.year + "/"]
        : ["/tvshows/" + slug + "/"];
    }

    paths.forEach(function(path) {
      var url = trimSlash(currentBaseUrl) + path;
      if (seen[url]) return;
      seen[url] = true;
      output.push(url);
    });
  });

  return output;
}

function tryDirectTitlePage(info, mediaType) {
  var candidates = buildDirectCandidates(info, mediaType);
  if (!candidates.length) return Promise.resolve(null);

  function tryIndex(index) {
    if (index >= candidates.length) return Promise.resolve(null);

    var url = candidates[index];
    var timeoutMs = index === 0 ? 1700 : 850;

    return requestText(
      url,
      { "Referer": trimSlash(currentBaseUrl) + "/" },
      timeoutMs
    ).then(function(result) {
      updateBaseFromUrl(result.url || url);

      if (!isDirectPageMatch(result, info, mediaType)) {
        return tryIndex(index + 1);
      }

      console.log("[MSM21] direct permalink hit " + (result.url || url));
      return {
        href: result.url || url,
        title: info.title,
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

function searchSite(query) {
  var url = trimSlash(currentBaseUrl) + "/?s=" + encodeURIComponent(query);
  return requestText(url, { "Referer": trimSlash(currentBaseUrl) + "/" }, 2200)
    .then(function(result) {
      updateBaseFromUrl(result.url);
      return parseSearchResults(result.text, result.url || url);
    });
}

function findBestTitle(info, mediaType) {
  return tryDirectTitlePage(info, mediaType).then(function(direct) {
    if (direct) return direct;

    console.log("[MSM21] direct permalink miss, using WordPress search");

    return searchSite(info.title).then(function(items) {
      items.sort(function(a, b) {
        return scoreCandidate(b, info, mediaType) - scoreCandidate(a, info, mediaType);
      });

      var best = items[0];
      if (best && scoreCandidate(best, info, mediaType) >= 45) return best;

      /*
       * Only perform a second search when the first search found no usable
       * candidate. This avoids doubling the slow WordPress search path.
       */
      if (
        !best &&
        info.originalTitle &&
        normalizeTitle(info.originalTitle) !== normalizeTitle(info.title)
      ) {
        return searchSite(info.originalTitle).then(function(extra) {
          extra.sort(function(a, b) {
            return scoreCandidate(b, info, mediaType) - scoreCandidate(a, info, mediaType);
          });
          return extra[0] || null;
        });
      }

      return best || null;
    });
  }).then(function(best) {
    if (!best) throw new Error("MSM21 title not found");

    if (!best.__detailHtml && scoreCandidate(best, info, mediaType) < 30) {
      throw new Error("MSM21 match confidence too low");
    }

    return best;
  });
}

function parseEpisodeTarget(html, pageUrl, season, episode) {
  var requestedSeason = Number(season || 1);
  var requestedEpisode = Number(episode || 1);
  var lists = extractBalancedBlocksByClass(html, "ul", "episodes-list");
  var candidates = [];

  lists.forEach(function(list) {
    var openTag = (list.match(/^<ul\b[^>]*>/i) || [])[0] || "";
    var listId = getAttr(openTag, "id");
    var seasonMatch = String(listId || "").match(/-(\d+)\s*$/);
    var seasonNumber = seasonMatch ? Number(seasonMatch[1]) : 1;

    var anchorRegex = /<a\b[^>]*href\s*=\s*(["'])[\s\S]*?\1[^>]*>[\s\S]*?<\/a>/gi;
    var anchor;
    while ((anchor = anchorRegex.exec(list))) {
      var full = anchor[0];
      var tag = (full.match(/<a\b[^>]*>/i) || [])[0] || "";
      var href = rewriteToCurrentDomain(safeUrl(getAttr(tag, "href"), pageUrl));
      if (!href) continue;

      var epClass = full.match(
        /<[^>]*class\s*=\s*(["'])[^"']*\bep-num\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i
      );
      var epText = epClass ? stripTags(epClass[2]) : stripTags(full);
      var epMatch = epText.match(/\d+/);
      if (!epMatch) continue;

      candidates.push({
        season: seasonNumber,
        episode: Number(epMatch[0]),
        href: href
      });
    }
  });

  var exact = candidates.find(function(item) {
    return item.season === requestedSeason && item.episode === requestedEpisode;
  });

  if (!exact && requestedSeason === 1) {
    exact = candidates.find(function(item) {
      return item.episode === requestedEpisode;
    });
  }

  if (!exact) {
    throw new Error(
      "MSM21 episode S" + requestedSeason + "E" + requestedEpisode + " not found"
    );
  }

  return exact.href;
}

function parsePlayerOptions(html) {
  var source = String(html || "");
  var output = [];
  var regex = /<li\b[^>]*class\s*=\s*(["'])[^"']*\bzetaflix_player_option\b[^"']*\1[^>]*>[\s\S]*?<\/li>/gi;
  var match;

  while ((match = regex.exec(source))) {
    var block = match[0];
    var open = (block.match(/<li\b[^>]*>/i) || [])[0] || "";
    var nume = String(getAttr(open, "data-nume") || "").trim();
    if (!nume || nume.toLowerCase() === "fake") continue;

    var post = String(getAttr(open, "data-post") || "").trim();
    var type = String(getAttr(open, "data-type") || "").trim();
    if (!post || !type) continue;

    var titleMatch = block.match(
      /<[^>]*class\s*=\s*(["'])[^"']*\bopt-titl\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i
    );
    var nameMatch = block.match(
      /<[^>]*class\s*=\s*(["'])[^"']*\bopt-name\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i
    );

    var label = [
      titleMatch ? stripTags(titleMatch[2]) : "",
      nameMatch ? stripTags(nameMatch[2]) : ""
    ].filter(Boolean).join(" ").trim();

    output.push({
      post: post,
      nume: nume,
      type: type,
      label: label || ("Server " + nume)
    });
  }

  return output;
}

var FAST_HINTS = ["fire", "wish", "byse", "mix", "dsv", "dood", "hgl", "playm", "voe"];

function isFastOption(option) {
  var value = String(option && option.label || "").toLowerCase();
  return FAST_HINTS.some(function(hint) { return value.indexOf(hint) !== -1; });
}

function fastPriority(option) {
  var value = String(option && option.label || "").toLowerCase();
  if (value.indexOf("fire") !== -1 || value.indexOf("wish") !== -1 || value.indexOf("hgl") !== -1) return 0;
  if (value.indexOf("playm") !== -1) return 1;
  if (value.indexOf("byse") !== -1) return 2;
  if (value.indexOf("voe") !== -1) return 3;
  if (value.indexOf("mix") !== -1) return 4;
  if (value.indexOf("dsv") !== -1 || value.indexOf("dood") !== -1) return 5;
  return 6;
}

function fallbackPriority(option) {
  var value = String(option && option.label || "").toLowerCase();
  if (value.indexOf("full hd") !== -1 || value.indexOf("server full") !== -1) return 0;
  if (value.indexOf("abyss") !== -1) return 1;
  if (value.indexOf("veev") !== -1) return 2;
  if (value.indexOf("player") !== -1 || value.indexOf("ezpla") !== -1 || value.indexOf("playe") !== -1) return 3;
  return 4;
}

function cacheKey(option, pageUrl) {
  return [pageUrl, option.post, option.nume, option.type].join("|");
}

function getCachedMirrors(key) {
  var entry = MIRROR_CACHE[key];
  if (!entry) return null;
  if (entry.expiresAt > Date.now()) return entry.mirrors;
  delete MIRROR_CACHE[key];
  return null;
}

function putCachedMirrors(key, mirrors) {
  MIRROR_CACHE[key] = {
    expiresAt: Date.now() + MIRROR_CACHE_TTL_MS,
    mirrors: mirrors
  };
}

function normaliseEmbedUrl(raw, pageUrl) {
  var cleaned = decodeHtml(String(raw || ""))
    .trim()
    .replace(/\\\//g, "/")
    .replace(/^["']|["']$/g, "");

  if (!cleaned || cleaned.charAt(0) === "#" || /^javascript:/i.test(cleaned)) return "";

  var resolved = safeUrl(cleaned, pageUrl);
  if (!/^https?:\/\//i.test(resolved)) return "";

  var lower = resolved.toLowerCase();
  var blocked = [
    "youtube.com", "youtu.be", "googlesyndication", "googletagmanager",
    "doubleclick.net", "google-analytics", "facebook.com", "telegram.me",
    "t.me/", "algiersreests", "morestamping", "decafeligiblyhad"
  ];
  if (blocked.some(function(part) { return lower.indexOf(part) !== -1; })) return "";

  return resolved;
}

function extractEmbedUrls(embedHtml, pageUrl) {
  var html = String(embedHtml || "").trim();
  if (!html) return [];

  var found = [];
  var seen = Object.create(null);

  function add(raw) {
    var resolved = normaliseEmbedUrl(raw, pageUrl);
    if (!resolved || seen[resolved]) return;
    seen[resolved] = true;
    found.push(resolved);
  }

  if (/^https?:\/\//i.test(html)) add(html);

  var tagRegex = /<(?:iframe|video|source)\b[^>]*>/gi;
  var tag;
  while ((tag = tagRegex.exec(html))) {
    add(
      getAttr(tag[0], "data-src") ||
      getAttr(tag[0], "src")
    );
  }

  if (!found.length) {
    var urlRegex = /https?:\/\/[^\s"'<>]+/gi;
    var url;
    while ((url = urlRegex.exec(html.replace(/\\\//g, "/")))) add(url[0]);
  }

  return found;
}

function fetchMirrors(option, pageUrl) {
  var key = cacheKey(option, pageUrl);
  var cached = getCachedMirrors(key);
  if (cached) return Promise.resolve(cached);

  var ajaxUrl = trimSlash(currentBaseUrl) + "/wp-admin/admin-ajax.php";
  return requestPostForm(
    ajaxUrl,
    {
      action: "zeta_player_ajax",
      post: option.post,
      nume: option.nume,
      type: option.type
    },
    {
      "Referer": pageUrl,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": USER_AGENT
    },
    1800
  ).then(function(result) {
    var payload = null;
    try {
      payload = JSON.parse(result.text);
    } catch (_) {}

    var embedHtml =
      payload && (payload.embed_url || payload.embedUrl) ||
      result.text ||
      "";

    var mirrors = extractEmbedUrls(embedHtml, pageUrl).map(function(url) {
      return { url: url, label: option.label };
    });

    if (mirrors.length) putCachedMirrors(key, mirrors);
    return mirrors;
  }).catch(function(error) {
    console.log(
      "[MSM21] AJAX failed server=" + option.label +
      " error=" + (error && error.message ? error.message : String(error))
    );
    return [];
  });
}

function collectStaticMirrors(html, pageUrl) {
  var mirrors = [];
  var seen = Object.create(null);

  function add(raw, label) {
    var url = normaliseEmbedUrl(raw, pageUrl);
    if (!url || seen[url]) return;
    seen[url] = true;
    mirrors.push({ url: url, label: label || "MSM21" });
  }

  var source = String(html || "");

  var tagRegex = /<(?:iframe|video|source)\b[^>]*>/gi;
  var match;
  while ((match = tagRegex.exec(source))) {
    add(
      getAttr(match[0], "data-src") || getAttr(match[0], "src"),
      "MSM21 Static"
    );
  }

  /*
   * Some current movie pages expose the loaded Full HD player as a normal
   * anchor rather than only as a player option.
   */
  var anchorRegex = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  var anchor;
  while ((anchor = anchorRegex.exec(source))) {
    var href = anchor[2];
    var label = stripTags(anchor[3]);
    var lower = String(href || "").toLowerCase();

    if (
      /(?:palankyurok|player|embed|abyss|ezpla|seekp|p2pst|upns)/i.test(lower) ||
      /(?:full\s*hd|server\s*full|^\s*hd\s*$)/i.test(label)
    ) {
      add(href, label || "MSM21 Full HD");
    }
  }

  return mirrors;
}

function firstNonEmpty(tasks, timeoutMs) {
  return new Promise(function(resolve) {
    if (!tasks || !tasks.length) {
      resolve({ streams: [], subtitles: [] });
      return;
    }

    var done = false;
    var remaining = tasks.length;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      resolve({ streams: [], subtitles: [] });
    }, timeoutMs);

    tasks.forEach(function(task) {
      Promise.resolve(task).then(
        function(result) {
          if (done) return;
          var count = result && Array.isArray(result.streams) ? result.streams.length : 0;
          remaining -= 1;
          if (count > 0) {
            done = true;
            clearTimeout(timer);
            resolve(result);
          } else if (remaining <= 0) {
            done = true;
            clearTimeout(timer);
            resolve({ streams: [], subtitles: [] });
          }
        },
        function() {
          if (done) return;
          remaining -= 1;
          if (remaining <= 0) {
            done = true;
            clearTimeout(timer);
            resolve({ streams: [], subtitles: [] });
          }
        }
      );
    });
  });
}

function unescapeScriptText(value) {
  return decodeHtml(String(value || ""))
    .replace(/\\u003a/gi, ":")
    .replace(/\\x3a/gi, ":")
    .replace(/\\u002f/gi, "/")
    .replace(/\\x2f/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\x26/gi, "&")
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
    label || "MSM21 extractor request"
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
  }, timeoutMs || 2200, "MSM21 POST " + url);
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


function decodeBase64Loose(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";

  try {
    if (typeof atob === "function") return atob(raw);
  } catch (_) {}

  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(raw, "base64").toString("utf8");
    }
  } catch (_) {}

  return "";
}

function extractBrowserPlayerMedia(text, baseUrl) {
  var source = unpackPackedScripts(unescapeScriptText(text));
  var found = [];
  var seen = Object.create(null);

  function add(raw, label) {
    var value = unescapeScriptText(String(raw || "")).trim();
    if (!value) return;

    var url = safeUrl(value, baseUrl);
    if (!url || seen[url] || !isDirectMedia(url)) return;

    seen[url] = true;
    found.push({
      url: url,
      quality: inferQuality(url, label || "")
    });
  }

  var patterns = [
    /\b(?:file|src|source|url|video_url|videoUrl|hls_url|hlsUrl)\s*[:=]\s*(["'])(.*?)\1/gi,
    /\bloadSource\s*\(\s*(["'])(.*?)\1\s*\)/gi,
    /\bsetAttribute\s*\(\s*(["'])src\1\s*,\s*(["'])(.*?)\2\s*\)/gi
  ];

  patterns.forEach(function(regex) {
    var match;
    while ((match = regex.exec(source))) {
      add(match[match.length - 1], match[0]);
    }
  });

  /*
   * PlayerX/Abyss variants often keep the media URL inside atob() or a JSON
   * blob. Decode likely base64 strings and rescan only when the decoded text
   * actually looks like a URL/player config.
   */
  var base64Regex = /(?:atob\s*\(\s*)?(["'])([A-Za-z0-9+/_=-]{48,})\1\s*\)?/g;
  var encoded;
  while ((encoded = base64Regex.exec(source))) {
    var decoded = decodeBase64Loose(
      String(encoded[2] || "").replace(/-/g, "+").replace(/_/g, "/")
    );
    if (!decoded || !/(?:https?:|m3u8|mp4|file|source)/i.test(decoded)) continue;

    extractDirectMedia(decoded, baseUrl).forEach(function(item) {
      add(item.url, item.quality);
    });

    var inner = decoded.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi) || [];
    inner.forEach(function(url) { add(url, ""); });
  }

  return found;
}

function extractJwPlayerMedia(text, baseUrl) {
  var source = unpackPackedScripts(unescapeScriptText(text));
  var found = extractDirectMedia(source, baseUrl);
  extractBrowserPlayerMedia(source, baseUrl).forEach(function(item) {
    if (!found.some(function(existing) { return existing.url === item.url; })) {
      found.push(item);
    }
  });
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
 * selector closely enough for the MSM21 server tabs.
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
  }, 1400, "MSM21 redirect " + absolute).then(function(result) {
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
  "ds2play.com", "ds2video.com", "vide0.net", "myvidplay.com", "playmogo.com", "dsvplay.com"
];
var MIXDROP_DOMAINS = [
  "mixdrop.co", "mixdrop.bz", "mixdrop.ch", "mixdrop.to",
  "mixdrop.si", "mixdrop.ps", "mixdrop.ag", "mixdrop.top"
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
  if (host === "bysesukior.com" || host.slice(-16) === ".bysesukior.com") return "ByseSX";
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
  console.log("[MSM21] extractor=" + name + " host=" + hostOf(url));

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
  else if (name === "ByseSX") work = extractGenericHost(url, referer, depth || 0);
  else if (name === "BrowserPlayer") work = extractGenericHost(url, referer, depth || 0);
  else work = extractGenericHost(url, referer, depth || 0);

  return Promise.resolve(work).then(function(resolved) {
    var streams = resolved && Array.isArray(resolved.streams) ? resolved.streams.length : 0;
    console.log("[MSM21] " + name + " streams=" + streams);

    /*
     * A recognised host can change its frontend. If the specific extraction
     * produced nothing, try the generic packed/JWPlayer parser before giving up.
     */
    if (streams || name === "Generic") return resolved || emptyResolved();

    return extractGenericHost(url, referer, 1).catch(function() {
      return resolved || emptyResolved();
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

  return followRedirectCloudstream(absolute, referer).then(function(finalUrl) {
    finalUrl = finalUrl || absolute;
    console.log(
      "[MSM21] iframe=" + hostOf(absolute) +
      (finalUrl !== absolute ? " redirect=" + hostOf(finalUrl) : "")
    );
    return dispatchExtractor(finalUrl, referer || absolute, depth || 0);
  });
}



function attachMirrorLabel(resolved, mirror) {
  var output = resolved || { streams: [], subtitles: [] };
  output.streams = (output.streams || []).map(function(stream) {
    var copy = Object.assign({}, stream);
    copy.serverLabel = mirror.label || PROVIDER_NAME;
    return copy;
  });
  return output;
}

function resolveMirror(mirror, pageUrl) {
  return loadExtractorEquivalent(mirror.url, pageUrl, 0)
    .then(function(resolved) {
      return attachMirrorLabel(resolved, mirror);
    })
    .catch(function(error) {
      console.log(
        "[MSM21] extractor failed server=" + mirror.label +
        " host=" + hostOf(mirror.url) +
        " error=" + (error && error.message ? error.message : String(error))
      );
      return { streams: [], subtitles: [] };
    });
}

function resolveOption(option, pageUrl) {
  return fetchMirrors(option, pageUrl).then(function(mirrors) {
    if (!mirrors.length) return { streams: [], subtitles: [] };
    return firstNonEmpty(
      mirrors.slice(0, 3).map(function(mirror) {
        return resolveMirror(mirror, pageUrl);
      }),
      2900
    );
  });
}

function resolvePlayback(html, pageUrl) {
  var options = parsePlayerOptions(html);
  var staticMirrors = collectStaticMirrors(html, pageUrl);

  console.log(
    "[MSM21] options=" +
    options.map(function(option) { return option.label; }).join(" | ")
  );

  if (staticMirrors.length) {
    console.log(
      "[MSM21] static mirrors=" +
      staticMirrors.map(function(mirror) { return hostOf(mirror.url); }).join(" | ")
    );
  }

  /*
   * VUEO has no Android WebView. The live page often already contains a loaded
   * Full HD/static player, so try that before the Zeta options that Cloudstream
   * would otherwise hand to its WebView probe.
   */
  var staticPromise = staticMirrors.length
    ? firstNonEmpty(
        staticMirrors.slice(0, 3).map(function(mirror) {
          return resolveMirror(mirror, pageUrl);
        }),
        2500
      )
    : Promise.resolve({ streams: [], subtitles: [] });

  return staticPromise.then(function(staticResult) {
    if (staticResult.streams && staticResult.streams.length) return staticResult;

    if (!options.length) {
      return { streams: [], subtitles: [] };
    }

    var fast = options
      .filter(isFastOption)
      .sort(function(a, b) { return fastPriority(a) - fastPriority(b); })
      .slice(0, 8);

    var preferredFallback = options
      .slice()
      .sort(function(a, b) { return fallbackPriority(a) - fallbackPriority(b); })
      .slice(0, 6);

    var candidates = [];
    var seen = Object.create(null);

    fast.concat(preferredFallback).forEach(function(option) {
      var key = [option.post, option.nume, option.type].join("|");
      if (seen[key]) return;
      seen[key] = true;
      candidates.push(option);
    });

    return firstNonEmpty(
      candidates.map(function(option) {
        return resolveOption(option, pageUrl);
      }),
      3800
    );
  });
}

function buildStreams(resolved, info, mediaType, season, episode) {
  var subtitles = resolved && Array.isArray(resolved.subtitles)
    ? resolved.subtitles
    : [];
  var sources = resolved && Array.isArray(resolved.streams)
    ? resolved.streams
    : [];

  var seen = Object.create(null);
  var episodeLabel =
    mediaType === "tv"
      ? " S" + String(season || 1).padStart(2, "0") +
        "E" + String(episode || 1).padStart(2, "0")
      : "";

  return sources.map(function(source, index) {
    if (!source || !source.url || seen[source.url]) return null;
    seen[source.url] = true;

    var referer = source.referer || currentBaseUrl + "/";
    var server = source.serverLabel || PROVIDER_NAME;

    return {
      name: PROVIDER_NAME + " " + server,
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
  var info;

  console.log(
    "[MSM21] Request tmdbId=" + tmdbId +
    " type=" + type +
    (type === "tv" ? " S" + requestedSeason + "E" + requestedEpisode : "")
  );

  var work = getTmdbInfo(tmdbId, type)
    .then(function(value) {
      info = value;
      if (!info.title) throw new Error("TMDB title is empty");
      return findBestTitle(info, type);
    })
    .then(function(match) {
      var detailUrl = rewriteToCurrentDomain(match.href);

      var detailPromise = match.__detailHtml
        ? Promise.resolve({
            text: match.__detailHtml,
            url: detailUrl
          })
        : requestText(
            detailUrl,
            { "Referer": currentBaseUrl + "/" },
            1800
          );

      return detailPromise.then(function(detail) {
        updateBaseFromUrl(detail.url || detailUrl);

        var targetUrl =
          type === "tv"
            ? parseEpisodeTarget(
                detail.text,
                detail.url || detailUrl,
                requestedSeason,
                requestedEpisode
              )
            : (detail.url || detailUrl);

        if (type === "movie") {
          return {
            html: detail.text,
            url: targetUrl
          };
        }

        return requestText(
          targetUrl,
          { "Referer": detail.url || detailUrl },
          1700
        ).then(function(episodePage) {
          updateBaseFromUrl(episodePage.url || targetUrl);
          return {
            html: episodePage.text,
            url: episodePage.url || targetUrl
          };
        });
      });
    })
    .then(function(playbackPage) {
      return resolvePlayback(playbackPage.html, playbackPage.url);
    })
    .then(function(resolved) {
      var streams = buildStreams(
        resolved,
        info,
        type,
        type === "tv" ? requestedSeason : null,
        type === "tv" ? requestedEpisode : null
      );

      console.log("[MSM21] Direct streams found=" + streams.length);
      return streams;
    });

  return withSoftTimeout(work, 8200, "MSM21 provider")
    .catch(function(error) {
      console.error(
        "[MSM21] " +
        (error && error.message ? error.message : String(error))
      );
      return [];
    });
}

module.exports = {
  getStreams: getStreams
};
