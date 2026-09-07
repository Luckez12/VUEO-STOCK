"use strict";

var PROVIDER_NAME = "KissKH";
var BASE_URL = "https://kisskh.id";
var KISSKH_VERSION = "2.8.10";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var VIDEO_KEY_API =
  "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";

var SUBTITLE_KEY_API =
  "https://script.google.com/macros/s/AKfycbyq6hTj0ZhlinYC6xbggtgo166tp6XaDKBCGtnYk8uOfYBUFwwxBui0sGXiu_zIFmA/exec?id=";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Referer": BASE_URL + "/"
};

var PROVIDER_BUDGET_MS = 17500;
var SOURCE_PIPELINE_MS = 9000;
var SUBTITLE_PIPELINE_MS = 8000;
var WEBVIEW_BUDGET_MS = 5200;

function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function(resolve, reject) {
    var settled = false;

    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          (label || "Request") +
          " timed out"
        )
      );
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

function fetchResponse(
  url,
  options,
  timeoutMs,
  label
) {
  var opts = options || {};

  var headers =
    Object.assign(
      {},
      DEFAULT_HEADERS,
      opts.headers || {}
    );

  var request = {
    method: opts.method || "GET",
    headers: headers,
    redirect:
      opts.redirect || "follow"
  };

  if (opts.body !== undefined) {
    request.body = opts.body;
  }

  return withSoftTimeout(
    fetch(url, request).then(
      function(response) {
        if (!response.ok) {
          throw new Error(
            "HTTP " +
            response.status +
            " for " +
            url
          );
        }

        return response;
      }
    ),
    timeoutMs || 3500,
    label || "KissKH request"
  );
}

function fetchJson(
  url,
  headers,
  timeoutMs,
  label
) {
  return fetchResponse(
    url,
    {
      headers: headers || {}
    },
    timeoutMs,
    label
  ).then(function(response) {
    return response.json();
  });
}

function fetchText(
  url,
  headers,
  timeoutMs,
  label
) {
  return fetchResponse(
    url,
    {
      headers: headers || {}
    },
    timeoutMs,
    label
  ).then(function(response) {
    return response.text().then(
      function(text) {
        return {
          text: text,
          url: response.url || url
        };
      }
    );
  });
}

function collectSettled(tasks, timeoutMs) {
  var list =
    Array.isArray(tasks)
      ? tasks
      : [];

  if (!list.length) {
    return Promise.resolve([]);
  }

  return new Promise(function(resolve) {
    var output = [];
    var pending = list.length;
    var done = false;

    var timer = setTimeout(
      finish,
      Math.max(1, Number(timeoutMs || 1))
    );

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(output);
    }

    list.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          if (
            !done &&
            value !== undefined &&
            value !== null
          ) {
            output.push(value);
          }
        })
        .catch(function() {})
        .then(function() {
          pending -= 1;
          if (pending <= 0) {
            finish();
          }
        });
    });
  });
}

function safeUrl(raw, base) {
  var value =
    String(raw || "")
      .trim()
      .replace(/&amp;/g, "&")
      .replace(/\\\//g, "/");

  if (!value) return "";

  try {
    return new URL(
      value,
      base || BASE_URL + "/"
    ).toString();
  } catch (_) {
    return "";
  }
}

function normalizeTitle(value) {
  var text =
    String(value || "")
      .toLowerCase();

  try {
    if (typeof text.normalize === "function") {
      text =
        text.normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "");
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

  if (
    left.indexOf(right) !== -1 ||
    right.indexOf(left) !== -1
  ) {
    return 82;
  }

  var leftWords =
    left.split(" ")
      .filter(function(word) {
        return word.length > 1;
      });

  var rightWords =
    right.split(" ")
      .filter(function(word) {
        return word.length > 1;
      });

  if (
    !leftWords.length ||
    !rightWords.length
  ) {
    return 0;
  }

  var set = {};
  leftWords.forEach(function(word) {
    set[word] = true;
  });

  var matched =
    rightWords.filter(function(word) {
      return set[word];
    }).length;

  if (!matched) return 0;

  return Math.round(
    (
      matched / rightWords.length * 0.75 +
      matched / leftWords.length * 0.25
    ) * 72
  );
}


/* VUEO_TITLE_PROFILE_V1 */
function collectTmdbAliases(data, mediaType) {
  var output = [];
  var seen = {};

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;

    seen[key] = true;
    output.push({
      title: text,
      priority: Number(priority || 0)
    });
  }

  add(data && (data.title || data.name), 100);
  add(
    data &&
    (
      data.original_title ||
      data.original_name
    ),
    95
  );

  var altRoot =
    data &&
    data.alternative_titles;

  var altItems =
    altRoot &&
    (
      Array.isArray(altRoot.titles)
        ? altRoot.titles
        : Array.isArray(altRoot.results)
          ? altRoot.results
          : []
    );

  altItems.forEach(function(item) {
    if (!item) return;

    var country =
      String(
        item.iso_3166_1 || ""
      ).toUpperCase();

    var boost =
      country === "US" ||
      country === "GB"
        ? 86
        : country === "MY" ||
          country === "ID"
          ? 82
          : 72;

    add(
      item.title ||
      item.name,
      boost
    );
  });

  var translations =
    data &&
    data.translations &&
    Array.isArray(
      data.translations.translations
    )
      ? data.translations.translations
      : [];

  translations.forEach(function(item) {
    var row =
      item &&
      item.data &&
      typeof item.data === "object"
        ? item.data
        : {};

    var lang =
      String(
        item &&
        item.iso_639_1 ||
        ""
      ).toLowerCase();

    var boost =
      lang === "en"
        ? 88
        : lang === "ms" ||
          lang === "id"
          ? 80
          : 68;

    add(
      row.title ||
      row.name,
      boost
    );
  });

  output.sort(function(a, b) {
    return b.priority - a.priority;
  });

  return output
    .map(function(item) {
      return item.title;
    })
    .slice(0, 12);
}

function bestAliasTitleScore(candidate, info) {
  var aliases =
    info &&
    Array.isArray(info.aliases) &&
    info.aliases.length
      ? info.aliases
      : [
          info && info.title,
          info && info.originalTitle
        ];

  var best = 0;

  aliases.forEach(function(alias) {
    best = Math.max(
      best,
      titleScore(
        candidate,
        alias
      )
    );
  });

  return best;
}

function buildAliasQueries(info, limit) {
  var output = [];
  var seen = {};

  var aliases =
    info &&
    Array.isArray(info.aliases)
      ? info.aliases
      : [
          info && info.title,
          info && info.originalTitle
        ];

  aliases.forEach(function(alias) {
    var text =
      String(alias || "")
        .trim();

    var key =
      normalizeTitle(text);

    if (
      !text ||
      !key ||
      seen[key]
    ) {
      return;
    }

    seen[key] = true;
    output.push(text);
  });

  return output.slice(
    0,
    Math.max(
      1,
      Number(limit || 4)
    )
  );
}

function yearOf(item) {
  var raw =
    String(
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

  var match =
    raw.match(/\b(19|20)\d{2}\b/);

  return match
    ? match[0]
    : "";
}

function sourceMediaType(item) {
  var value =
    String(
      item &&
      (
        item.type ||
        item.mediaType ||
        item.media_type
      ) ||
      ""
    )
      .trim()
      .toLowerCase();

  if (!value) return "";

  if (
    value.indexOf("movie") !== -1 ||
    value.indexOf("film") !== -1
  ) {
    return "movie";
  }

  if (
    value.indexOf("series") !== -1 ||
    value.indexOf("drama") !== -1 ||
    value.indexOf("anime") !== -1 ||
    value.indexOf("tv") !== -1
  ) {
    return "tv";
  }

  return "";
}

function explicitSeason(title) {
  var value =
    String(title || "");

  var match =
    value.match(
      /\b(?:season|series)\s*(\d{1,2})\b/i
    );

  if (!match) {
    match =
      value.match(
        /\bS(\d{1,2})\b/i
      );
  }

  return match
    ? Number(match[1]) || 0
    : 0;
}

function candidateScore(
  item,
  info,
  mediaType,
  season
) {
  var candidateTitle =
    item &&
    (
      item.title ||
      item.name
    );

  var score =
    bestAliasTitleScore(
      candidateTitle,
      info
    );

  var itemYear =
    yearOf(item);

  if (
    info.year &&
    itemYear
  ) {
    if (
      String(info.year) ===
      String(itemYear)
    ) {
      score += 25;
    } else {
      score -= 18;
    }
  }

  var detectedType =
    sourceMediaType(item);

  if (detectedType) {
    if (detectedType === mediaType) {
      score += 25;
    } else {
      score -= 90;
    }
  }

  if (mediaType === "tv") {
    var wantedSeason =
      Math.max(
        1,
        Number(season || 1)
      );

    var itemSeason =
      explicitSeason(candidateTitle);

    if (itemSeason) {
      if (itemSeason === wantedSeason) {
        score += 48;
      } else {
        score -= 65;
      }
    } else if (wantedSeason > 1) {
      score -= 6;
    }
  }

  return score;
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
  ) {
    return "2160p";
  }

  if (value.indexOf("1440") !== -1) {
    return "1440p";
  }

  if (value.indexOf("1080") !== -1) {
    return "1080p";
  }

  if (value.indexOf("720") !== -1) {
    return "720p";
  }

  if (value.indexOf("480") !== -1) {
    return "480p";
  }

  if (value.indexOf("360") !== -1) {
    return "360p";
  }

  return "Auto";
}

function isDirectStream(url) {
  var value =
    String(url || "")
      .toLowerCase();

  return (
    value.indexOf(".m3u8") !== -1 ||
    value.indexOf(".mp4") !== -1 ||
    value.indexOf(".m4v") !== -1 ||
    value.indexOf("/sora/") !== -1
  );
}

function getTmdbInfo(
  tmdbId,
  mediaType
) {
  var endpoint =
    mediaType === "movie"
      ? "movie"
      : "tv";

  var url =
    "https://api.themoviedb.org/3/" +
    endpoint +
    "/" +
    encodeURIComponent(tmdbId) +
    "?api_key=" +
    TMDB_API_KEY +
    "&append_to_response=alternative_titles,translations,external_ids";

  return fetchJson(
    url,
    {},
    1800,
    "KissKH TMDB"
  ).then(function(data) {
    return {
      title:
        String(
          data &&
          (
            data.title ||
            data.name
          ) ||
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
        ).trim(),

      year:
        String(
          data &&
          (
            data.release_date ||
            data.first_air_date
          ) ||
          ""
        ).split("-")[0],
      aliases:
        collectTmdbAliases(
          data,
          mediaType
        )
    };
  });
}

function searchKissKh(query) {
  var url =
    BASE_URL +
    "/api/DramaList/Search?q=" +
    encodeURIComponent(
      String(query || "").trim()
    ) +
    "&type=0";

  return fetchJson(
    url,
    {},
    2600,
    "KissKH search"
  ).then(function(data) {
    return Array.isArray(data)
      ? data
      : [];
  });
}

function getDramaDetail(id) {
  var url =
    BASE_URL +
    "/api/DramaList/Drama/" +
    encodeURIComponent(id) +
    "?isq=false";

  return fetchJson(
    url,
    {},
    3000,
    "KissKH detail"
  );
}

function buildSearchQueries(
  info,
  mediaType,
  season
) {
  var output = [];
  var seen = {};

  function add(value) {
    var text =
      String(value || "")
        .trim();

    var key =
      normalizeTitle(text);

    if (
      !text ||
      !key ||
      seen[key]
    ) {
      return;
    }

    seen[key] = true;
    output.push(text);
  }

  var aliases =
    buildAliasQueries(
      info,
      5
    );

  if (
    mediaType === "tv" &&
    Number(season || 1) > 1
  ) {
    aliases.slice(0, 3)
      .forEach(function(alias) {
        add(
          alias +
          " Season " +
          Number(season)
        );
      });
  }

  aliases.forEach(add);

  return output.slice(0, 7);
}
function findBestDrama(
  info,
  mediaType,
  season
) {
  var queries =
    buildSearchQueries(
      info,
      mediaType,
      season
    );

  return collectSettled(
    queries.map(function(query) {
      return searchKissKh(query).then(
        function(items) {
          return {
            query: query,
            items: items
          };
        }
      );
    }),
    3500
  ).then(function(groups) {
    var seen = {};
    var candidates = [];

    groups.forEach(
      function(group, queryIndex) {
        (group.items || [])
          .forEach(function(item, rank) {
            if (
              !item ||
              item.id === undefined ||
              item.id === null
            ) {
              return;
            }

            var key =
              String(item.id);

            if (seen[key]) {
              return;
            }

            seen[key] = true;

            candidates.push({
              item: item,
              score:
                candidateScore(
                  item,
                  info,
                  mediaType,
                  season
                ) +
                Math.max(
                  0,
                  10 - rank
                ) +
                Math.max(
                  0,
                  4 - queryIndex
                )
            });
          });
      }
    );

    candidates.sort(function(a, b) {
      return b.score - a.score;
    });

    candidates =
      candidates.slice(0, 4);

    if (!candidates.length) {
      throw new Error(
        "No KissKH title match"
      );
    }

    return collectSettled(
      candidates.map(function(candidate) {
        return getDramaDetail(
          candidate.item.id
        ).then(function(detail) {
          if (!detail) return null;

          var detailScore =
            candidateScore(
              detail,
              info,
              mediaType,
              season
            );

          return {
            detail: detail,
            score:
              Math.max(
                candidate.score,
                detailScore
              ) +
              Math.min(
                candidate.score,
                detailScore
              ) * 0.12
          };
        });
      }),
      3900
    );
  }).then(function(matches) {
    matches =
      matches
        .filter(Boolean)
        .sort(function(a, b) {
          return b.score - a.score;
        });

    if (
      !matches.length ||
      matches[0].score < 45
    ) {
      throw new Error(
        "KissKH match confidence too low"
      );
    }

    return matches[0].detail;
  });
}

function selectEpisode(
  detail,
  mediaType,
  season,
  episode
) {
  var episodes =
    Array.isArray(
      detail &&
      detail.episodes
    )
      ? detail.episodes
      : [];

  if (!episodes.length) {
    throw new Error(
      "No KissKH episodes"
    );
  }

  if (
    mediaType === "movie" ||
    episodes.length === 1
  ) {
    return episodes[0];
  }

  var requestedEpisode =
    Math.max(
      1,
      Number(episode || 1)
    );

  var exact =
    episodes.find(function(item) {
      return (
        Number(
          item &&
          item.number
        ) === requestedEpisode
      );
    });

  if (exact) {
    return exact;
  }

  var numbered =
    episodes.filter(function(item) {
      return Number.isFinite(
        Number(
          item &&
          item.number
        )
      );
    });

  /*
   * Only use positional fallback when KissKH exposes no episode numbers at all.
   * If some numbers exist, guessing a missing episode is more dangerous than
   * returning no result.
   */
  if (
    !numbered.length &&
    episodes.length >= requestedEpisode
  ) {
    return episodes[
      requestedEpisode - 1
    ];
  }

  throw new Error(
    "Episode " +
    requestedEpisode +
    " not found on KissKH"
  );
}

function slugify(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function episodeNumberText(value) {
  var number =
    Number(value);

  if (!Number.isFinite(number)) {
    return "";
  }

  return (
    number % 1 === 0
      ? String(Math.trunc(number))
      : String(number)
  );
}

function episodeReferer(
  detail,
  selected
) {
  var title =
    String(
      detail &&
      detail.title ||
      ""
    );

  var dramaId =
    detail &&
    detail.id;

  var episodeId =
    selected &&
    selected.id;

  var epNumber =
    episodeNumberText(
      selected &&
      selected.number
    );

  if (
    !title ||
    dramaId === undefined ||
    episodeId === undefined
  ) {
    return BASE_URL + "/";
  }

  return (
    BASE_URL +
    "/Drama/" +
    slugify(title) +
    "/Episode-" +
    (epNumber || "1") +
    "?id=" +
    encodeURIComponent(dramaId) +
    "&ep=" +
    encodeURIComponent(episodeId) +
    "&page=0&pageSize=100"
  );
}

function getKey(
  endpoint,
  episodeId,
  label
) {
  var url =
    endpoint +
    encodeURIComponent(episodeId) +
    "&version=" +
    encodeURIComponent(
      KISSKH_VERSION
    );

  return fetchJson(
    url,
    {},
    4500,
    label
  ).then(function(data) {
    var key =
      String(
        data &&
        data.key ||
        ""
      ).trim();

    if (!key) {
      throw new Error(
        "Empty " + label
      );
    }

    return key;
  });
}

function getSources(
  detail,
  selected,
  key
) {
  var episodeId =
    selected.id;

  var url =
    BASE_URL +
    "/api/DramaList/Episode/" +
    encodeURIComponent(episodeId) +
    ".png?err=false&ts=&time=&kkey=" +
    encodeURIComponent(key);

  return fetchJson(
    url,
    {
      "Origin": BASE_URL,
      "Referer":
        episodeReferer(
          detail,
          selected
        )
    },
    4800,
    "KissKH video API"
  );
}

function subtitleLanguage(label) {
  var value =
    String(label || "")
      .trim();

  var lower =
    value.toLowerCase()
      .replace(/_/g, "-");

  var aliases = {
    en: [
      "en",
      "eng",
      "english"
    ],
    ms: [
      "ms",
      "msa",
      "may",
      "malay",
      "bahasa melayu",
      "bahasa malaysia"
    ],
    id: [
      "id",
      "ind",
      "indonesian",
      "indonesia",
      "bahasa indonesia"
    ],
    ko: [
      "ko",
      "kor",
      "korean"
    ],
    zh: [
      "zh",
      "chi",
      "zho",
      "chinese",
      "mandarin"
    ],
    th: [
      "th",
      "tha",
      "thai"
    ],
    ja: [
      "ja",
      "jpn",
      "japanese"
    ],
    vi: [
      "vi",
      "vie",
      "vietnamese"
    ]
  };

  var labels = {
    en: "English",
    ms: "Malay",
    id: "Indonesian",
    ko: "Korean",
    zh: "Chinese",
    th: "Thai",
    ja: "Japanese",
    vi: "Vietnamese"
  };

  var codes =
    Object.keys(aliases);

  for (
    var i = 0;
    i < codes.length;
    i += 1
  ) {
    var code =
      codes[i];

    var match =
      aliases[code].some(
        function(alias) {
          return (
            lower === alias ||
            lower.indexOf(alias) !== -1
          );
        }
      );

    if (match) {
      return {
        code: code,
        label: labels[code]
      };
    }
  }

  return {
    code:
      lower || "und",
    label:
      value || "Unknown"
  };
}

function subtitleFormat(url) {
  var value =
    String(url || "")
      .toLowerCase()
      .split("?")[0];

  if (value.endsWith(".srt")) {
    return "srt";
  }

  if (
    value.endsWith(".vtt") ||
    value.endsWith(".webvtt")
  ) {
    return "vtt";
  }

  if (value.endsWith(".ass")) {
    return "ass";
  }

  if (value.endsWith(".ssa")) {
    return "ssa";
  }

  if (value.endsWith(".txt")) {
    return "srt";
  }

  return "";
}

function cryptoJsOrNull() {
  try {
    if (
      typeof globalThis !== "undefined" &&
      globalThis.CryptoJS
    ) {
      return globalThis.CryptoJS;
    }
  } catch (_) {}

  try {
    if (typeof require === "function") {
      var loaded =
        require("crypto-js");

      if (
        loaded &&
        loaded.AES
      ) {
        return loaded;
      }
    }
  } catch (_) {}

  return null;
}

function decryptSubtitleLine(
  encryptedB64
) {
  var CryptoJS =
    cryptoJsOrNull();

  if (!CryptoJS) {
    return "";
  }

  var pairs = [
    {
      key: "AmSmZVcH93UQUezi",
      iv:
        "5265424b5757386371646a50456e4636"
    },
    {
      key: "8056483646328763",
      iv:
        "36383532363132333730313835323733"
    }
  ];

  for (
    var i = 0;
    i < pairs.length;
    i += 1
  ) {
    try {
      var pair =
        pairs[i];

      var params =
        CryptoJS.lib.CipherParams.create({
          ciphertext:
            CryptoJS.enc.Base64.parse(
              String(encryptedB64 || "").trim()
            )
        });

      var decrypted =
        CryptoJS.AES.decrypt(
          params,
          CryptoJS.enc.Utf8.parse(
            pair.key
          ),
          {
            iv:
              CryptoJS.enc.Hex.parse(
                pair.iv
              ),
            mode:
              CryptoJS.mode.CBC,
            padding:
              CryptoJS.pad.Pkcs7
          }
        )
          .toString(
            CryptoJS.enc.Utf8
          )
          .trim();

      if (decrypted) {
        return decrypted;
      }
    } catch (_) {}
  }

  return "";
}

function decryptKissSubtitleText(text) {
  var source =
    String(text || "");

  /*
   * KissKH encrypted .txt subtitles are SRT-like blocks:
   * numeric cue index, timecode, then AES/Base64 text lines.
   */
  var chunks =
    source
      .split(/^\d+\s*$/gm)
      .map(function(chunk) {
        return chunk.trim();
      })
      .filter(Boolean);

  var output = [];

  chunks.forEach(
    function(chunk, index) {
      var parts =
        chunk.split(/\r?\n/);

      if (!parts.length) {
        return;
      }

      var timeCode =
        String(parts.shift() || "")
          .trim();

      if (
        timeCode.indexOf("-->") === -1
      ) {
        return;
      }

      var textLines =
        parts.map(function(line) {
          var value =
            String(line || "").trim();

          if (!value) {
            return "";
          }

          return (
            decryptSubtitleLine(value) ||
            ""
          );
        });

      var caption =
        textLines
          .join("\n")
          .trim();

      if (!caption) {
        return;
      }

      output.push(
        String(index + 1) +
        "\n" +
        timeCode +
        "\n" +
        caption
      );
    }
  );

  return output.join("\n\n");
}

function maybeDecryptSubtitle(
  subtitle
) {
  var url =
    String(
      subtitle &&
      subtitle.url ||
      ""
    );

  if (
    !url ||
    url.toLowerCase()
      .split("?")[0]
      .indexOf(".txt") === -1
  ) {
    return Promise.resolve(
      subtitle
    );
  }

  if (!cryptoJsOrNull()) {
    return Promise.resolve(
      subtitle
    );
  }

  return fetchText(
    url,
    {
      "Referer": BASE_URL + "/"
    },
    3200,
    "KissKH encrypted subtitle"
  ).then(function(result) {
    if (
      !result.text ||
      result.text.length > 350000
    ) {
      return subtitle;
    }

    var decrypted =
      decryptKissSubtitleText(
        result.text
      );

    if (!decrypted) {
      return subtitle;
    }

    var copy =
      Object.assign(
        {},
        subtitle
      );

    copy.url =
      "data:application/x-subrip;charset=utf-8," +
      encodeURIComponent(decrypted);

    copy.format = "srt";
    copy.sourceUrl = url;

    return copy;
  }).catch(function() {
    return subtitle;
  });
}

function getSubtitles(
  selected
) {
  var episodeId =
    selected.id;

  return getKey(
    SUBTITLE_KEY_API,
    episodeId,
    "KissKH subtitle key"
  )
    .then(function(key) {
      var url =
        BASE_URL +
        "/api/Sub/" +
        encodeURIComponent(episodeId) +
        "?kkey=" +
        encodeURIComponent(key);

      return fetchJson(
        url,
        {
          "Referer": BASE_URL + "/"
        },
        4600,
        "KissKH subtitle API"
      );
    })
    .then(function(data) {
      var list =
        Array.isArray(data)
          ? data
          : [];

      var seen = {};

      var subtitles =
        list.map(function(item) {
          var url =
            safeUrl(
              item &&
              (
                item.src ||
                item.url ||
                item.file
              ),
              BASE_URL + "/"
            );

          if (
            !url ||
            seen[url]
          ) {
            return null;
          }

          seen[url] = true;

          var lang =
            subtitleLanguage(
              item &&
              (
                item.label ||
                item.language ||
                item.lang
              )
            );

          return {
            label: lang.label,
            language: lang.label,
            lang: lang.code,
            url: url,
            default:
              Boolean(
                item &&
                (
                  item.default ||
                  item.isDefault
                )
              ),
            format:
              subtitleFormat(url)
          };
        })
        .filter(Boolean);

      return collectSettled(
        subtitles.map(
          maybeDecryptSubtitle
        ),
        3800
      );
    })
    .catch(function(error) {
      console.log(
        "[KissKH] subtitle pipeline failed: " +
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

function extractMediaFromText(
  text,
  pageUrl
) {
  var source =
    String(text || "")
      .replace(/\\\//g, "/");

  var output = [];
  var seen = {};

  function add(raw, label) {
    var url =
      safeUrl(
        raw,
        pageUrl
      );

    if (
      !url ||
      !isDirectStream(url) ||
      seen[url]
    ) {
      return;
    }

    seen[url] = true;

    output.push({
      url: url,
      quality:
        inferQuality(
          url,
          label
        ),
      referer: pageUrl,
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": pageUrl
      }
    });
  }

  var directRegex =
    /https?:\/\/[^\s"'<>\\]+?(?:\.m3u8|\.mp4|\.m4v)(?:\?[^\s"'<>\\]*)?/gi;

  var direct;

  while (
    (direct = directRegex.exec(source))
  ) {
    add(
      direct[0],
      ""
    );
  }

  var attrRegex =
    /(?:file|source|src)\s*[:=]\s*["']([^"']+)["']/gi;

  var attr;

  while (
    (attr = attrRegex.exec(source))
  ) {
    add(
      attr[1],
      ""
    );
  }

  var tagRegex =
    /<(?:video|source)\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi;

  var tag;

  while (
    (tag = tagRegex.exec(source))
  ) {
    add(
      tag[2],
      ""
    );
  }

  return output;
}

function extractIframes(
  text,
  pageUrl
) {
  var source =
    String(text || "");

  var seen = {};
  var output = [];

  var regex =
    /<iframe\b[^>]*(?:src|data-src)\s*=\s*(["'])(.*?)\1[^>]*>/gi;

  var match;

  while (
    (match = regex.exec(source))
  ) {
    var url =
      safeUrl(
        match[2],
        pageUrl
      );

    if (
      !url ||
      seen[url]
    ) {
      continue;
    }

    seen[url] = true;
    output.push(url);

    if (output.length >= 4) {
      break;
    }
  }

  return output;
}

function nativeWebViewAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function sanitizePlaybackHeaders(
  rawHeaders,
  fallbackReferer
) {
  var input =
    rawHeaders &&
    typeof rawHeaders === "object"
      ? rawHeaders
      : {};

  var output = {};

  Object.keys(input)
    .forEach(function(key) {
      var lower =
        String(key || "")
          .toLowerCase();

      if (
        lower === "host" ||
        lower === "connection" ||
        lower === "content-length" ||
        lower === "accept-encoding" ||
        lower === "range" ||
        lower.indexOf("sec-fetch-") === 0
      ) {
        return;
      }

      output[key] =
        String(input[key]);
    });

  output["User-Agent"] =
    output["User-Agent"] ||
    output["user-agent"] ||
    USER_AGENT;

  var capturedReferer =
    output["Referer"] ||
    output["referer"] ||
    "";

  delete output["referer"];

  output["Referer"] =
    capturedReferer ||
    fallbackReferer ||
    BASE_URL + "/";

  return output;
}

function resolveWithWebView(
  url,
  referer,
  label
) {
  if (!nativeWebViewAvailable()) {
    return Promise.resolve([]);
  }

  return globalThis.webviewResolve(
    url,
    {
      referer:
        referer || BASE_URL + "/",
      timeoutMs:
        WEBVIEW_BUDGET_MS,
      finishAfterFirstMs: 650,
      suppressPopups: true,
      match: [
        ".m3u8",
        ".mp4",
        ".m4v",
        "/sora/"
      ],
      blocked: [
        "doubleclick",
        "googlesyndication",
        "/ads/",
        "vast"
      ]
    }
  )
    .then(function(result) {
      var streams =
        result &&
        Array.isArray(result.streams)
          ? result.streams
          : [];

      var seen = {};

      return streams
        .map(function(item) {
          var mediaUrl =
            String(
              item &&
              item.url ||
              ""
            ).trim();

          if (
            !mediaUrl ||
            !isDirectStream(mediaUrl) ||
            seen[mediaUrl]
          ) {
            return null;
          }

          seen[mediaUrl] = true;

          return {
            url: mediaUrl,
            quality:
              inferQuality(
                mediaUrl,
                item &&
                (
                  item.label ||
                  label
                )
              ),
            referer: url,
            headers:
              sanitizePlaybackHeaders(
                item && item.headers,
                url
              ),
            serverLabel:
              label || "WebView"
          };
        })
        .filter(Boolean);
    })
    .catch(function(error) {
      console.log(
        "[KissKH] WebView failed host=" +
        url +
        " error=" +
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

function resolveHttpSource(
  url,
  referer,
  label,
  depth
) {
  var absolute =
    safeUrl(
      url,
      referer || BASE_URL + "/"
    );

  if (!absolute) {
    return Promise.resolve([]);
  }

  if (isDirectStream(absolute)) {
    return Promise.resolve([
      {
        url: absolute,
        quality:
          inferQuality(
            absolute,
            label
          ),
        referer:
          referer || BASE_URL + "/",
        headers: {
          "User-Agent": USER_AGENT,
          "Referer":
            referer || BASE_URL + "/",
          "Origin": BASE_URL
        },
        serverLabel: label
      }
    ]);
  }

  var currentDepth =
    Number(depth || 0);

  return fetchText(
    absolute,
    {
      "Referer":
        referer || BASE_URL + "/",
      "Accept":
        "text/html,application/xhtml+xml,*/*"
    },
    2800,
    "KissKH third-party"
  )
    .then(function(result) {
      var finalUrl =
        result.url || absolute;

      if (isDirectStream(finalUrl)) {
        return [
          {
            url: finalUrl,
            quality:
              inferQuality(
                finalUrl,
                label
              ),
            referer: absolute,
            headers: {
              "User-Agent": USER_AGENT,
              "Referer": absolute
            },
            serverLabel: label
          }
        ];
      }

      var direct =
        extractMediaFromText(
          result.text,
          finalUrl
        );

      direct.forEach(function(item) {
        item.serverLabel = label;
      });

      if (
        direct.length ||
        currentDepth >= 1
      ) {
        return direct;
      }

      var iframes =
        extractIframes(
          result.text,
          finalUrl
        );

      if (!iframes.length) {
        return [];
      }

      return collectSettled(
        iframes.map(function(child) {
          return resolveHttpSource(
            child,
            finalUrl,
            label,
            currentDepth + 1
          );
        }),
        3500
      ).then(function(groups) {
        var output = [];
        groups.forEach(function(group) {
          if (Array.isArray(group)) {
            output.push.apply(
              output,
              group
            );
          }
        });
        return output;
      });
    })
    .catch(function() {
      return [];
    })
    .then(function(staticStreams) {
      if (
        staticStreams &&
        staticStreams.length
      ) {
        return staticStreams;
      }

      return resolveWithWebView(
        absolute,
        referer || BASE_URL + "/",
        label
      );
    });
}

function buildSourceCandidates(source) {
  var values = [
    {
      value:
        source &&
        source.Video,
      label: "Primary"
    },
    {
      value:
        source &&
        source.ThirdParty,
      label: "ThirdParty"
    }
  ];

  var seen = {};

  return values
    .map(function(item) {
      var url =
        String(
          item.value || ""
        ).trim();

      if (
        !url ||
        seen[url]
      ) {
        return null;
      }

      seen[url] = true;

      return {
        url: url,
        label: item.label
      };
    })
    .filter(Boolean);
}

function resolveVideoPipeline(
  detail,
  selected
) {
  return getKey(
    VIDEO_KEY_API,
    selected.id,
    "KissKH video key"
  )
    .then(function(key) {
      return getSources(
        detail,
        selected,
        key
      );
    })
    .then(function(source) {
      var candidates =
        buildSourceCandidates(
          source
        );

      if (!candidates.length) {
        throw new Error(
          "KissKH video API returned no source"
        );
      }

      var referer =
        episodeReferer(
          detail,
          selected
        );

      return collectSettled(
        candidates.map(
          function(candidate) {
            return resolveHttpSource(
              candidate.url,
              referer,
              candidate.label,
              0
            );
          }
        ),
        SOURCE_PIPELINE_MS
      );
    })
    .then(function(groups) {
      var seen = {};
      var streams = [];

      groups.forEach(function(group) {
        (Array.isArray(group) ? group : [])
          .forEach(function(stream) {
            var url =
              String(
                stream &&
                stream.url ||
                ""
              ).trim();

            if (
              !url ||
              seen[url]
            ) {
              return;
            }

            seen[url] = true;
            streams.push(stream);
          });
      });

      return streams;
    })
    .catch(function(error) {
      console.log(
        "[KissKH] video pipeline failed: " +
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

function buildStreams(
  resolved,
  subtitles,
  info,
  mediaType,
  season,
  episode
) {
  var seen = {};

  var episodeLabel =
    mediaType === "tv"
      ? " S" +
        String(
          season || 1
        ).padStart(2, "0") +
        "E" +
        String(
          episode || 1
        ).padStart(2, "0")
      : "";

  return (resolved || [])
    .map(function(source, index) {
      var url =
        String(
          source &&
          source.url ||
          ""
        ).trim();

      if (
        !url ||
        seen[url]
      ) {
        return null;
      }

      seen[url] = true;

      var server =
        String(
          source &&
          source.serverLabel ||
          ""
        ).trim();

      var quality =
        source.quality ||
        inferQuality(
          url,
          server
        );

      return {
        name:
          PROVIDER_NAME +
          (
            server
              ? " " + server
              : resolved.length > 1
                ? " Server " + (index + 1)
                : ""
          ),
        title:
          (info.title || PROVIDER_NAME) +
          episodeLabel,
        url: url,
        quality: quality,
        type: "direct",
        subtitles:
          Array.isArray(subtitles)
            ? subtitles
            : [],
        headers:
          sanitizePlaybackHeaders(
            source.headers,
            source.referer ||
              BASE_URL + "/"
          )
      };
    })
    .filter(Boolean);
}

function getStreams(
  tmdbId,
  mediaType,
  season,
  episode
) {
  var type =
    mediaType === "movie"
      ? "movie"
      : "tv";

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

  var id =
    String(tmdbId || "")
      .trim();

  if (!id) {
    return Promise.resolve([]);
  }

  console.log(
    "[KissKH] Request tmdbId=" +
    id +
    " type=" +
    type +
    (
      type === "tv"
        ? " S" +
          requestedSeason +
          "E" +
          requestedEpisode
        : ""
    )
  );

  var info;

  var work =
    getTmdbInfo(
      id,
      type
    )
      .then(function(value) {
        info = value;

        if (!info.title) {
          throw new Error(
            "TMDB title is empty"
          );
        }

        return findBestDrama(
          info,
          type,
          requestedSeason
        );
      })
      .then(function(detail) {
        var selected =
          selectEpisode(
            detail,
            type,
            requestedSeason,
            requestedEpisode
          );

        if (
          !selected ||
          selected.id === undefined ||
          selected.id === null
        ) {
          throw new Error(
            "KissKH episode ID is missing"
          );
        }

        var videoTask =
          withSoftTimeout(
            resolveVideoPipeline(
              detail,
              selected
            ),
            SOURCE_PIPELINE_MS,
            "KissKH video pipeline"
          ).catch(function() {
            return [];
          });

        var subtitleTask =
          withSoftTimeout(
            getSubtitles(
              selected
            ),
            SUBTITLE_PIPELINE_MS,
            "KissKH subtitle pipeline"
          ).catch(function() {
            return [];
          });

        return Promise.all([
          videoTask,
          subtitleTask
        ]);
      })
      .then(function(results) {
        var streams =
          buildStreams(
            results[0],
            results[1],
            info,
            type,
            type === "tv"
              ? requestedSeason
              : null,
            type === "tv"
              ? requestedEpisode
              : null
          );

        console.log(
          "[KissKH] streams=" +
          streams.length +
          " subtitles=" +
          (
            streams[0] &&
            Array.isArray(
              streams[0].subtitles
            )
              ? streams[0].subtitles.length
              : 0
          )
        );

        return streams;
      });

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    "KissKH provider"
  ).catch(function(error) {
    console.error(
      "[KissKH] " +
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
