"use strict";

var PROVIDER_NAME = "CineMode";
var BASE_URL = "https://cinemode.fun";
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
  "doubleclick",
  "googlesyndication",
  "googleadservices",
  "googletagmanager",
  "/ads/",
  "/vast",
  "effectivecpmnetwork"
];

function inferQuality(url, label) {
  var value =
    (String(label || "") + " " + String(url || "")).toLowerCase();

  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) return "2160p";
  if (value.indexOf("1440") !== -1) return "1440p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return "Auto";
}

function isPlayable(url) {
  var value = String(url || "").toLowerCase();
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

function nativeAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function buildPageUrl(type, id, season, episode) {
  if (type === "tv") {
    return (
      BASE_URL +
      "/tv/" +
      encodeURIComponent(id) +
      "?season=" +
      encodeURIComponent(season) +
      "&episode=" +
      encodeURIComponent(episode)
    );
  }

  return BASE_URL + "/movie/" + encodeURIComponent(id);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var id = String(tmdbId || "").trim();
  var requestedSeason = Math.max(1, Number(season || 1));
  var requestedEpisode = Math.max(1, Number(episode || 1));

  if (!id) {
    console.error("[CineMode] TMDB ID is missing");
    return Promise.resolve([]);
  }

  if (!nativeAvailable()) {
    console.error("[CineMode] VUEO native webviewResolve() is unavailable");
    return Promise.resolve([]);
  }

  var pageUrl = buildPageUrl(
    type,
    id,
    requestedSeason,
    requestedEpisode
  );

  console.log(
    "[CineMode] Direct page " +
    pageUrl
  );

  return globalThis.webviewResolve(pageUrl, {
    referer: BASE_URL + "/",
    directLoad: true,
    timeoutMs: 17000,
    finishAfterFirstMs: 850,
    viewportWidth: 1080,
    viewportHeight: 1080,
    clickX: 540,
    clickY: 540,
    clickDelaysMs: [
      900,
      1800,
      3200,
      5000,
      7500,
      10500,
      13500
    ],
    match: MATCH_PARTS,
    blocked: BLOCKED_PARTS,
    injectAbyssHook: true
  }).then(function(result) {
    var captured =
      result && Array.isArray(result.streams)
        ? result.streams
        : [];

    var seen = {};
    var streams = captured
      .filter(function(item) {
        return item && item.url && isPlayable(item.url);
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
          type === "tv"
            ? " S" +
              String(requestedSeason).padStart(2, "0") +
              "E" +
              String(requestedEpisode).padStart(2, "0")
            : "";

        return {
          name:
            PROVIDER_NAME +
            (captured.length > 1
              ? " " + (index + 1)
              : ""),
          title: PROVIDER_NAME + suffix,
          url: url,
          quality: inferQuality(url, item.label),
          headers: sanitiseHeaders(
            item.headers,
            pageUrl
          )
        };
      });

    streams.sort(function(a, b) {
      var aIntermediate =
        String(a.url).indexOf("/sora/") !== -1 ? 1 : 0;
      var bIntermediate =
        String(b.url).indexOf("/sora/") !== -1 ? 1 : 0;
      return aIntermediate - bIntermediate;
    });

    console.log(
      "[CineMode] Direct streams found=" +
      streams.length
    );

    return streams;
  }).catch(function(error) {
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
