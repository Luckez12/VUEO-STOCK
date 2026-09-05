"use strict";

var PROVIDER_NAME = "MovieBox";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var MOVIEBOX_WEB = "https://moviebox.pk";

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
var WEBVIEW_BUDGET_MS = 14500;
var SEARCH_COLLECT_MS = 4700;
var DETAIL_RACE_MS = 3400;
var PLAY_RACE_MS = 5200;
var CAPTION_RACE_MS = 900;

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
    TMDB_API_KEY;

  return fetchJson(
    url,
    {
      headers: {
        "Accept": "application/json"
      }
    },
    1300,
    "TMDB"
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
        ).split("-")[0]
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
  var data =
    payload &&
    payload.data &&
    typeof payload.data === "object"
      ? payload.data
      : {};

  if (Array.isArray(data.items)) {
    return data.items;
  }

  if (Array.isArray(data.subjectList)) {
    return data.subjectList;
  }

  return [];
}

function scoreCandidate(item, info, mediaType) {
  var score =
    Math.max(
      titleScore(
        item && item.title,
        info.title
      ),
      titleScore(
        item && item.title,
        info.originalTitle
      )
    );

  var year =
    itemYear(item);

  if (
    info.year &&
    year
  ) {
    if (String(info.year) === String(year)) {
      score += 30;
    } else {
      score -= 30;
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

  WEB_HOSTS.forEach(add);

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
    return {
      host: host,
      items: extractSearchItems(payload)
    };
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
            !item.subjectId
          ) {
            return;
          }

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

  if (!candidates.length) {
    return null;
  }

  /*
   * Exact or partial title relation is enough. Do not use the old high
   * confidence gate. If MovieBox itself returned the queried title, year and
   * type bonuses make the intended result naturally win.
   */
  if (candidates[0].score < 22) {
    return null;
  }

  return candidates[0];
}

function searchH5(
  info,
  mediaType
) {
  return collectAllSearchResults(
    info.title
  ).then(function(results) {
    var best =
      chooseAcrossMirrors(
        results,
        info,
        mediaType
      );

    if (best) return best;

    if (
      info.originalTitle &&
      normalizeTitle(info.originalTitle) !==
        normalizeTitle(info.title)
    ) {
      return collectAllSearchResults(
        info.originalTitle
      ).then(function(extra) {
        return chooseAcrossMirrors(
          extra,
          info,
          mediaType
        );
      });
    }

    return null;
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

function racePlayHosts(
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
    return Promise.resolve(null);
  }

  var se =
    mediaType === "tv"
      ? Number(season || 1)
      : 0;

  var ep =
    mediaType === "tv"
      ? Number(episode || 1)
      : 0;

  return raceFirstValid(
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
    ),
    PLAY_RACE_MS
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
  playResult
) {
  var seed =
    playResult.streams.find(
      function(source) {
        return (
          source &&
          source.id &&
          source.format
        );
      }
    );

  if (!seed) {
    return Promise.resolve([]);
  }

  return raceFirstValid(
    orderedHosts(playResult.host).map(
      function(host) {
        var url =
          host +
          "/wefeed-h5-bff/web/subject/caption" +
          "?format=" +
          encodeURIComponent(seed.format) +
          "&id=" +
          encodeURIComponent(seed.id) +
          "&subjectId=" +
          encodeURIComponent(
            playResult.subjectId
          );

        return fetchJson(
          url,
          {
            headers: {
              "Referer": host + "/"
            }
          },
          800,
          "MovieBox caption " + host
        ).then(function(payload) {
          var data =
            payload &&
            payload.data &&
            typeof payload.data === "object"
              ? payload.data
              : {};

          var captions =
            Array.isArray(data.captions)
              ? data.captions
              : [];

          var usable =
            captions.filter(
              function(caption) {
                return (
                  caption &&
                  caption.url &&
                  subtitleLanguage(caption)
                );
              }
            );

          return usable.length
            ? usable
            : null;
        });
      }
    ),
    CAPTION_RACE_MS
  ).then(function(result) {
    return result || [];
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
  playResult,
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

  var seen = {};

  return playResult.streams
    .slice()
    .sort(function(a, b) {
      return (
        qualityNumber(
          b && b.resolutions
        ) -
        qualityNumber(
          a && a.resolutions
        )
      );
    })
    .map(function(source) {
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
            playResult.host + "/"
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

      return racePlayHosts(
        selectedItem,
        mediaType,
        season,
        episode,
        selectedHost
      );
    })
    .then(function(playResult) {
      if (!playResult) {
        throw new Error(
          "MovieBox H5 returned no playable streams"
        );
      }

      /*
       * Streams are the critical path. Caption lookup is intentionally capped
       * below one second so it cannot turn a valid MovieBox source into a
       * health-check timeout.
       */
      return loadCaptions(
        playResult
      )
        .catch(function() {
          return [];
        })
        .then(function(captions) {
          return buildH5Output(
            playResult,
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

function resolveMovieBoxWebsite(
  info,
  mediaType,
  season,
  episode
) {
  if (!nativeWebViewAvailable()) {
    return Promise.resolve([]);
  }

  var interactions = [];

  if (mediaType === "tv") {
    interactions.push(
      "season " + Number(season || 1),
      "episode " + Number(episode || 1),
      "ep " + Number(episode || 1)
    );
  }

  interactions = interactions.concat([
    "watch online",
    "watch",
    "play",
    "continue",
    "skip ad",
    "skip",
    "close ad",
    "close"
  ]);

  console.log(
    "[MovieBox] Native website search=" +
    info.title
  );

  return globalThis.webviewResolve(
    MOVIEBOX_WEB + "/",
    {
      referer:
        MOVIEBOX_WEB + "/",
      directLoad: true,
      searchText:
        info.title,
      timeoutMs:
        WEBVIEW_BUDGET_MS,
      finishAfterFirstMs: 550,
      suppressPopups: true,
      lockMainFrameHost: true,
      interactionTexts:
        interactions,
      clickDelaysMs: [
        550,
        1100,
        1800,
        2700,
        3900,
        5300,
        7000,
        9000,
        11200,
        13400
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
                  MOVIEBOX_WEB + "/"
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
      "[MovieBox] Native website streams=" +
      output.length
    );

    return output;
  }).catch(function(error) {
    console.log(
      "[MovieBox] Native website failed: " +
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

  console.log(
    "[MovieBox] Request tmdbId=" +
    tmdbId +
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
      tmdbId,
      type
    )
      .then(function(info) {
        if (!info.title) {
          throw new Error(
            "TMDB title is empty"
          );
        }

        /*
         * Both are real MovieBox paths:
         *
         * 1. The current public MovieBox website itself.
         * 2. The H5 API path used by the supplied Cloudstream provider.
         *
         * Run them concurrently. A blocked H5 API can no longer consume the
         * entire provider timeout before the website is attempted, and a slow
         * website cannot prevent the structured API from winning.
         */
        return firstNonEmptyStreams(
          [
            resolveMovieBoxWebsite(
              info,
              type,
              requestedSeason,
              requestedEpisode
            ),
            resolveH5(
              info,
              type,
              requestedSeason,
              requestedEpisode
            )
          ],
          18000
        );
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
