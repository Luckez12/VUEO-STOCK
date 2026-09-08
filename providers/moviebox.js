"use strict";

/* VUEO_PROVIDER_REPAIR_V16 */

var PROVIDER_NAME = "MovieBox";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var MOVIEBOX_WEB = "https://moviebox.asia";

var WEB_HOSTS = [
  "https://moviebox.ph",
  "https://moviebox.pk",
  "https://moviebox.ng",
  "https://filmboom.top"
];

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
var WEBVIEW_BUDGET_MS = 5200;
var SEARCH_COLLECT_MS = 4300;
var DETAIL_RACE_MS = 3400;
var PLAY_COLLECT_MS = 5600;
var CAPTION_COLLECT_MS = 3400;

var preferredWebHost = null;
var unhealthyWebHosts = Object.create(null);

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function vueoSharedTmdb(url, fallback) {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.vueoDiscoveryContext === "function"
  ) {
    return globalThis.vueoDiscoveryContext(url)
      .then(function(context) {
        if (context && context.tmdb) {
          if (typeof globalThis.vueoTrace === "function") {
            globalThis.vueoTrace("METADATA", {
              shared: true,
              title: context.title || "",
              year: context.year || "",
              imdbId: context.imdbId || "",
              aliases: Array.isArray(context.aliases) ? context.aliases.length : 0
            });
          }
          return context.tmdb;
        }
        throw new Error("Shared discovery context is empty");
      })
      .catch(function(error) {
        if (typeof globalThis.vueoTrace === "function") {
          globalThis.vueoTrace("METADATA_FALLBACK", {
            reason: error && error.message ? error.message : String(error)
          });
        }
        return fallback();
      });
  }
  return fallback();
}

function vueoCandidateTrace(stage, details) {
  try {
    if (
      typeof globalThis !== "undefined" &&
      typeof globalThis.vueoTrace === "function"
    ) {
      globalThis.vueoTrace(stage, details || {});
    }
  } catch (_) {}
}

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

function firstNonEmptyStreams(tasks, timeoutMs) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return Promise.resolve([]);
  }

  return new Promise(function(resolve) {
    var settled = false;
    var pending = tasks.length;

    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(Array.isArray(value) ? value : []);
    }

    tasks.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          if (settled) return;

          if (Array.isArray(value) && value.length) {
            finish(value);
            return;
          }

          pending -= 1;
          if (pending <= 0) finish([]);
        })
        .catch(function() {
          pending -= 1;
          if (pending <= 0) finish([]);
        });
    });

    setTimeout(function() {
      finish([]);
    }, timeoutMs);
  });
}

function raceFirstValid(tasks, timeoutMs) {
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
      finish(null);
    }, timeoutMs);
  });
}

function collectSettled(tasks, timeoutMs) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return Promise.resolve([]);
  }

  return new Promise(function(resolve) {
    var results = [];
    var pending = tasks.length;
    var settled = false;

    function finish() {
      if (settled) return;
      settled = true;
      resolve(results);
    }

    tasks.forEach(function(task) {
      Promise.resolve(task)
        .then(function(value) {
          if (value) results.push(value);
        })
        .catch(function() {})
        .then(function() {
          pending -= 1;
          if (pending <= 0) finish();
        });
    });

    setTimeout(finish, timeoutMs);
  });
}

function fetchJson(url, options, timeoutMs, label) {
  var opts = options || {};

  var headers = Object.assign(
    {},
    COMMON_HEADERS,
    opts.headers || {}
  );

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
        throw new Error(
          "HTTP " +
          response.status +
          " for " +
          url
        );
      }

      return response.json();
    }),
    timeoutMs || 3200,
    label || "MovieBox request"
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
    TMDB_API_KEY +
    "&append_to_response=alternative_titles,translations,external_ids";

  return vueoSharedTmdb(
    url,
    function() {
      return fetchJson(
        url,
        {
          headers: {
            "Accept": "application/json"
          }
        },
        1300,
        "TMDB"
      );
    }
  ).then(function(data) {
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

  if (!leftWords.length || !rightWords.length) {
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


/* VUEO_DISCOVERY_REBUILD_V1 */
function cleanDiscoveryTitleMovieBox(value) {
  return normalizeTitle(
    String(value || "")
      .replace(/\[(?:[^\]]{0,120})\]/g, " ")
      .replace(/\b(?:19|20)\d{2}\b/g, " ")
      .replace(/\bseason\s*\d{1,2}\b/gi, " ")
      .replace(/\bs\d{1,2}\b/gi, " ")
      .replace(/\b(?:ep|episode|e)\s*[-#:]?\s*\d{1,3}\b/gi, " ")
      .replace(/\b(?:2160p|1080p|720p|480p|4k|web[- ]?dl|bluray|hevc|h26[45]|10bit|series|movie)\b/gi, " ")
  );
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
  var cleanCandidate =
    cleanDiscoveryTitleMovieBox(
      candidate
    );

  aliases.forEach(function(alias) {
    var cleanAlias =
      cleanDiscoveryTitleMovieBox(
        alias
      );

    best = Math.max(
      best,
      titleScore(
        candidate,
        alias
      )
    );

    if (
      cleanCandidate &&
      cleanAlias
    ) {
      if (cleanCandidate === cleanAlias) {
        best = Math.max(
          best,
          100
        );
      } else if (
        cleanCandidate.indexOf(cleanAlias) !== -1 ||
        cleanAlias.indexOf(cleanCandidate) !== -1
      ) {
        best = Math.max(
          best,
          92
        );
      } else {
        best = Math.max(
          best,
          titleScore(
            cleanCandidate,
            cleanAlias
          )
        );
      }
    }
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

function itemYear(item) {
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

  return match ? match[0] : "";
}

function typeMatches(item, mediaType) {
  var type =
    Number(
      item &&
      (
        item.subjectType !== undefined
          ? item.subjectType
          : item.subject_type
      )
    );

  if (!type) return true;

  return mediaType === "movie"
    ? type === 1
    : type !== 1;
}

function extractSearchItems(payload) {
  var queue = [payload];
  var seen = [];
  var depth = 0;

  while (queue.length && depth < 24) {
    var value = queue.shift();
    depth += 1;
    if (!value || typeof value !== "object") continue;
    if (seen.indexOf(value) !== -1) continue;
    seen.push(value);

    if (Array.isArray(value)) {
      if (value.length && value.some(function(item) {
        return item && typeof item === "object" &&
          (item.subjectId || item.subject_id || item.title || item.name);
      })) return value;
      value.forEach(function(item) { if (item && typeof item === "object") queue.push(item); });
      continue;
    }

    ["items", "subjectList", "subjects", "list", "results", "records", "content"].forEach(function(key) {
      if (value[key] && typeof value[key] === "object") queue.push(value[key]);
    });
    if (value.data && typeof value.data === "object") queue.push(value.data);
    if (value.result && typeof value.result === "object") queue.push(value.result);
  }

  return [];
}

function scoreCandidate(item, info, mediaType) {
  var score =
    bestAliasTitleScore(
      item && item.title,
      info
    );

  var year =
    itemYear(item);

  if (
    info.year &&
    year
  ) {
    if (String(info.year) === String(year)) {
      score += 24;
    } else {
      /*
       * TV mirrors sometimes expose the latest-season year instead of the
       * original first-air year. Treat year as a preference, not a hard miss.
       */
      score -=
        mediaType === "tv"
          ? 8
          : 24;
    }
  }

  if (typeMatches(item, mediaType)) {
    score += 22;
  } else {
    score -= 80;
  }

  return score;
}

function orderedHosts(seedHost) {
  var output = [];

  function add(host) {
    var value =
      String(host || "")
        .replace(/\/+$/, "");

    if (
      !value ||
      output.indexOf(value) !== -1
    ) {
      return;
    }

    output.push(value);
  }

  add(seedHost);
  add(preferredWebHost);

  WEB_HOSTS.forEach(function(host) {
    var normalized = String(host || "").replace(/\/+$/, "");
    if (!unhealthyWebHosts[normalized]) add(host);
  });

  return output;
}

function searchHost(host, query) {
  var body =
    JSON.stringify({
      keyword:
        String(query || "").trim(),
      page: 1,
      perPage: 24,
      subjectType: 0
    });

  return fetchJson(
    host +
      "/wefeed-h5-bff/web/subject/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Referer": host + "/"
      },
      body: body
    },
    3800,
    "MovieBox search " + host
  ).then(function(payload) {
    var normalizedHost = String(host || "").replace(/\/+$/, "");
    delete unhealthyWebHosts[normalizedHost];
    return {
      host: host,
      items: extractSearchItems(payload)
    };
  }).catch(function(error) {
    var normalizedHost = String(host || "").replace(/\/+$/, "");
    unhealthyWebHosts[normalizedHost] = true;
    vueoCandidateTrace("HOST_DEAD", {
      host: normalizedHost,
      error: error && error.message ? error.message : String(error)
    });
    throw error;
  });
}

function collectAllSearchResults(query) {
  return collectSettled(
    orderedHosts().map(function(host) {
      return searchHost(
        host,
        query
      );
    }),
    SEARCH_COLLECT_MS
  );
}

function chooseAcrossMirrors(
  searchResults,
  info,
  mediaType
) {
  var candidates = [];

  (searchResults || []).forEach(
    function(result) {
      (result.items || []).forEach(
        function(item, index) {
          if (
            !item ||
            !(item.subjectId || item.subject_id || item.id)
          ) {
            return;
          }

          if (!item.subjectId) item.subjectId = item.subject_id || item.id;
          if (!item.title) item.title = item.name || item.subjectName || item.subject_name || "";
          candidates.push({
            host: result.host,
            item: item,
            score:
              scoreCandidate(
                item,
                info,
                mediaType
              ) +
              Math.max(
                0,
                5 - index
              )
          });
        }
      );
    }
  );

  candidates.sort(function(a, b) {
    return b.score - a.score;
  });

  vueoCandidateTrace("CANDIDATE", {
    count: candidates.length,
    title: candidates.length && candidates[0].item ? (candidates[0].item.title || "") : "",
    score: candidates.length ? candidates[0].score : 0
  });

  if (!candidates.length) {
    return null;
  }

  /*
   * Exact or partial title relation is enough. Do not use the old high
   * confidence gate. If MovieBox itself returned the queried title, year and
   * type bonuses make the intended result naturally win.
   */
  if (candidates[0].score < 22) {
    console.log(
      "[MovieBox] H5 weak candidate title=" +
      String(
        candidates[0].item &&
        candidates[0].item.title ||
        ""
      ) +
      " score=" +
      candidates[0].score
    );
    return null;
  }

  return candidates[0];
}

function searchH5(
  info,
  mediaType
) {
  var queries =
    buildAliasQueries(
      info,
      7
    );

  var primary =
    queries[0] ||
    info.title;

  return collectAllSearchResults(
    primary
  ).then(function(results) {
    var best =
      chooseAcrossMirrors(
        results,
        info,
        mediaType
      );

    if (best) return best;

    var fallbackQueries =
      queries
        .slice(1, 4);

    if (!fallbackQueries.length) {
      return null;
    }

    /*
     * Alias fallback uses only the two healthiest ordered mirrors instead of
     * querying every alias on all four hosts. This fixes alternate-title
     * matching without turning a miss into a 20 second provider timeout.
     */
    var hosts =
      orderedHosts()
        .slice(0, 2);

    var tasks = [];

    fallbackQueries.forEach(
      function(query) {
        hosts.forEach(function(host) {
          tasks.push(
            searchHost(
              host,
              query
            ).then(function(result) {
              result.query = query;
              return result;
            })
          );
        });
      }
    );

    return collectSettled(
      tasks,
      5200
    ).then(function(extra) {
      var aliasBest =
        chooseAcrossMirrors(
          extra,
          info,
          mediaType
        );

      if (!aliasBest) {
        console.log(
          "[MovieBox] H5 aliases exhausted count=" +
          fallbackQueries.length
        );
      }

      return aliasBest;
    });
  });
}
function raceDetailHosts(
  subjectId,
  seedHost
) {
  return raceFirstValid(
    orderedHosts(seedHost).map(
      function(host) {
        return fetchJson(
          host +
            "/wefeed-h5-bff/web/subject/detail?subjectId=" +
            encodeURIComponent(subjectId),
          {
            headers: {
              "Referer": host + "/"
            }
          },
          3000,
          "MovieBox detail " + host
        ).then(function(payload) {
          var data =
            payload &&
            payload.data &&
            typeof payload.data === "object"
              ? payload.data
              : null;

          if (
            !data ||
            !data.subject
          ) {
            return null;
          }

          return {
            host: host,
            subject: data.subject
          };
        });
      }
    ),
    DETAIL_RACE_MS
  );
}

function buildPlayReferer(
  host,
  item,
  subjectId
) {
  var detailPath =
    String(
      item &&
      (
        item.detailPath ||
        item.detail_path
      ) ||
      ""
    )
      .trim()
      .replace(/^\/+/, "");

  if (!detailPath) {
    return host + "/";
  }

  return (
    host +
    "/spa/videoPlayPage/movies/" +
    detailPath +
    "?id=" +
    encodeURIComponent(subjectId) +
    "&type=/movie/detail&lang=en"
  );
}

function extractStreams(payload) {
  var data =
    payload &&
    payload.data &&
    typeof payload.data === "object"
      ? payload.data
      : {};

  return Array.isArray(data.streams)
    ? data.streams
    : [];
}

function collectPlayHosts(
  item,
  mediaType,
  season,
  episode,
  seedHost
) {
  var subjectId =
    String(
      item &&
      item.subjectId ||
      ""
    ).trim();

  if (!subjectId) {
    return Promise.resolve([]);
  }

  var se =
    mediaType === "tv"
      ? Number(season || 1)
      : 0;

  var ep =
    mediaType === "tv"
      ? Number(episode || 1)
      : 0;

  var tasks =
    orderedHosts(seedHost).map(
      function(host) {
        var referer =
          buildPlayReferer(
            host,
            item,
            subjectId
          );

        var url =
          host +
          "/wefeed-h5-bff/web/subject/play" +
          "?subjectId=" +
          encodeURIComponent(subjectId) +
          "&se=" +
          encodeURIComponent(se) +
          "&ep=" +
          encodeURIComponent(ep);

        return fetchJson(
          url,
          {
            headers: {
              "Referer": referer
            }
          },
          4400,
          "MovieBox play " + host
        ).then(function(payload) {
          var streams =
            extractStreams(payload)
              .filter(function(source) {
                return (
                  source &&
                  String(
                    source.url || ""
                  ).trim()
                );
              });

          if (!streams.length) {
            return null;
          }

          return {
            host: host,
            referer: referer,
            subjectId: subjectId,
            streams: streams
          };
        });
      }
    );

  return collectSettled(
    tasks,
    PLAY_COLLECT_MS
  ).then(function(results) {
    var seen = {};
    var output = [];

    results.forEach(function(result) {
      if (!result) return;

      result.streams.forEach(function(stream) {
        var url =
          String(
            stream &&
            stream.url ||
            ""
          ).trim();

        if (!url || seen[url]) {
          return;
        }

        seen[url] = true;

        output.push({
          host: result.host,
          referer: result.referer,
          subjectId: result.subjectId,
          stream: stream
        });
      });
    });

    if (output.length) {
      preferredWebHost =
        output[0].host;
    }

    return output;
  });
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
        .replace(/_/g, "-");
    });

  function has(valuesToFind) {
    return values.some(function(value) {
      return valuesToFind.some(
        function(needle) {
          return (
            value === needle ||
            value.indexOf(needle) !== -1
          );
        }
      );
    });
  }

  if (
    has([
      "ms",
      "msa",
      "may",
      "malay",
      "bahasa melayu",
      "bahasa malaysia"
    ])
  ) {
    return {
      code: "ms",
      label: "Malay"
    };
  }

  if (
    has([
      "en",
      "eng",
      "english"
    ])
  ) {
    return {
      code: "en",
      label: "English"
    };
  }

  if (
    has([
      "id",
      "ind",
      "indonesian",
      "bahasa indonesia"
    ])
  ) {
    return {
      code: "id",
      label: "Indonesian"
    };
  }

  return null;
}

function loadCaptions(
  resolvedStreams
) {
  var streams =
    Array.isArray(resolvedStreams)
      ? resolvedStreams
      : [];

  if (!streams.length) {
    return Promise.resolve([]);
  }

  var subjectId =
    String(
      streams[0].subjectId || ""
    ).trim();

  if (!subjectId) {
    return Promise.resolve([]);
  }

  var seedSeen = {};
  var seeds = [];

  streams.forEach(function(resolved) {
    var source =
      resolved &&
      resolved.stream;

    var id =
      String(
        source &&
        source.id ||
        ""
      ).trim();

    var format =
      String(
        source &&
        source.format ||
        ""
      ).trim();

    if (!id || !format) {
      return;
    }

    var key =
      id + "\u0000" + format;

    if (seedSeen[key]) {
      return;
    }

    seedSeen[key] = true;

    seeds.push({
      id: id,
      format: format,
      host: resolved.host
    });
  });

  if (!seeds.length) {
    return Promise.resolve([]);
  }

  var tasks = [];

  seeds.forEach(function(seed) {
    orderedHosts(seed.host).forEach(
      function(host) {
        var url =
          host +
          "/wefeed-h5-bff/web/subject/caption" +
          "?format=" +
          encodeURIComponent(seed.format) +
          "&id=" +
          encodeURIComponent(seed.id) +
          "&subjectId=" +
          encodeURIComponent(subjectId);

        tasks.push(
          fetchJson(
            url,
            {
              headers: {
                "Referer": host + "/"
              }
            },
            2800,
            "MovieBox caption " + host
          ).then(function(payload) {
            var data =
              payload &&
              payload.data &&
              typeof payload.data === "object"
                ? payload.data
                : {};

            return Array.isArray(data.captions)
              ? data.captions
              : [];
          })
        );
      }
    );
  });

  return collectSettled(
    tasks,
    CAPTION_COLLECT_MS
  ).then(function(results) {
    var seen = {};
    var captions = [];

    results.forEach(function(group) {
      (Array.isArray(group) ? group : [])
        .forEach(function(caption) {
          var url =
            String(
              caption &&
              caption.url ||
              ""
            ).trim();

          if (
            !url ||
            seen[url] ||
            !subtitleLanguage(caption)
          ) {
            return;
          }

          seen[url] = true;
          captions.push(caption);
        });
    });

    return captions;
  });
}
function qualityNumber(value) {
  var text =
    String(value || "")
      .toLowerCase();

  if (text.indexOf("4k") !== -1) {
    return 2160;
  }

  var match =
    text.match(/(\d{3,4})/);

  return match
    ? Number(match[1]) || 0
    : 0;
}

function inferQuality(
  url,
  label
) {
  var value =
    (
      String(label || "") +
      " " +
      String(url || "")
    ).toLowerCase();

  var q =
    qualityNumber(value);

  return q
    ? q + "p"
    : "Auto";
}

function sanitiseHeaders(
  input,
  fallbackReferer
) {
  var source =
    input &&
    typeof input === "object"
      ? input
      : {};

  var output = {};

  Object.keys(source).forEach(
    function(key) {
      var lower =
        String(key || "")
          .toLowerCase();

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
    }
  );

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
    fallbackReferer;

  return output;
}

function buildSubtitleFiles(captions) {
  var seen = {};

  return (captions || [])
    .map(function(caption) {
      var url =
        String(
          caption &&
          caption.url ||
          ""
        ).trim();

      var language =
        subtitleLanguage(caption);

      if (
        !url ||
        !language ||
        seen[url]
      ) {
        return null;
      }

      seen[url] = true;

      return {
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
      };
    })
    .filter(Boolean);
}

function buildH5Output(
  resolvedStreams,
  captions,
  info,
  mediaType,
  season,
  episode
) {
  var subtitles =
    buildSubtitleFiles(captions);

  var suffix =
    mediaType === "tv"
      ? " S" +
        String(season || 1).padStart(2, "0") +
        "E" +
        String(episode || 1).padStart(2, "0")
      : "";

  return (resolvedStreams || [])
    .slice()
    .sort(function(a, b) {
      return (
        qualityNumber(
          b &&
          b.stream &&
          b.stream.resolutions
        ) -
        qualityNumber(
          a &&
          a.stream &&
          a.stream.resolutions
        )
      );
    })
    .map(function(resolved) {
      var source =
        resolved &&
        resolved.stream;

      var url =
        String(
          source &&
          source.url ||
          ""
        ).trim();

      if (!url) {
        return null;
      }

      var quality =
        inferQuality(
          url,
          source &&
          (
            source.resolutions ||
            source.resolution ||
            source.quality
          )
        );

      return {
        name:
          PROVIDER_NAME +
          " " +
          quality,
        title:
          (info.title || PROVIDER_NAME) +
          suffix,
        url: url,
        quality: quality,
        type: "direct",
        subtitles: subtitles,
        headers: {
          "User-Agent": USER_AGENT,
          "Referer":
            resolved.referer ||
            resolved.host + "/"
        }
      };
    })
    .filter(Boolean);
}
function resolveH5(
  info,
  mediaType,
  season,
  episode
) {
  var selectedItem;
  var selectedHost;

  return searchH5(
    info,
    mediaType
  )
    .then(function(match) {
      if (!match) {
        throw new Error(
          "MovieBox H5 mirrors returned no matching title"
        );
      }

      selectedItem =
        Object.assign(
          {},
          match.item
        );

      selectedHost =
        match.host;

      preferredWebHost =
        match.host;

      console.log(
        "[MovieBox] H5 selected host=" +
        match.host +
        " title=" +
        selectedItem.title +
        " score=" +
        match.score
      );

      if (
        selectedItem.detailPath ||
        selectedItem.detail_path
      ) {
        return null;
      }

      return raceDetailHosts(
        selectedItem.subjectId,
        selectedHost
      );
    })
    .then(function(detail) {
      if (
        detail &&
        detail.subject
      ) {
        selectedItem =
          Object.assign(
            {},
            selectedItem,
            detail.subject
          );

        selectedHost =
          detail.host;

        preferredWebHost =
          detail.host;
      }

      return collectPlayHosts(
        selectedItem,
        mediaType,
        season,
        episode,
        selectedHost
      );
    })
    .then(function(resolvedStreams) {
      if (!resolvedStreams.length) {
        throw new Error(
          "MovieBox H5 returned no playable streams"
        );
      }

      return loadCaptions(
        resolvedStreams
      )
        .catch(function() {
          return [];
        })
        .then(function(captions) {
          return buildH5Output(
            resolvedStreams,
            captions,
            info,
            mediaType,
            season,
            episode
          );
        });
    })
    .catch(function(error) {
      console.log(
        "[MovieBox] H5 path failed: " +
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
function nativeWebViewAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function buildMovieBoxWatchUrl(
  tmdbId,
  mediaType,
  season,
  episode
) {
  if (mediaType === "tv") {
    return (
      MOVIEBOX_WEB +
      "/watch/tv/" +
      encodeURIComponent(tmdbId) +
      "/"
    );
  }

  return (
    MOVIEBOX_WEB +
    "/watch/movie/" +
    encodeURIComponent(tmdbId) +
    "/"
  );
}

function resolveMovieBoxWebsite(
  tmdbId,
  info,
  mediaType,
  season,
  episode
) {
  if (!nativeWebViewAvailable()) {
    return Promise.resolve([]);
  }

  var watchUrl =
    buildMovieBoxWatchUrl(
      tmdbId,
      mediaType,
      season,
      episode
    );

  /*
   * On the real MovieBox watch page the first server is "Zen" and MovieBox
   * exposes a Change Server control for additional mirrors. Repeated
   * interaction ticks therefore do useful work instead of repeatedly trying
   * the same homepage search control.
   */
  var interactions = [
    "play",
    "continue",
    "watch",
    "change server",
    "skip ad",
    "skip",
    "close ad",
    "close"
  ];

  if (mediaType === "tv") {
    interactions.unshift(
      "episode " + Number(episode || 1),
      "season " + Number(season || 1)
    );
  }

  console.log(
    "[MovieBox] Native watch page=" +
    watchUrl
  );

  return globalThis.webviewResolve(
    watchUrl,
    {
      referer:
        MOVIEBOX_WEB + "/",
      directLoad: true,
      timeoutMs:
        WEBVIEW_BUDGET_MS,
      finishAfterFirstMs: 500,
      suppressPopups: true,
      lockMainFrameHost: true,
      interactionTexts:
        interactions,
      clickDelaysMs: [
        700,
        1500,
        2600,
        3900,
        4900
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
    }
  ).then(function(result) {
    var captured =
      result &&
      Array.isArray(result.streams)
        ? result.streams
        : [];

    var seen = {};

    var output =
      captured
        .filter(function(item) {
          var url =
            String(
              item &&
              item.url ||
              ""
            ).toLowerCase();

          return (
            url.indexOf(".m3u8") !== -1 ||
            url.indexOf(".mp4") !== -1 ||
            url.indexOf(".m4v") !== -1 ||
            url.indexOf("/sora/") !== -1
          );
        })
        .filter(function(item) {
          var url =
            String(item.url);

          if (seen[url]) {
            return false;
          }

          seen[url] = true;
          return true;
        })
        .map(function(item, index) {
          var url =
            String(item.url);

          var suffix =
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

          var capturedReferer =
            item.headers &&
            (
              item.headers.Referer ||
              item.headers.referer
            );

          return {
            name:
              PROVIDER_NAME +
              " Web" +
              (
                index
                  ? " " + (index + 1)
                  : ""
              ),
            title:
              (info.title || PROVIDER_NAME) +
              suffix,
            url: url,
            quality:
              inferQuality(
                url,
                item.label
              ),
            type: "direct",
            subtitles: [],
            headers:
              sanitiseHeaders(
                item.headers,
                capturedReferer ||
                  watchUrl
              )
          };
        });

    output.sort(function(a, b) {
      var ai =
        String(a.url).indexOf("/sora/") !== -1
          ? 1
          : 0;

      var bi =
        String(b.url).indexOf("/sora/") !== -1
          ? 1
          : 0;

      if (ai !== bi) {
        return ai - bi;
      }

      return (
        qualityNumber(b.quality) -
        qualityNumber(a.quality)
      );
    });

    console.log(
      "[MovieBox] Native watch streams=" +
      output.length
    );

    return output;
  }).catch(function(error) {
    console.log(
      "[MovieBox] Native watch failed: " +
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
    String(tmdbId || "").trim();

  if (!id) {
    console.error(
      "[MovieBox] TMDB ID is missing"
    );
    return Promise.resolve([]);
  }

  console.log(
    "[MovieBox] Direct request tmdbId=" +
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

  var work =
    getTmdbInfo(
      id,
      type
    )
      .catch(function(error) {
        console.log(
          "[MovieBox] TMDB metadata failed: " +
          (
            error &&
            error.message
              ? error.message
              : String(error)
          )
        );

        return {
          title: "",
          originalTitle: "",
          year: "",
          aliases: []
        };
      })
      .then(function(info) {
        if (!info.title) {
          return resolveMovieBoxWebsite(
            id,
            {
              title: PROVIDER_NAME
            },
            type,
            requestedSeason,
            requestedEpisode
          );
        }

        return resolveH5(
          info,
          type,
          requestedSeason,
          requestedEpisode
        ).then(function(h5Streams) {
          if (
            Array.isArray(h5Streams) &&
            h5Streams.length
          ) {
            return h5Streams;
          }

          return resolveMovieBoxWebsite(
            id,
            info,
            type,
            requestedSeason,
            requestedEpisode
          );
        });
      });

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    "MovieBox provider"
  ).catch(function(error) {
    console.error(
      "[MovieBox] " +
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
