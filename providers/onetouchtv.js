"use strict";

var PROVIDER_NAME = "OneTouchTV";
var BASE_URL = "https://api3.devcorp.me";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var AES_KEY_TEXT = "im72charPasswordofdInitVectorStm";
var AES_IV_TEXT = "im72charPassword";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Referer": BASE_URL + "/"
};

/* AES-256-CBC decryption is implemented locally so this provider does not
 * depend on Node crypto, WebCrypto, or an injected crypto-js module. */
var AES_SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
];
var AES_INV_SBOX = (function() {
  var inverse = new Array(256);
  for (var i = 0; i < AES_SBOX.length; i++) inverse[AES_SBOX[i]] = i;
  return inverse;
})();
var AES_RCON = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8,0xab,0x4d,0x9a];

function asciiBytes(value) {
  var text = String(value || "");
  var out = new Array(text.length);
  for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function decodeBase64(input) {
  var value = String(input || "")
    .replace(/-_\./g, "/")
    .replace(/@/g, "+")
    .replace(/\s+/g, "");
  while (value.length % 4 !== 0) value += "=";

  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = [];
  for (var i = 0; i < value.length; i += 4) {
    var c0 = alphabet.indexOf(value.charAt(i));
    var c1 = alphabet.indexOf(value.charAt(i + 1));
    var c2char = value.charAt(i + 2);
    var c3char = value.charAt(i + 3);
    var c2 = c2char === "=" ? 0 : alphabet.indexOf(c2char);
    var c3 = c3char === "=" ? 0 : alphabet.indexOf(c3char);
    if (c0 < 0 || c1 < 0 || (c2char !== "=" && c2 < 0) || (c3char !== "=" && c3 < 0)) {
      throw new Error("Invalid OneTouchTV base64 payload");
    }
    var triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    output.push((triple >>> 16) & 0xff);
    if (c2char !== "=") output.push((triple >>> 8) & 0xff);
    if (c3char !== "=") output.push(triple & 0xff);
  }
  return output;
}

function gfMul(a, b) {
  var x = a & 0xff;
  var y = b & 0xff;
  var result = 0;
  for (var i = 0; i < 8; i++) {
    if (y & 1) result ^= x;
    var hi = x & 0x80;
    x = (x << 1) & 0xff;
    if (hi) x ^= 0x1b;
    y >>>= 1;
  }
  return result & 0xff;
}

function rotWord(word) {
  return [word[1], word[2], word[3], word[0]];
}

function subWord(word) {
  return [AES_SBOX[word[0]], AES_SBOX[word[1]], AES_SBOX[word[2]], AES_SBOX[word[3]]];
}

function expandAes256Key(keyBytes) {
  if (!keyBytes || keyBytes.length !== 32) throw new Error("OneTouchTV AES key must be 32 bytes");
  var words = new Array(60);
  var i;
  for (i = 0; i < 8; i++) {
    words[i] = [
      keyBytes[i * 4], keyBytes[i * 4 + 1], keyBytes[i * 4 + 2], keyBytes[i * 4 + 3]
    ];
  }
  for (i = 8; i < 60; i++) {
    var temp = words[i - 1].slice();
    if (i % 8 === 0) {
      temp = subWord(rotWord(temp));
      temp[0] ^= AES_RCON[i / 8];
    } else if (i % 8 === 4) {
      temp = subWord(temp);
    }
    words[i] = [
      words[i - 8][0] ^ temp[0],
      words[i - 8][1] ^ temp[1],
      words[i - 8][2] ^ temp[2],
      words[i - 8][3] ^ temp[3]
    ];
  }

  var expanded = new Array(240);
  for (i = 0; i < 60; i++) {
    expanded[i * 4] = words[i][0] & 0xff;
    expanded[i * 4 + 1] = words[i][1] & 0xff;
    expanded[i * 4 + 2] = words[i][2] & 0xff;
    expanded[i * 4 + 3] = words[i][3] & 0xff;
  }
  return expanded;
}

function addRoundKey(state, expandedKey, round) {
  var offset = round * 16;
  for (var i = 0; i < 16; i++) state[i] = (state[i] ^ expandedKey[offset + i]) & 0xff;
}

function invSubBytes(state) {
  for (var i = 0; i < 16; i++) state[i] = AES_INV_SBOX[state[i]];
}

function invShiftRows(state) {
  var copy = state.slice();
  for (var row = 0; row < 4; row++) {
    for (var col = 0; col < 4; col++) {
      var sourceCol = (col - row + 4) % 4;
      state[row + 4 * col] = copy[row + 4 * sourceCol];
    }
  }
}

function invMixColumns(state) {
  for (var col = 0; col < 4; col++) {
    var i = col * 4;
    var a0 = state[i];
    var a1 = state[i + 1];
    var a2 = state[i + 2];
    var a3 = state[i + 3];
    state[i] = gfMul(a0, 14) ^ gfMul(a1, 11) ^ gfMul(a2, 13) ^ gfMul(a3, 9);
    state[i + 1] = gfMul(a0, 9) ^ gfMul(a1, 14) ^ gfMul(a2, 11) ^ gfMul(a3, 13);
    state[i + 2] = gfMul(a0, 13) ^ gfMul(a1, 9) ^ gfMul(a2, 14) ^ gfMul(a3, 11);
    state[i + 3] = gfMul(a0, 11) ^ gfMul(a1, 13) ^ gfMul(a2, 9) ^ gfMul(a3, 14);
  }
}

function decryptAesBlock(block, expandedKey) {
  var state = block.slice();
  addRoundKey(state, expandedKey, 14);
  for (var round = 13; round >= 1; round--) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, expandedKey, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, expandedKey, 0);
  return state;
}

function utf8Decode(bytes) {
  var output = "";
  var i = 0;
  while (i < bytes.length) {
    var b0 = bytes[i++] & 0xff;
    if (b0 < 0x80) {
      output += String.fromCharCode(b0);
      continue;
    }
    if ((b0 & 0xe0) === 0xc0) {
      if (i >= bytes.length) throw new Error("Invalid UTF-8 payload");
      var b1 = bytes[i++] & 0x3f;
      output += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
      continue;
    }
    if ((b0 & 0xf0) === 0xe0) {
      if (i + 1 >= bytes.length) throw new Error("Invalid UTF-8 payload");
      var b2a = bytes[i++] & 0x3f;
      var b2b = bytes[i++] & 0x3f;
      output += String.fromCharCode(((b0 & 0x0f) << 12) | (b2a << 6) | b2b);
      continue;
    }
    if ((b0 & 0xf8) === 0xf0) {
      if (i + 2 >= bytes.length) throw new Error("Invalid UTF-8 payload");
      var b3a = bytes[i++] & 0x3f;
      var b3b = bytes[i++] & 0x3f;
      var b3c = bytes[i++] & 0x3f;
      var codePoint = ((b0 & 0x07) << 18) | (b3a << 12) | (b3b << 6) | b3c;
      codePoint -= 0x10000;
      output += String.fromCharCode(0xd800 + (codePoint >>> 10), 0xdc00 + (codePoint & 0x3ff));
      continue;
    }
    throw new Error("Invalid UTF-8 payload");
  }
  return output;
}

function decryptString(encrypted) {
  var ciphertext = decodeBase64(encrypted);
  if (!ciphertext.length || ciphertext.length % 16 !== 0) {
    throw new Error("Encrypted OneTouchTV payload is not AES block aligned");
  }

  var expandedKey = expandAes256Key(asciiBytes(AES_KEY_TEXT));
  var iv = asciiBytes(AES_IV_TEXT);
  var plain = [];
  var previous = iv;
  for (var offset = 0; offset < ciphertext.length; offset += 16) {
    var cipherBlock = ciphertext.slice(offset, offset + 16);
    var decryptedBlock = decryptAesBlock(cipherBlock, expandedKey);
    for (var i = 0; i < 16; i++) plain.push((decryptedBlock[i] ^ previous[i]) & 0xff);
    previous = cipherBlock;
  }

  var padding = plain[plain.length - 1];
  if (padding < 1 || padding > 16 || padding > plain.length) throw new Error("Invalid OneTouchTV PKCS7 padding");
  for (var p = 0; p < padding; p++) {
    if (plain[plain.length - 1 - p] !== padding) throw new Error("Invalid OneTouchTV PKCS7 padding");
  }
  plain.length -= padding;

  var envelope = JSON.parse(utf8Decode(plain));
  if (!envelope || typeof envelope.result !== "string") throw new Error("OneTouchTV encrypted envelope has no result");
  return envelope.result;
}

function fetchText(url, headers) {
  return fetch(url, {
    method: "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow"
  }).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
    return response.text();
  });
}

function fetchJson(url, headers) {
  return fetch(url, {
    method: "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow"
  }).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
    return response.json();
  });
}

function fetchDecryptedJson(url, headers) {
  return fetchText(url, headers).then(function(raw) {
    var decrypted = decryptString(raw);
    return JSON.parse(decrypted);
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
  if (left.indexOf(right) !== -1 || right.indexOf(left) !== -1) return 76;
  var expectedWords = right.split(" ");
  var candidateWords = left.split(" ");
  var set = {};
  candidateWords.forEach(function(word) { set[word] = true; });
  var matched = expectedWords.filter(function(word) { return word.length > 1 && set[word]; }).length;
  return Math.round((matched / Math.max(expectedWords.length, 1)) * 65);
}

function extractSeasonFromTitle(title) {
  var normalized = normalizeTitle(title);
  var patterns = [
    /(?:season|series)\s*(\d+)\b/,
    /\bs\s*(\d+)\b/,
    /\bpart\s*(\d+)\b/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = normalized.match(patterns[i]);
    if (match) return Number(match[1]);
  }
  return null;
}

function scoreCandidate(item, info, mediaType, season) {
  var score = Math.max(titleScore(item && item.title, info.title), titleScore(item && item.title, info.originalTitle));
  var itemYear = String(item && item.year || "").match(/\d{4}/);
  if (info.year && itemYear && itemYear[0] === info.year) score += 25;
  var itemType = String(item && item.type || "").toLowerCase();
  if (mediaType === "movie" && itemType === "movie") score += 18;
  if (mediaType === "tv" && itemType && itemType !== "movie") score += 10;

  if (mediaType === "tv") {
    var requestedSeason = Number(season || 1);
    var titleSeason = extractSeasonFromTitle(item && item.title);
    if (requestedSeason > 1) {
      if (titleSeason === requestedSeason) score += 35;
      else if (titleSeason !== null) score -= 40;
    } else if (titleSeason !== null && titleSeason !== 1) {
      score -= 30;
    }
  }
  return score;
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

function searchOneTouch(query, page) {
  var clean = String(query || "").trim();
  if (!clean) return Promise.resolve([]);
  var url = BASE_URL + "/vod/search?page=" + String(page || 1) + "&keyword=" + encodeURIComponent(clean);
  return fetchDecryptedJson(url, { "Referer": BASE_URL + "/" }).then(function(data) {
    if (Array.isArray(data)) return data;
    return data && Array.isArray(data.result) ? data.result : [];
  });
}

function getDetail(id) {
  return fetchDecryptedJson(BASE_URL + "/vod/" + encodeURIComponent(id) + "/detail", {});
}

function findBestTitle(info, mediaType, season) {
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

  return Promise.all(queries.map(function(query) { return searchOneTouch(query, 1); })).then(function(groups) {
    var seen = {};
    var candidates = [];
    groups.forEach(function(group) {
      group.forEach(function(item) {
        var id = item && item.id;
        if (id === undefined || id === null || seen[String(id)]) return;
        seen[String(id)] = true;
        candidates.push(item);
      });
    });

    candidates.sort(function(a, b) {
      return scoreCandidate(b, info, mediaType, season) - scoreCandidate(a, info, mediaType, season);
    });
    candidates = candidates.slice(0, 8);
    if (!candidates.length) throw new Error("No OneTouchTV title match");

    return Promise.all(candidates.map(function(candidate) {
      return getDetail(candidate.id).then(function(detail) {
        var score = scoreCandidate(candidate, info, mediaType, season);
        score = Math.max(score, titleScore(detail && detail.title, info.title), titleScore(detail && detail.title, info.originalTitle));
        var detailYear = String(detail && detail.year || "").match(/\d{4}/);
        if (info.year && detailYear && detailYear[0] === info.year) score += 20;
        return { candidate: candidate, detail: detail, score: score };
      }).catch(function() { return null; });
    })).then(function(matches) {
      matches = matches.filter(Boolean).sort(function(a, b) { return b.score - a.score; });
      if (!matches.length || matches[0].score < 60) throw new Error("OneTouchTV match confidence too low");
      return matches[0];
    });
  });
}

function episodeNumber(value) {
  var text = String(value === undefined || value === null ? "" : value).trim();
  if (!text) return null;
  var exact = Number(text);
  if (isFinite(exact)) return exact;
  var match = text.match(/(?:episode|ep)?\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function selectEpisode(detail, mediaType, episode) {
  var episodes = detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  if (!episodes.length) throw new Error("No OneTouchTV episodes");
  if (mediaType === "movie" || episodes.length === 1) return episodes[0];

  var requested = Number(episode || 1);
  for (var i = 0; i < episodes.length; i++) {
    if (episodeNumber(episodes[i] && episodes[i].episode) === requested) return episodes[i];
  }
  throw new Error("Episode " + requested + " not found on OneTouchTV");
}

function getEpisodePayload(identifier, playId) {
  var url = BASE_URL + "/vod/" + encodeURIComponent(identifier) + "/episode/" + encodeURIComponent(playId);
  return fetchDecryptedJson(url, {});
}

function inferQuality(source) {
  var explicit = String(source && source.quality || source && source.name || "").trim();
  var value = (explicit + " " + String(source && source.url || "")).toLowerCase();
  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) return "2160p";
  if (value.indexOf("1440") !== -1 || value.indexOf("2k") !== -1) return "1440p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return explicit || "Auto";
}

function subtitleLanguage(name) {
  var value = String(name || "").trim();
  var lower = value.toLowerCase();
  var aliases = {
    en: ["english", "eng", "en"], ms: ["malay", "malaysia", "ms"], id: ["indonesian", "indonesia", "id"],
    ko: ["korean", "kor", "ko"], zh: ["chinese", "chi", "zh", "zho"], ja: ["japanese", "jpn", "ja"],
    th: ["thai", "tha", "th"], vi: ["vietnamese", "vie", "vi"], ar: ["arabic", "ara", "ar"],
    es: ["spanish", "spa", "es"], fr: ["french", "fra", "fr"], pt: ["portuguese", "por", "pt"]
  };
  var labels = { en: "English", ms: "Malay", id: "Indonesian", ko: "Korean", zh: "Chinese", ja: "Japanese", th: "Thai", vi: "Vietnamese", ar: "Arabic", es: "Spanish", fr: "French", pt: "Portuguese" };
  var keys = Object.keys(aliases);
  for (var i = 0; i < keys.length; i++) {
    var code = keys[i];
    if (aliases[code].some(function(alias) { return lower === alias || lower.indexOf(alias) !== -1; })) {
      return { code: code, label: labels[code] };
    }
  }
  return { code: lower || "und", label: value || "Unknown" };
}

function normalizeHeaders(headers) {
  var input = headers && typeof headers === "object" ? headers : {};
  var output = {};
  Object.keys(input).forEach(function(key) {
    if (input[key] !== undefined && input[key] !== null && String(input[key]) !== "") output[key] = String(input[key]);
  });
  if (!output["User-Agent"] && !output["user-agent"]) output["User-Agent"] = USER_AGENT;
  if (!output.Referer && !output.referer) output.Referer = BASE_URL + "/";
  return output;
}

function buildSubtitles(payload) {
  var root = payload && payload.result && typeof payload.result === "object" ? payload.result : payload;
  var tracks = root && (Array.isArray(root.track) ? root.track : root.tracks);
  if (!Array.isArray(tracks)) return [];
  var seen = {};
  return tracks.map(function(track) {
    var url = String(track && track.file || "").trim();
    if (!url || seen[url]) return null;
    seen[url] = true;
    var lang = subtitleLanguage(track && track.name);
    return {
      label: lang.label,
      language: lang.label,
      lang: lang.code,
      url: url,
      default: Boolean(track && track.default),
      format: String(track && track.format || "").toLowerCase()
    };
  }).filter(Boolean);
}

function buildStreams(payload, subtitles, info, mediaType, season, episode) {
  var root = payload && payload.result && typeof payload.result === "object" ? payload.result : payload;
  var sources = root && Array.isArray(root.sources) ? root.sources : [];
  var seen = {};
  var episodeLabel = mediaType === "tv" ? " S" + String(season || 1).padStart(2, "0") + "E" + String(episode || 1).padStart(2, "0") : "";
  return sources.map(function(source, index) {
    var url = String(source && source.url || "").trim();
    if (!url || seen[url]) return null;
    seen[url] = true;
    var sourceName = String(source && source.name || "").trim();
    var quality = inferQuality(source);
    return {
      name: PROVIDER_NAME + (sourceName ? " " + sourceName : sources.length > 1 ? " Server " + (index + 1) : ""),
      title: (info.title || PROVIDER_NAME) + episodeLabel,
      url: url,
      quality: quality,
      subtitles: subtitles,
      headers: normalizeHeaders(source && source.headers)
    };
  }).filter(Boolean);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "movie" ? "movie" : "tv";
  console.log("[OneTouchTV] Request tmdbId=" + tmdbId + " type=" + type +
    (type === "tv" ? " S" + (season || 1) + "E" + (episode || 1) : ""));

  var info;
  return getTmdbInfo(tmdbId, type)
    .then(function(value) {
      info = value;
      if (!info.title) throw new Error("TMDB title is empty");
      return findBestTitle(info, type, season);
    })
    .then(function(match) {
      var selected = selectEpisode(match.detail, type, episode);
      var identifier = selected && selected.identifier;
      var playId = selected && selected.playId;
      if (!identifier || !playId) throw new Error("OneTouchTV episode identifier is missing");
      return getEpisodePayload(identifier, playId);
    })
    .then(function(payload) {
      var subtitles = buildSubtitles(payload);
      var streams = buildStreams(payload, subtitles, info, type, type === "tv" ? season || 1 : null, type === "tv" ? episode || 1 : null);
      console.log("[OneTouchTV] Direct streams found=" + streams.length + " subtitles=" + subtitles.length);
      return streams;
    })
    .catch(function(error) {
      console.error("[OneTouchTV] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams: getStreams };
