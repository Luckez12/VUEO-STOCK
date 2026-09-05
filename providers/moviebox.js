"use strict";

var PROVIDER_NAME = "MovieBox";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var WEB_HOSTS = [
  "https://moviebox.ph",
  "https://moviebox.pk",
  "https://moviebox.ng",
  "https://filmboom.top"
];

var MOVIEBOX_WEB = "https://moviebox.asia";
var VIDEOEASY_BASE = "https://player.videasy.to";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var COMMON_HEADERS = {
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Client-Info": "{\"timezone\":\"Asia/Kuala_Lumpur\"}",
  "User-Agent": USER_AGENT
};

var PROVIDER_BUDGET_MS = 19000;
var DIRECT_PLAYER_MS = 6500;
var SEARCH_RACE_MS = 4200;
var PLAY_RACE_MS = 5200;
var CAPTION_RACE_MS = 2200;

var preferredWebHost = null;

function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function(resolve, reject) {
    var settled = false;
    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      reject(new Error((label || "Operation") + " timed out"));
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

function raceFirstValid(tasks, timeoutMs, label) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return Promise.resolve(null);
  }

  return new Promise(function(resolve) {
    var settled = false;
    var pending = tasks.length;

    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(value || null);
    }

    tasks.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          if (settled) return;
          if (value) {
            finish(value);
            return;
          }
          pending -= 1;
          if (pending <= 0) finish(null);
        })
        .catch(function() {
          pending -= 1;
          if (pending <= 0) finish(null);
        });
    });

    setTimeout(function() {
      if (!settled) {
        console.log("[MovieBox] " + (label || "race") + " reached " + timeoutMs + "ms");
        finish(null);
      }
    }, timeoutMs);
  });
}

function fetchJson(url, options, timeoutMs, label) {
  var opts = options || {};
  var headers = Object.assign({}, COMMON_HEADERS, opts.headers || {});
  var fetchOptions = {
    method: opts.method || "GET",
    headers: headers,
    redirect: "follow"
  };

  if (opts.body !== undefined) {
    fetchOptions.body = opts.body;
  }

  return withSoftTimeout(
    fetch(url, fetchOptions).then(function(response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " for " + url);
      }
      return response.json();
    }),
    timeoutMs || 3200,
    label || "MovieBox request"
  );
}

function getTmdbInfo(tmdbId, mediaType) {
  var endpoint = mediaType === "tv" ? "tv" : "movie";
  var url =
    "https://api.themoviedb.org/3/" +
    endpoint +
    "/" +
    encodeURIComponent(tmdbId) +
    "?api_key=" +
    TMDB_API_KEY;

  return fetchJson(
    url,
    { headers: { "Accept": "application/json" } },
    1300,
    "TMDB"
  ).then(function(data) {
    return {
      title: String(data && (data.title || data.name) || "").trim(),
      originalTitle: String(
        data && (data.original_title || data.original_name) || ""
      ).trim(),
      year: String(
        data && (data.release_date || data.first_air_date) || ""
      ).split("-")[0]
    };
  });
}

function normalizeTitle(value) {
  var text = String(value || "").toLowerCase();

  try {
    if (typeof text.normalize === "function") {
      text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    }
  } catch (_) {}

  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(candidate, expected) {
  var left = normalizeTitle(candidate);
  var right = normalizeTitle(expected);

  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.indexOf(right) !== -1 || right.indexOf(left) !== -1) return 80;

  var leftWords = left.split(" ").filter(function(x) { return x.length > 1; });
  var rightWords = right.split(" ").filter(function(x) { return x.length > 1; });

  if (!leftWords.length || !rightWords.length) return 0;

  var set = {};
  leftWords.forEach(function(word) { set[word] = true; });

  var matched = rightWords.filter(function(word) { return set[word]; }).length;
  if (!matched) return 0;

  return Math.round(
    (
      (matched / rightWords.length) * 0.75 +
      (matched / leftWords.length) * 0.25
    ) * 70
  );
}

function itemYear(item) {
  var raw = String(
    item &&
    (
      item.releaseDate ||
      item.release_date ||
      item.year ||
      item.firstAirDate ||
      item.first_air_date
    ) ||
    ""
  );

  var match = raw.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

function subjectTypeMatches(item, mediaType) {
  var value = Number(
    item &&
    (
      item.subjectType !== undefined
        ? item.subjectType
        : item.subject_type
    )
  );

  if (!value) return true;
  return mediaType === "movie" ? value === 1 : value !== 1;
}

function extractSearchItems(payload) {
  var data =
    payload && payload.data && typeof payload.data === "object"
      ? payload.data
      : {};

  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.subjectList)) return data.subjectList;

  if (Array.isArray(data.results)) {
    var flat = [];
    data.results.forEach(function(group) {
      if (group && Array.isArray(group.subjects)) {
        group.subjects.forEach(function(item) { flat.push(item); });
      }
    });
    return flat;
  }

  return [];
}

function pickBestCandidate(items, info, mediaType) {
  if (!Array.isArray(items) || !items.length) return null;

  var scored = items
    .map(function(item, index) {
      var score = Math.max(
        titleScore(item && item.title, info.title),
        titleScore(item && item.title, info.originalTitle)
      );

      var year = itemYear(item);

      if (info.year && year) {
        if (String(info.year) === String(year)) score += 28;
        else score -= 24;
      }

      if (subjectTypeMatches(item, mediaType)) score += 18;
      else score -= 70;

      score += Math.max(0, 8 - index);

      return { item: item, score: score };
    })
    .filter(function(entry) {
      return entry.item && entry.item.subjectId;
    })
    .sort(function(a, b) {
      return b.score - a.score;
    });

  if (!scored.length) return null;

  /*
   * Do not reproduce the old strict confidence bug.
   * The Cloudstream provider itself does not apply a confidence threshold.
   * We only reject a candidate when it has effectively no title relationship.
   */
  if (scored[0].score < 18) return null;

  return scored[0];
}

function orderedHosts(seedHost) {
  var result = [];

  function add(host) {
    var value = String(host || "").replace(/\/+$/, "");
    if (!value || result.indexOf(value) !== -1) return;
    result.push(value);
  }

  add(seedHost);
  add(preferredWebHost);
  WEB_HOSTS.forEach(add);

  return result;
}

function nativeWebViewAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function isMediaUrl(url) {
  var value = String(url || "").toLowerCase();
  return (
    value.indexOf(".m3u8") !== -1 ||
    value.indexOf(".mp4") !== -1 ||
    value.indexOf(".m4v") !== -1 ||
    value.indexOf("/sora/") !== -1
  );
}

function inferQuality(url, label) {
  var value = (String(label || "") + " " + String(url || "")).toLowerCase();

  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) return "2160p";
  if (value.indexOf("1440") !== -1) return "1440p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return "Auto";
}

function sanitiseHeaders(input, referer) {
  var output = {};
  var source = input && typeof input === "object" ? input : {};

  Object.keys(source).forEach(function(key) {
    var lower = String(key || "").toLowerCase();

    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "accept-encoding" ||
      lower === "range" ||
      lower === "origin" ||
      lower.indexOf("sec-fetch-") === 0
    ) {
      return;
    }

    output[key] = String(source[key]);
  });

  output["User-Agent"] =
    output["User-Agent"] ||
    output["user-agent"] ||
    USER_AGENT;

  output["Referer"] = referer;
  delete output["referer"];

  return output;
}

function buildCurrentPlayerUrl(mediaType, tmdbId, season, episode) {
  if (mediaType === "tv") {
    return (
      VIDEOEASY_BASE +
      "/tv/" +
      encodeURIComponent(tmdbId) +
      "/" +
      encodeURIComponent(season || 1) +
      "/" +
      encodeURIComponent(episode || 1)
    );
  }

  return VIDEOEASY_BASE + "/movie/" + encodeURIComponent(tmdbId);
}

function resolveCurrentMovieBoxPlayer(tmdbId, mediaType, season, episode) {
  if (!nativeWebViewAvailable()) {
    return Promise.resolve([]);
  }

  var playerUrl = buildCurrentPlayerUrl(
    mediaType,
    tmdbId,
    season,
    episode
  );

  console.log("[MovieBox] Direct current player=" + playerUrl);

  return globalThis.webviewResolve(playerUrl, {
    referer:
      MOVIEBOX_WEB +
      "/watch/" +
      mediaType +
      "/" +
      encodeURIComponent(tmdbId) +
      "/",
    directLoad: true,
    timeoutMs: DIRECT_PLAYER_MS,
    finishAfterFirstMs: 500,
    suppressPopups: true,
    lockMainFrameHost: false,
    interactionTexts: [
      "play",
      "continue",
      "watch",
      "skip",
      "close"
    ],
    clickDelaysMs: [
      500,
      1200,
      2300,
      3800,
      5200
    ],
    match: [
      ".m3u8",
      ".mp4",
      ".m4v",
      "/sora/"
    ],
    blocked: [
      "doubleclick",
      "googlesyndication",
      "/vast"
    ],
    injectAbyssHook: true
  }).then(function(result) {
    var captured =
      result && Array.isArray(result.streams)
        ? result.streams
        : [];

    var seen = {};

    var streams = captured
      .filter(function(item) {
        return item && item.url && isMediaUrl(item.url);
      })
      .filter(function(item) {
        var url = String(item.url);
        if (seen[url]) return false;
        seen[url] = true;
        return true;
      })
      .map(function(item, index) {
        var url = String(item.url);

        return {
          name:
            PROVIDER_NAME +
            " Zen" +
            (index > 0 ? " " + (index + 1) : ""),
          title: PROVIDER_NAME,
          url: url,
          quality: inferQuality(url, item.label),
          type: "direct",
          subtitles: [],
          headers: sanitiseHeaders(
            item.headers,
            playerUrl
          )
        };
      });

    streams.sort(function(a, b) {
      var qa = parseInt(String(a.quality), 10) || 0;
      var qb = parseInt(String(b.quality), 10) || 0;
      return qb - qa;
    });

    console.log("[MovieBox] Current player streams=" + streams.length);
    return streams;
  }).catch(function(error) {
    console.log(
      "[MovieBox] Current player failed: " +
      (error && error.message ? error.message : String(error))
    );
    return [];
  });
}

function searchOneHost(host, query) {
  var url = host + "/wefeed-h5-bff/web/subject/search";
  var body = JSON.stringify({
    keyword: String(query || "").trim(),
    page: 1,
    perPage: 24,
    subjectType: 0
  });

  return fetchJson(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Referer": host + "/"
      },
      body: body
    },
    3200,
    "MovieBox search " + host
  ).then(function(payload) {
    var items = extractSearchItems(payload);
    return items.length
      ? { host: host, items: items }
      : null;
  });
}

function raceSearchHostsRaw(query) {
  var hosts = orderedHosts();

  return raceFirstValid(
    hosts.map(function(host) {
      return searchOneHost(host, query);
    }),
    SEARCH_RACE_MS,
    "search"
  );
}

function searchBestCandidate(info, mediaType) {
  return raceSearchHostsRaw(info.title).then(function(result) {
    if (!result) return null;

    var best = pickBestCandidate(result.items, info, mediaType);
    if (best) {
      preferredWebHost = result.host;
      return {
        host: result.host,
        item: best.item,
        score: best.score
      };
    }

    if (
      info.originalTitle &&
      normalizeTitle(info.originalTitle) !== normalizeTitle(info.title)
    ) {
      return raceSearchHostsRaw(info.originalTitle).then(function(extra) {
        if (!extra) return null;

        var second = pickBestCandidate(extra.items, info, mediaType);
        if (!second) return null;

        preferredWebHost = extra.host;
        return {
          host: extra.host,
          item: second.item,
          score: second.score
        };
      });
    }

    return null;
  });
}

function extractStreams(payload) {
  var data =
    payload && payload.data && typeof payload.data === "object"
      ? payload.data
      : {};

  if (Array.isArray(data.streams)) return data.streams;

  if (
    data.playInfo &&
    Array.isArray(data.playInfo.streams)
  ) {
    return data.playInfo.streams;
  }

  return [];
}

function buildPlayReferer(host, item, subjectId) {
  var detailPath = String(
    item && (item.detailPath || item.detail_path) || ""
  )
    .trim()
    .replace(/^\/+/, "");

  if (!detailPath) return host + "/";

  return (
    host +
    "/spa/videoPlayPage/movies/" +
    detailPath +
    "?id=" +
    encodeURIComponent(subjectId) +
    "&type=/movie/detail&lang=en"
  );
}

function racePlayHosts(item, mediaType, season, episode, seedHost) {
  var subjectId = String(item && item.subjectId || "").trim();
  if (!subjectId) return Promise.resolve(null);

  var requestedSeason = mediaType === "tv" ? Number(season || 1) : 0;
  var requestedEpisode = mediaType === "tv" ? Number(episode || 1) : 0;

  return raceFirstValid(
    orderedHosts(seedHost).map(function(host) {
      var referer = buildPlayReferer(host, item, subjectId);
      var url =
        host +
        "/wefeed-h5-bff/web/subject/play" +
        "?subjectId=" +
        encodeURIComponent(subjectId) +
        "&se=" +
        encodeURIComponent(requestedSeason) +
        "&ep=" +
        encodeURIComponent(requestedEpisode);

      return fetchJson(
        url,
        { headers: { "Referer": referer } },
        4300,
        "MovieBox play " + host
      ).then(function(payload) {
        var streams = extractStreams(payload)
          .filter(function(source) {
            return source && String(source.url || "").trim();
          });

        if (!streams.length) return null;

        return {
          host: host,
          referer: referer,
          subjectId: subjectId,
          streams: streams
        };
      });
    }),
    PLAY_RACE_MS,
    "play"
  );
}

function subtitleLanguage(caption) {
  var values = [
    caption && caption.lan,
    caption && caption.lanName
  ]
    .filter(Boolean)
    .map(function(value) {
      return String(value)
        .trim()
        .toLowerCase()
        .replace(/_/g, "-")
        .replace(/\s+/g, " ");
    });

  function contains(names) {
    return values.some(function(value) {
      return names.some(function(name) {
        return value === name || value.indexOf(name) !== -1;
      });
    });
  }

  if (contains(["ms", "msa", "may", "malay", "bahasa melayu", "bahasa malaysia"])) {
    return { code: "ms", label: "Malay" };
  }

  if (contains(["en", "eng", "english"])) {
    return { code: "en", label: "English" };
  }

  if (contains(["id", "ind", "indonesian", "bahasa indonesia"])) {
    return { code: "id", label: "Indonesian" };
  }

  return null;
}

function raceCaptions(playResult) {
  var seed = playResult.streams.find(function(source) {
    return source && source.id && source.format;
  });

  if (!seed) return Promise.resolve([]);

  return raceFirstValid(
    orderedHosts(playResult.host).map(function(host) {
      var url =
        host +
        "/wefeed-h5-bff/web/subject/caption" +
        "?format=" +
        encodeURIComponent(seed.format) +
        "&id=" +
        encodeURIComponent(seed.id) +
        "&subjectId=" +
        encodeURIComponent(playResult.subjectId);

      return fetchJson(
        url,
        { headers: { "Referer": host + "/" } },
        1900,
        "MovieBox captions " + host
      ).then(function(payload) {
        var data =
          payload && payload.data && typeof payload.data === "object"
            ? payload.data
            : {};

        var captions = Array.isArray(data.captions)
          ? data.captions
          : [];

        var usable = captions.filter(function(caption) {
          return caption && caption.url && subtitleLanguage(caption);
        });

        return usable.length ? usable : null;
      });
    }),
    CAPTION_RACE_MS,
    "captions"
  ).then(function(result) {
    return result || [];
  });
}

function buildH5Streams(playResult, captions, info, mediaType, season, episode) {
  var subtitles = [];
  var subtitleSeen = {};

  captions.forEach(function(caption) {
    var url = String(caption.url || "").trim();
    var language = subtitleLanguage(caption);

    if (!url || !language || subtitleSeen[url]) return;
    subtitleSeen[url] = true;

    subtitles.push({
      label: language.label,
      language: language.label,
      lang: language.code,
      url: url,
      default: false,
      format:
        url.toLowerCase().indexOf(".srt") !== -1
          ? "srt"
          : url.toLowerCase().indexOf(".vtt") !== -1
            ? "vtt"
            : ""
    });
  });

  var suffix =
    mediaType === "tv"
      ? " S" +
        String(season || 1).padStart(2, "0") +
        "E" +
        String(episode || 1).padStart(2, "0")
      : "";

  var seen = {};

  return playResult.streams
    .slice()
    .sort(function(a, b) {
      var qa = parseInt(String(a && a.resolutions || ""), 10) || 0;
      var qb = parseInt(String(b && b.resolutions || ""), 10) || 0;
      return qb - qa;
    })
    .map(function(source) {
      var url = String(source && source.url || "").trim();
      if (!url || seen[url]) return null;
      seen[url] = true;

      var quality = inferQuality(
        url,
        source && (
          source.resolutions ||
          source.resolution ||
          source.quality
        )
      );

      return {
        name: PROVIDER_NAME + " " + quality,
        title: (info.title || PROVIDER_NAME) + suffix,
        url: url,
        quality: quality,
        type: "direct",
        subtitles: subtitles,
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": playResult.host + "/"
        }
      };
    })
    .filter(Boolean);
}

function resolveH5Fallback(info, mediaType, season, episode) {
  return searchBestCandidate(info, mediaType)
    .then(function(match) {
      if (!match) {
        throw new Error("MovieBox H5 search found no usable candidate");
      }

      console.log(
        "[MovieBox] H5 match host=" +
        match.host +
        " title=" +
        match.item.title +
        " score=" +
        match.score
      );

      return racePlayHosts(
        match.item,
        mediaType,
        season,
        episode,
        match.host
      );
    })
    .then(function(playResult) {
      if (!playResult) {
        throw new Error("MovieBox H5 returned no playable streams");
      }

      return raceCaptions(playResult)
        .catch(function() { return []; })
        .then(function(captions) {
          return buildH5Streams(
            playResult,
            captions,
            info,
            mediaType,
            season,
            episode
          );
        });
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var requestedSeason = Math.max(1, Number(season || 1));
  var requestedEpisode = Math.max(1, Number(episode || 1));

  console.log(
    "[MovieBox] Request tmdbId=" +
    tmdbId +
    " type=" +
    type +
    (
      type === "tv"
        ? " S" + requestedSeason + "E" + requestedEpisode
        : ""
    )
  );

  var info;

  var work = getTmdbInfo(tmdbId, type)
    .then(function(value) {
      info = value;

      /*
       * Current MovieBox web pages use TMDB IDs directly and their primary
       * "Zen" server is VideoEasy. This avoids the H5 search bottleneck.
       */
      return resolveCurrentMovieBoxPlayer(
        tmdbId,
        type,
        requestedSeason,
        requestedEpisode
      );
    })
    .then(function(streams) {
      if (streams && streams.length) {
        return streams;
      }

      console.log("[MovieBox] Current player empty, falling back to H5 API");

      return resolveH5Fallback(
        info,
        type,
        requestedSeason,
        requestedEpisode
      );
    });

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    "MovieBox provider"
  ).catch(function(error) {
    console.error(
      "[MovieBox] " +
      (error && error.message ? error.message : String(error))
    );
    return [];
  });
}

module.exports = {
  getStreams: getStreams
};
