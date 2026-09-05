"use strict";

var PROVIDER_NAME = "CineMode";
var BASE_URL = "https://cinemode.fun";
var PROVIDER_BUDGET_MS = 19000;

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var BLOCKED_PATTERNS = [
  "doubleclick",
  "googlesyndication",
  "googleadservices",
  "/ads/",
  "/vast",
  "popads",
  "popcash"
];

var MEDIA_PATTERNS = [
  ".m3u8",
  ".mp4",
  ".m4v",
  "/sora/"
];

/*
 * CineMode is a current streaming PWA. Its previous VUEO provider was not a
 * CineMode implementation at all. It was KissKH code pointed at cinemode.fun.
 *
 * The current public CineMode source is not available to VUEO, so this provider
 * first probes the CineMode media page itself. If the page does not expose a
 * playable request, it falls back to the same TMDB-iframe server family used by
 * current streaming frontends with the same browsing/player model.
 */
var COMPAT_SERVERS = [
  {
    id: "videasy",
    label: "VideoEasy",
    build: function(type, id, season, episode) {
      var params =
        "?color=e50914" +
        "&nextEpisode=false" +
        "&autoplayNextEpisode=false" +
        "&episodeSelector=false" +
        "&overlay=true" +
        "&autoplay=0" +
        "&autoPlay=false" +
        "&playsinline=1" +
        "&playsInline=true" +
        "&provider=yoru" +
        "&server=yoru" +
        "&sv=yoru" +
        "&source=yoru";

      if (type === "tv") {
        return "https://player.videasy.to/tv/" +
          encodeURIComponent(id) + "/" +
          encodeURIComponent(season) + "/" +
          encodeURIComponent(episode) +
          params;
      }

      return "https://player.videasy.to/movie/" +
        encodeURIComponent(id) +
        params;
    }
  },
  {
    id: "vidsrc",
    label: "VidSrc",
    build: function(type, id, season, episode) {
      if (type === "tv") {
        return "https://vidsrc.wiki/embed/tv/" +
          encodeURIComponent(id) + "/" +
          encodeURIComponent(season) + "/" +
          encodeURIComponent(episode) +
          "?sub=en&autoplay=0";
      }

      return "https://vidsrc.wiki/embed/movie/" +
        encodeURIComponent(id) +
        "?sub=en&autoplay=0";
    }
  },
  {
    id: "rive",
    label: "Rive",
    build: function(type, id, season, episode) {
      var theme =
        "&theme=e50914" +
        "&color=e50914" +
        "&primaryColor=e50914";

      if (type === "tv") {
        return "https://rivestream.vip/embed" +
          "?type=tv" +
          "&id=" + encodeURIComponent(id) +
          "&season=" + encodeURIComponent(season) +
          "&episode=" + encodeURIComponent(episode) +
          theme;
      }

      return "https://rivestream.vip/embed" +
        "?type=movie" +
        "&id=" + encodeURIComponent(id) +
        theme;
    }
  },
  {
    id: "vidup",
    label: "VidUp",
    build: function(type, id, season, episode) {
      var params =
        "?theme=E50914" +
        "&sub=en" +
        "&poster=true" +
        "&title=true" +
        "&autoPlay=false";

      if (type === "tv") {
        return "https://vidup.to/tv/" +
          encodeURIComponent(id) + "/" +
          encodeURIComponent(season) + "/" +
          encodeURIComponent(episode) +
          params +
          "&autoNext=false&nextButton=false";
      }

      return "https://vidup.to/movie/" +
        encodeURIComponent(id) +
        params;
    }
  },
  {
    id: "vixsrc",
    label: "VixSrc",
    build: function(type, id, season, episode) {
      var params =
        "?primaryColor=e50914" +
        "&lang=eng" +
        "&sub=eng" +
        "&autoplay=false";

      if (type === "tv") {
        return "https://vixsrc.to/tv/" +
          encodeURIComponent(id) + "/" +
          encodeURIComponent(season) + "/" +
          encodeURIComponent(episode) +
          params;
      }

      return "https://vixsrc.to/movie/" +
        encodeURIComponent(id) +
        params;
    }
  },
  {
    id: "vidfast",
    label: "VidFast",
    build: function(type, id, season, episode) {
      var params =
        "?theme=e50914" +
        "&sub=en" +
        "&fullscreenButton=true" +
        "&poster=true" +
        "&title=true" +
        "&chromecast=true";

      if (type === "tv") {
        return "https://vidfast.pro/tv/" +
          encodeURIComponent(id) + "/" +
          encodeURIComponent(season) + "/" +
          encodeURIComponent(episode) +
          params +
          "&nextButton=false&autoNext=false";
      }

      return "https://vidfast.pro/movie/" +
        encodeURIComponent(id) +
        params;
    }
  },
  {
    id: "vidnest",
    label: "VidNest",
    build: function(type, id, season, episode) {
      if (type === "tv") {
        return "https://vidnest.fun/tv/" +
          encodeURIComponent(id) + "/" +
          encodeURIComponent(season) + "/" +
          encodeURIComponent(episode) +
          "?sub=en";
      }

      return "https://vidnest.fun/movie/" +
        encodeURIComponent(id) +
        "?sub=en";
    }
  },
  {
    id: "peachify",
    label: "Peachify",
    build: function(type, id, season, episode) {
      var params =
        "?accent=E50914" +
        "&autoPlay=false" +
        "&dub=English" +
        "&sub=English";

      if (type === "tv") {
        return "https://peachify.top/embed/tv/" +
          encodeURIComponent(id) + "/" +
          encodeURIComponent(season) + "/" +
          encodeURIComponent(episode) +
          params +
          "&autoNext=false";
      }

      return "https://peachify.top/embed/movie/" +
        encodeURIComponent(id) +
        params;
    }
  }
];

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

function inferQuality(url, label) {
  var value =
    (String(label || "") + " " + String(url || "")).toLowerCase();

  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) {
    return "2160p";
  }
  if (value.indexOf("1440") !== -1) return "1440p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return "Auto";
}

function isPlayableUrl(url) {
  var value = String(url || "").toLowerCase();

  return (
    value.indexOf("/sora/") !== -1 ||
    value.indexOf(".m3u8") !== -1 ||
    value.indexOf(".mp4") !== -1 ||
    value.indexOf(".m4v") !== -1
  );
}

function sanitisePlaybackHeaders(input, referer) {
  var headers = {};
  var source =
    input && typeof input === "object"
      ? input
      : {};

  Object.keys(source).forEach(function(key) {
    var lower = String(key || "").toLowerCase();

    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "accept-encoding" ||
      lower === "range" ||
      lower === "origin" ||
      lower === "sec-fetch-site" ||
      lower === "sec-fetch-mode" ||
      lower === "sec-fetch-dest"
    ) {
      return;
    }

    headers[key] = String(source[key]);
  });

  headers["User-Agent"] =
    headers["User-Agent"] ||
    headers["user-agent"] ||
    USER_AGENT;

  headers["Referer"] = referer;
  delete headers["referer"];

  return headers;
}

function nativeWebViewAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function webViewResolvePage(url, label, timeoutMs) {
  if (!nativeWebViewAvailable()) {
    return Promise.reject(
      new Error("VUEO native webviewResolve() is unavailable")
    );
  }

  console.log(
    "[CineMode] WebView start server=" +
    label +
    " host=" +
    hostOf(url)
  );

  return globalThis.webviewResolve(url, {
    referer: url,
    timeoutMs: timeoutMs,
    finishAfterFirstMs: 450,
    clickDelaysMs: [
      500,
      1200,
      2400,
      3800
    ],
    match: MEDIA_PATTERNS,
    blocked: BLOCKED_PATTERNS,
    injectAbyssHook: true
  }).then(function(result) {
    var captured =
      result && Array.isArray(result.streams)
        ? result.streams
        : [];

    var streams = captured
      .filter(function(item) {
        return item && item.url && isPlayableUrl(item.url);
      })
      .map(function(item) {
        return {
          url: String(item.url),
          quality: inferQuality(
            item.url,
            item.label || label
          ),
          headers: sanitisePlaybackHeaders(
            item.headers,
            url
          )
        };
      });

    /*
     * Prefer final media URLs over intermediate /sora/ requests when both
     * appear in the WebView capture.
     */
    streams.sort(function(a, b) {
      var aIntermediate =
        String(a.url).indexOf("/sora/") !== -1 ? 1 : 0;
      var bIntermediate =
        String(b.url).indexOf("/sora/") !== -1 ? 1 : 0;

      return aIntermediate - bIntermediate;
    });

    console.log(
      "[CineMode] " +
      label +
      " streams=" +
      streams.length
    );

    return streams;
  });
}

function hostOf(url) {
  try {
    return String(new URL(url).hostname || "");
  } catch (_) {
    return "";
  }
}

function buildCineModePage(type, id, season, episode) {
  /*
   * Person pages on the current PWA use /person/<tmdbId>. Movie and TV
   * routes are therefore probed using the corresponding media route first.
   * This probe is optional. The compatibility cascade below remains the
   * functional fallback if the site's route/player implementation changes.
   */
  if (type === "tv") {
    return BASE_URL +
      "/tv/" +
      encodeURIComponent(id) +
      "?season=" +
      encodeURIComponent(season) +
      "&episode=" +
      encodeURIComponent(episode);
  }

  return BASE_URL +
    "/movie/" +
    encodeURIComponent(id);
}

function buildOutputStreams(captured, label, type, season, episode) {
  var suffix =
    type === "tv"
      ? " S" +
        String(season).padStart(2, "0") +
        "E" +
        String(episode).padStart(2, "0")
      : "";

  return captured.map(function(item, index) {
    return {
      name:
        PROVIDER_NAME +
        " " +
        label +
        (captured.length > 1
          ? " " + (index + 1)
          : ""),
      title: PROVIDER_NAME + suffix,
      url: item.url,
      quality: item.quality || "Auto",
      headers: item.headers || {}
    };
  });
}

function tryCompatibilityServers(type, id, season, episode) {
  /*
   * Four attempts keep worst-case provider latency under VUEO's 20 second
   * runtime budget while still covering the current primary fallback chain.
   */
  var servers = COMPAT_SERVERS.slice(0, 4);

  function attempt(index) {
    if (index >= servers.length) {
      return Promise.resolve([]);
    }

    var server = servers[index];
    var url = server.build(
      type,
      id,
      season,
      episode
    );

    return webViewResolvePage(
      url,
      server.label,
      3800
    ).then(function(streams) {
      if (streams.length) {
        return buildOutputStreams(
          streams,
          server.label,
          type,
          season,
          episode
        );
      }

      return attempt(index + 1);
    }).catch(function(error) {
      console.log(
        "[CineMode] " +
        server.label +
        " failed: " +
        (error && error.message
          ? error.message
          : String(error))
      );

      return attempt(index + 1);
    });
  }

  return attempt(0);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type =
    mediaType === "tv"
      ? "tv"
      : "movie";

  var requestedSeason =
    Math.max(1, Number(season || 1));

  var requestedEpisode =
    Math.max(1, Number(episode || 1));

  var id = String(tmdbId || "").trim();

  if (!id) {
    console.error("[CineMode] TMDB ID is missing");
    return Promise.resolve([]);
  }

  if (!nativeWebViewAvailable()) {
    console.error(
      "[CineMode] Native webviewResolve() is required by this provider"
    );
    return Promise.resolve([]);
  }

  console.log(
    "[CineMode] Request tmdbId=" +
    id +
    " type=" +
    type +
    (type === "tv"
      ? " S" +
        requestedSeason +
        "E" +
        requestedEpisode
      : "")
  );

  var siteUrl = buildCineModePage(
    type,
    id,
    requestedSeason,
    requestedEpisode
  );

  /*
   * First use CineMode itself. Keep this probe short so a route or player
   * change cannot consume the full provider budget.
   */
  var work = webViewResolvePage(
    siteUrl,
    "Site",
    3200
  ).then(function(streams) {
    if (streams.length) {
      return buildOutputStreams(
        streams,
        "Site",
        type,
        requestedSeason,
        requestedEpisode
      );
    }

    return tryCompatibilityServers(
      type,
      id,
      requestedSeason,
      requestedEpisode
    );
  }).catch(function(error) {
    console.log(
      "[CineMode] Site probe failed: " +
      (error && error.message
        ? error.message
        : String(error))
    );

    return tryCompatibilityServers(
      type,
      id,
      requestedSeason,
      requestedEpisode
    );
  });

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    "CineMode provider"
  ).catch(function(error) {
    console.error(
      "[CineMode] " +
      (error && error.message
        ? error.message
        : String(error))
    );
    return [];
  });
}

module.exports = {
  getStreams: getStreams
};
