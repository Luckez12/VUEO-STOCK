"use strict";

var PROVIDER_NAME = "KissKH";
var BASE_URL = "https://kisskh.id";
var KISSKH_VERSION = "2.8.10";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var VIDEO_KEY_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
var SUBTITLE_KEY_API = "https://script.google.com/macros/s/AKfycbyq6hTj0ZhlinYC6xbggtgo166tp6XaDKBCGtnYk8uOfYBUFwwxBui0sGXiu_zIFmA/exec?id=";

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

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
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
  var candidateWords = new Set(left.split(" "));
  var matched = expectedWords.filter(function(word) {
    return word.length > 1 && candidateWords.has(word);
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

function fixUrl(url) {
  var value = String(url || "").trim();
  if (!value) return "";
  if (value.indexOf("//") === 0) return "https:" + value;
  if (value.charAt(0) === "/") return BASE_URL + value;
  return value;
}

function normalizeSubtitleLanguage(label, code) {
  var rawCode = String(code || "").trim().toLowerCase().replace("_", "-");
  var rawLabel = String(label || "").trim();
  var value = rawLabel.toLowerCase();
  var aliases = {
    en: "English", eng: "English", english: "English",
    ms: "Malay", msa: "Malay", may: "Malay", malay: "Malay", malaysia: "Malay",
    id: "Indonesian", ind: "Indonesian", indonesia: "Indonesian", indonesian: "Indonesian",
    ko: "Korean", kor: "Korean", korean: "Korean",
    zh: "Chinese", zho: "Chinese", chi: "Chinese", chinese: "Chinese",
    ja: "Japanese", jpn: "Japanese", japanese: "Japanese",
    th: "Thai", tha: "Thai", thai: "Thai",
    ar: "Arabic", ara: "Arabic", arabic: "Arabic",
    km: "Khmer", khm: "Khmer", khmer: "Khmer",
    vi: "Vietnamese", vie: "Vietnamese", vietnamese: "Vietnamese",
    es: "Spanish", spa: "Spanish", spanish: "Spanish",
    fr: "French", fra: "French", fre: "French", french: "French"
  };

  var baseCode = rawCode.split("-")[0];
  return aliases[rawCode] || aliases[baseCode] || aliases[value] || rawLabel || rawCode || "Unknown";
}

function subtitleCode(label, code) {
  var rawCode = String(code || "").trim().toLowerCase().replace("_", "-");
  if (rawCode) return rawCode;
  var value = String(label || "").trim().toLowerCase();
  var codes = {
    english: "en", malay: "ms", malaysia: "ms", indonesian: "id", indonesia: "id",
    korean: "ko", chinese: "zh", japanese: "ja", thai: "th", arabic: "ar",
    khmer: "km", vietnamese: "vi", spanish: "es", french: "fr"
  };
  return codes[value] || value || "und";
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

function findBestDrama(info, mediaType, season) {
  var requestedSeason = mediaType === "tv" ? Number(season || 1) : 0;
  var queries = [info.title];
  if (info.originalTitle && normalizeTitle(info.originalTitle) !== normalizeTitle(info.title)) {
    queries.push(info.originalTitle);
  }
  if (requestedSeason > 1) {
    queries.push(info.title + " Season " + requestedSeason);
    if (info.originalTitle && normalizeTitle(info.originalTitle) !== normalizeTitle(info.title)) {
      queries.push(info.originalTitle + " Season " + requestedSeason);
    }
  }

  return Promise.all(queries.map(searchKissKh)).then(function(groups) {
    var seen = new Set();
    var candidates = [];

    groups.forEach(function(group) {
      group.forEach(function(item) {
        if (!item || item.id === undefined || seen.has(String(item.id))) return;
        seen.add(String(item.id));
        candidates.push(item);
      });
    });

    candidates.sort(function(a, b) {
      var aScore = Math.max(titleScore(a.title, info.title), titleScore(a.title, info.originalTitle));
      var bScore = Math.max(titleScore(b.title, info.title), titleScore(b.title, info.originalTitle));
      return bScore - aScore;
    });

    candidates = candidates.slice(0, 6);
    if (candidates.length === 0) throw new Error("No KissKH title match");

    return Promise.all(candidates.map(function(candidate) {
      return getDramaDetail(candidate.id)
        .then(function(detail) {
          var score = Math.max(
            titleScore(detail.title, info.title),
            titleScore(detail.title, info.originalTitle)
          );
          var detailYear = String(detail.releaseDate || "").split("-")[0];
          if (info.year && detailYear === info.year) score += 25;
          if (requestedSeason > 0) {
            var normalized = normalizeTitle(detail.title);
            var seasonMatch = normalized.match(/(?:season|series|s)\s*(\d+)\b/);
            var candidateSeason = seasonMatch ? Number(seasonMatch[1]) : 1;
            if (candidateSeason === requestedSeason) score += 35;
            else score -= 45;
          }
          return { detail: detail, score: score };
        })
        .catch(function() {
          return null;
        });
    })).then(function(matches) {
      matches = matches.filter(Boolean).sort(function(a, b) { return b.score - a.score; });
      if (matches.length === 0 || matches[0].score < 60) throw new Error("KissKH match confidence too low");
      return matches[0].detail;
    });
  });
}

function selectEpisode(detail, mediaType, season, episode) {
  var episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
  if (episodes.length === 0) throw new Error("No KissKH episodes");

  if (mediaType === "movie" || episodes.length === 1) {
    return episodes[0];
  }

  var requestedEpisode = Number(episode || 1);
  var exact = episodes.find(function(item) {
    return Number(item.number) === requestedEpisode;
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

function getSubtitleKey(episodeId) {
  var url = SUBTITLE_KEY_API + encodeURIComponent(episodeId) + "&version=" + encodeURIComponent(KISSKH_VERSION);
  return fetchJson(url, {}).then(function(data) {
    if (!data || !data.key) throw new Error("Empty KissKH subtitle key");
    return data.key;
  });
}

function getSubtitles(episodeId) {
  return getSubtitleKey(episodeId)
    .then(function(key) {
      var url = BASE_URL + "/api/Sub/" + encodeURIComponent(episodeId) + "?kkey=" + encodeURIComponent(key);
      return fetchJson(url, {
        "Origin": BASE_URL,
        "Referer": BASE_URL + "/"
      });
    })
    .then(function(items) {
      var seen = new Set();
      return (Array.isArray(items) ? items : []).map(function(item) {
        var url = fixUrl(item && item.src);
        if (!url || seen.has(url)) return null;
        seen.add(url);
        var language = normalizeSubtitleLanguage(item.label, item.land || item.lang);
        var code = subtitleCode(item.label, item.land || item.lang);
        return {
          label: language,
          language: language,
          lang: code,
          url: url,
          default: Boolean(item.default),
          headers: {
            "User-Agent": USER_AGENT,
            "Referer": BASE_URL + "/"
          }
        };
      }).filter(Boolean);
    })
    .catch(function(error) {
      console.log("[KissKH] Subtitles unavailable: " + error.message);
      return [];
    });
}

function buildStreams(source, subtitles, info, season, episode) {
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
      subtitles: subtitles,
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
  return getTmdbInfo(tmdbId, type)
    .then(function(value) {
      info = value;
      if (!info.title) throw new Error("TMDB title is empty");
      return findBestDrama(info, type, season);
    })
    .then(function(detail) {
      var selected = selectEpisode(detail, type, season, episode);
      if (!selected || selected.id === undefined) throw new Error("KissKH episode ID is missing");
      return Promise.all([
        getVideoKey(selected.id).then(function(key) { return getSources(selected.id, key); }),
        getSubtitles(selected.id)
      ]);
    })
    .then(function(result) {
      var source = result[0];
      var subtitles = result[1];
      var streams = buildStreams(source, subtitles, info, type === "tv" ? season || 1 : null, type === "tv" ? episode || 1 : null);
      console.log("[KissKH] Direct streams found=" + streams.length + " subtitles=" + subtitles.length);
      return streams;
    })
    .catch(function(error) {
      console.error("[KissKH] " + error.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
