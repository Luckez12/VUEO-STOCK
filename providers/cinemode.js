"use strict";

var PROVIDER_NAME = "CineMode";
var BASE_URL = "https://cinemode.fun";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var MATCH_PARTS = [
  ".m3u8",
  ".mp4",
  ".m4v",
  "/sora/"
];

var BLOCKED_PARTS = [
  "googletagmanager",
  "/vast"
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

function fetchJson(url, timeoutMs) {
  return withSoftTimeout(
    fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": USER_AGENT
      },
      redirect: "follow"
    }).then(function(response) {
      if (!response.ok) {
        throw new Error(
          "HTTP " +
          response.status +
          " for " +
          url
        );
      }
      return response.json();
    }),
    timeoutMs || 1300,
    "CineMode metadata"
  );
}

function getTmdbInfo(tmdbId, mediaType) {
  var endpoint =
    mediaType === "tv"
      ? "tv"
      : "movie";

  var url =
    "https://api.themoviedb.org/3/" +
    endpoint +
    "/" +
    encodeURIComponent(tmdbId) +
    "?api_key=" +
    TMDB_API_KEY;

  return fetchJson(url, 1300).then(function(data) {
    return {
      title:
        String(
          data &&
          (data.title || data.name) ||
          ""
        ).trim(),
      originalTitle:
        String(
          data &&
          (
            data.original_title ||
            data.original_name
          ) ||
          ""
        ).trim()
    };
  });
}

function inferQuality(url, label) {
  var value =
    (
      String(label || "") +
      " " +
      String(url || "")
    ).toLowerCase();

  if (
    value.indexOf("2160") !== -1 ||
    value.indexOf("4k") !== -1
  ) return "2160p";

  if (value.indexOf("1440") !== -1) return "1440p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";

  return "Auto";
}

function isPlayable(url) {
  var value =
    String(url || "").toLowerCase();

  return MATCH_PARTS.some(function(part) {
    return value.indexOf(part) !== -1;
  });
}

function sanitiseHeaders(input, referer) {
  var output = {};
  var source =
    input && typeof input === "object"
      ? input
      : {};

  Object.keys(source).forEach(function(key) {
    var lower =
      String(key || "").toLowerCase();

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

    output[key] =
      String(source[key]);
  });

  output["User-Agent"] =
    output["User-Agent"] ||
    output["user-agent"] ||
    USER_AGENT;

  output["Referer"] = referer;
  delete output["referer"];

  return output;
}

function nativeAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function buildStreams(
  captured,
  mediaType,
  season,
  episode
) {
  var seen = {};

  return captured
    .filter(function(item) {
      return (
        item &&
        item.url &&
        isPlayable(item.url)
      );
    })
    .filter(function(item) {
      var url = String(item.url);

      if (seen[url]) return false;
      seen[url] = true;
      return true;
    })
    .map(function(item, index) {
      var url = String(item.url);

      var suffix =
        mediaType === "tv"
          ? " S" +
            String(season).padStart(2, "0") +
            "E" +
            String(episode).padStart(2, "0")
          : "";

      return {
        name:
          PROVIDER_NAME +
          (index > 0
            ? " " + (index + 1)
            : ""),
        title:
          PROVIDER_NAME + suffix,
        url: url,
        quality:
          inferQuality(
            url,
            item.label
          ),
        headers:
          sanitiseHeaders(
            item.headers,
            BASE_URL + "/"
          )
      };
    })
    .sort(function(a, b) {
      var ai =
        String(a.url).indexOf("/sora/") !== -1
          ? 1
          : 0;

      var bi =
        String(b.url).indexOf("/sora/") !== -1
          ? 1
          : 0;

      return ai - bi;
    });
}

function getStreams(
  tmdbId,
  mediaType,
  season,
  episode
) {
  var type =
    mediaType === "tv"
      ? "tv"
      : "movie";

  var id =
    String(tmdbId || "").trim();

  var requestedSeason =
    Math.max(
      1,
      Number(season || 1)
    );

  var requestedEpisode =
    Math.max(
      1,
      Number(episode || 1)
    );

  if (!id) {
    console.error(
      "[CineMode] TMDB ID is missing"
    );
    return Promise.resolve([]);
  }

  if (!nativeAvailable()) {
    console.error(
      "[CineMode] Native webviewResolve() is unavailable"
    );
    return Promise.resolve([]);
  }

  return getTmdbInfo(
    id,
    type
  ).then(function(info) {
    if (!info.title) {
      throw new Error(
        "TMDB title is empty"
      );
    }

    var interactionTexts = [
      info.title
    ];

    if (
      info.originalTitle &&
      info.originalTitle
        .toLowerCase() !==
        info.title.toLowerCase()
    ) {
      interactionTexts.push(
        info.originalTitle
      );
    }

    interactionTexts = interactionTexts.concat([
      "watch now",
      "start watching",
      "watch",
      "play now",
      "play",
      "continue",
      "skip ad",
      "skip",
      "close ad",
      "close"
    ]);

    console.log(
      "[CineMode] UI search title=" +
      info.title
    );

    return globalThis.webviewResolve(
      BASE_URL + "/",
      {
        referer:
          BASE_URL + "/",
        directLoad: true,
        searchText:
          info.title,
        timeoutMs: 17750,
        finishAfterFirstMs: 600,
        suppressPopups: true,
        lockMainFrameHost: true,
        interactionTexts:
          interactionTexts,
        viewportWidth: 1080,
        viewportHeight: 1080,
        clickX: 540,
        clickY: 540,
        clickDelaysMs: [
          550,
          1100,
          1750,
          2500,
          3400,
          4500,
          5800,
          7200,
          9000,
          11100,
          13400,
          15700
        ],
        match:
          MATCH_PARTS,
        blocked:
          BLOCKED_PARTS,
        injectAbyssHook: true
      }
    );
  }).then(function(result) {
    var captured =
      result &&
      Array.isArray(result.streams)
        ? result.streams
        : [];

    var streams =
      buildStreams(
        captured,
        type,
        requestedSeason,
        requestedEpisode
      );

    console.log(
      "[CineMode] UI-search streams=" +
      streams.length
    );

    return streams;
  }).catch(function(error) {
    console.error(
      "[CineMode] " +
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

module.exports = {
  getStreams: getStreams
};
