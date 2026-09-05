"use strict";

var PROVIDER_NAME = "Cinemode";
var BASE_URL = "https://cinemode.fun";
var CINEMODE_VERSION = "2.8.10";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var VIDEO_KEY_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";

var USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Referer": BASE_URL + "/"
};

function fetchJson(url, headers) {
  return fetch(url, {
    method: "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow"
  }).then(function(response) {
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " for " + url);
    }
    return response.json();
  });
}

function withSoftTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise(function(_, reject) {
      setTimeout(function() {
        reject(new Error((label || "Request") + " timed out"));
      }, timeoutMs);
    })
  ]);
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
  if (left.indexOf(right) !== -1 || right.indexOf(left) !== -1) return 75;

  var expectedWords = right.split(" ");
  var candidateWords = {};
  left.split(" ").forEach(function(word) { candidateWords[word] = true; });

  var matched = expectedWords.filter(function(word) {
    return word.length > 1 && candidateWords[word];
  }).length;

  return Math.round((matched / Math.max(expectedWords.length, 1)) * 60);
}

function inferQuality(url) {
  var value = String(url || "").toLowerCase();
  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) return "2160p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return "Auto";
}

function isDirectStream(url) {
  var value = String(url || "").toLowerCase();
  return value.indexOf(".m3u8") !== -1 || value.indexOf(".mp4") !== -1;
}

function getTmdbInfo(tmdbId, mediaType) {
  var endpoint = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + endpoint + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY;

  return fetchJson(url, {}).then(function(data) {
    return {
      title: data.title || data.name || "",
      originalTitle: data.original_title || data.original_name || "",
      year: String(data.release_date || data.first_air_date || "").split("-")[0]
    };
  });
}

function searchKissKh(query) {
  var url = BASE_URL + "/api/DramaList/Search?q=" + encodeURIComponent(query) + "&type=0";
  return fetchJson(url, {}).then(function(data) {
    return Array.isArray(data) ? data : [];
  });
}

function getDramaDetail(id) {
  var url = BASE_URL + "/api/DramaList/Drama/" + encodeURIComponent(id) + "?isq=false";
  return fetchJson(url, {});
}

function candidateYear(item) {
  return String(
    item && (
      item.releaseDate ||
      item.release_date ||
      item.year ||
      item.firstAirDate ||
      item.first_air_date
    ) || ""
  ).match(/\d{4}/);
}

function candidateScore(item, info) {
  var score = Math.max(
    titleScore(item && (item.title || item.name), info.title),
    titleScore(item && (item.title || item.name), info.originalTitle)
  );

  var year = candidateYear(item);
  if (info.year && year && year[0] === info.year) score += 25;
  return score;
}

function findBestDrama(info) {
  var queries = [info.title];
  if (info.originalTitle && normalizeTitle(info.originalTitle) !== normalizeTitle(info.title)) {
    queries.push(info.originalTitle);
  }

  return Promise.all(queries.map(searchKissKh)).then(function(groups) {
    var seen = {};
    var candidates = [];

    groups.forEach(function(group, queryIndex) {
      group.forEach(function(item, rank) {
        if (!item || item.id === undefined || item.id === null || seen[String(item.id)]) return;
        seen[String(item.id)] = true;
        item.__vueoSearchRank = rank;
        item.__vueoQueryIndex = queryIndex;
        candidates.push(item);
      });
    });

    candidates.sort(function(a, b) {
      var aScore = candidateScore(a, info) + Math.max(0, 10 - Number(a.__vueoSearchRank || 0));
      var bScore = candidateScore(b, info) + Math.max(0, 10 - Number(b.__vueoSearchRank || 0));
      return bScore - aScore;
    });

    candidates = candidates.slice(0, 2);
    if (candidates.length === 0) throw new Error("No KissKH title match");

    return Promise.all(candidates.map(function(candidate) {
      return withSoftTimeout(
        getDramaDetail(candidate.id),
        1800,
        "KissKH detail"
      ).then(function(detail) {
        var score = Math.max(
          titleScore(detail && (detail.title || detail.name), info.title),
          titleScore(detail && (detail.title || detail.name), info.originalTitle),
          candidateScore(candidate, info)
        );

        var detailYear = candidateYear(detail);
        if (info.year && detailYear && detailYear[0] === info.year) score += 25;

        score += Math.max(0, 10 - Number(candidate.__vueoSearchRank || 0));
        return { detail: detail, score: score };
      }).catch(function() {
        return null;
      });
    })).then(function(matches) {
      matches = matches.filter(Boolean).sort(function(a, b) { return b.score - a.score; });
      if (matches.length === 0 || matches[0].score < 45) {
        throw new Error("KissKH match confidence too low");
      }
      return matches[0].detail;
    });
  });
}

function selectEpisode(detail, mediaType, season, episode) {
  var episodes = Array.isArray(detail && detail.episodes) ? detail.episodes : [];
  if (episodes.length === 0) throw new Error("No KissKH episodes");

  if (mediaType === "movie" || episodes.length === 1) {
    return episodes[0];
  }

  var requestedEpisode = Number(episode || 1);
  var exact = episodes.find(function(item) {
    return Number(item && item.number) === requestedEpisode;
  });

  if (!exact) throw new Error("Episode " + requestedEpisode + " not found on KissKH");
  if (Number(season || 1) > 1) {
    console.log("[KissKH] Source does not expose seasons; matching by episode number only");
  }
  return exact;
}

function getVideoKey(episodeId) {
  var url = VIDEO_KEY_API + encodeURIComponent(episodeId) + "&version=" + encodeURIComponent(KISSKH_VERSION);
  return fetchJson(url, {}).then(function(data) {
    if (!data || !data.key) throw new Error("Empty KissKH video key");
    return data.key;
  });
}

function getSources(episodeId, key) {
  var url = BASE_URL + "/api/DramaList/Episode/" + encodeURIComponent(episodeId) +
    ".png?err=false&ts=&time=&kkey=" + encodeURIComponent(key);
  return fetchJson(url, {
    "Origin": BASE_URL,
    "Referer": BASE_URL + "/"
  });
}

function buildStreams(source, info, season, episode) {
  var urls = [source && source.Video, source && source.ThirdParty]
    .map(function(value) { return String(value || "").trim(); })
    .filter(function(value, index, array) {
      return value && isDirectStream(value) && array.indexOf(value) === index;
    });

  return urls.map(function(url, index) {
    var quality = inferQuality(url);
    var episodeLabel = episode ? " S" + String(season || 1).padStart(2, "0") +
      "E" + String(episode).padStart(2, "0") : "";

    return {
      name: PROVIDER_NAME + (urls.length > 1 ? " Server " + (index + 1) : ""),
      title: (info.title || PROVIDER_NAME) + episodeLabel,
      url: url,
      quality: quality,
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": BASE_URL + "/",
        "Origin": BASE_URL
      }
    };
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "movie" ? "movie" : "tv";
  console.log("[KissKH] Request tmdbId=" + tmdbId + " type=" + type +
    (type === "tv" ? " S" + (season || 1) + "E" + (episode || 1) : ""));

  var info;
  var work = getTmdbInfo(tmdbId, type)
    .then(function(value) {
      info = value;
      if (!info.title) throw new Error("TMDB title is empty");
      return findBestDrama(info);
    })
    .then(function(detail) {
      var selected = selectEpisode(detail, type, season, episode);
      if (!selected || selected.id === undefined) throw new Error("KissKH episode ID is missing");
      return getVideoKey(selected.id).then(function(key) {
        return getSources(selected.id, key);
      });
    })
    .then(function(source) {
      var streams = buildStreams(source, info, type === "tv" ? season || 1 : null, type === "tv" ? episode || 1 : null);
      console.log("[KissKH] Direct streams found=" + streams.length);
      return streams;
    });

  return withSoftTimeout(work, 8800, "KissKH provider")
    .catch(function(error) {
      console.error("[KissKH] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
