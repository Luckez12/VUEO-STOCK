"use strict";

var PROVIDER_NAME = "MovieBox";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

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

var SEARCH_RACE_MS = 4500;
var DETAIL_RACE_MS = 3500;
var PLAY_RACE_MS = 5500;
var CAPTION_RACE_MS = 2500;
var PROVIDER_BUDGET_MS = 18500;

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
  if (!Array.isArray(tasks) || tasks.length === 0) {
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
        console.log(
          "[MovieBox] " +
          (label || "race") +
          " reached " +
          timeoutMs +
          "ms"
        );
        finish(null);
      }
    }, timeoutMs);
  });
}

function orderedHosts(seedHost) {
  var output = [];

  function add(host) {
    var value = String(host || "").replace(/\/+$/, "");
    if (!value || output.indexOf(value) !== -1) return;
    output.push(value);
  }

  add(seedHost);
  add(preferredWebHost);
  WEB_HOSTS.forEach(add);

  return output;
}

function fetchJson(url, options, timeoutMs, label) {
  var requestOptions = options || {};
  var headers = Object.assign(
    {},
    COMMON_HEADERS,
    requestOptions.headers || {}
  );

  var fetchOptions = {
    method: requestOptions.method || "GET",
    headers: headers,
    redirect: "follow"
  };

  if (requestOptions.body !== undefined) {
    fetchOptions.body = requestOptions.body;
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
    timeoutMs || 3500,
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
    1400,
    "TMDB"
  ).then(function(data) {
    return {
      tmdbId: String(tmdbId),
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
    .trim()
    .replace(/^(the|a|an)\s+/, "");
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

  if (!leftWords.length || !rightWords.length) return 0;

  var set = {};
  leftWords.forEach(function(word) {
    set[word] = true;
  });

  var matched =
    rightWords.filter(function(word) {
      return set[word];
    }).length;

  if (!matched) return 0;

  var recall =
    matched /
    Math.max(rightWords.length, 1);

  var precision =
    matched /
    Math.max(leftWords.length, 1);

  return Math.round(
    (recall * 0.72 + precision * 0.28) * 72
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

function itemTypeMatches(item, mediaType) {
  var subjectType =
    Number(
      item &&
      (
        item.subjectType !== undefined
          ? item.subjectType
          : item.subject_type
      )
    );

  if (!subjectType) return true;

  if (mediaType === "movie") {
    return subjectType === 1;
  }

  return subjectType !== 1;
}

function scoreCandidate(item, info, mediaType, rank) {
  var score =
    Math.max(
      titleScore(item && item.title, info.title),
      titleScore(item && item.title, info.originalTitle)
    );

  var candidateYear = itemYear(item);

  if (
    info.year &&
    candidateYear
  ) {
    if (info.year === candidateYear) {
      score += 32;
    } else {
      score -= 45;
    }
  }

  if (itemTypeMatches(item, mediaType)) {
    score += 20;
  } else {
    score -= 90;
  }

  score +=
    Math.max(
      0,
      10 - Number(rank || 0)
    );

  return score;
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

  if (Array.isArray(data.results)) {
    var flattened = [];

    data.results.forEach(function(result) {
      if (
        result &&
        Array.isArray(result.subjects)
      ) {
        result.subjects.forEach(function(subject) {
          flattened.push(subject);
        });
      }
    });

    return flattened;
  }

  return [];
}

function pickBestCandidate(items, info, mediaType) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }

  var scored =
    items.map(function(item, index) {
      return {
        item: item,
        score:
          scoreCandidate(
            item,
            info,
            mediaType,
            index
          )
      };
    })
    .filter(function(entry) {
      return (
        entry.item &&
        entry.item.subjectId &&
        entry.score >= 58
      );
    })
    .sort(function(a, b) {
      return b.score - a.score;
    });

  return scored.length
    ? scored[0]
    : null;
}

function searchOneHost(host, query, info, mediaType) {
  var body =
    JSON.stringify({
      keyword: String(query || "").trim(),
      page: 1,
      perPage: 24,
      subjectType: 0
    });

  var url =
    host +
    "/wefeed-h5-bff/web/subject/search";

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
    3600,
    "MovieBox search " + host
  ).then(function(payload) {
    var best =
      pickBestCandidate(
        extractSearchItems(payload),
        info,
        mediaType
      );

    if (!best) return null;

    return {
      host: host,
      item: best.item,
      score: best.score
    };
  });
}

function searchHostWithFallback(host, info, mediaType) {
  return searchOneHost(
    host,
    info.title,
    info,
    mediaType
  ).then(function(primary) {
    if (primary) return primary;

    if (
      !info.originalTitle ||
      normalizeTitle(info.originalTitle) ===
        normalizeTitle(info.title)
    ) {
      return null;
    }

    return searchOneHost(
      host,
      info.originalTitle,
      info,
      mediaType
    );
  });
}

function raceSearchHosts(info, mediaType) {
  var hosts = orderedHosts();

  console.log(
    "[MovieBox] Racing search mirrors: " +
    hosts.join(", ")
  );

  return raceFirstValid(
    hosts.map(function(host) {
      return searchHostWithFallback(
        host,
        info,
        mediaType
      );
    }),
    SEARCH_RACE_MS,
    "search"
  ).then(function(result) {
    if (result) {
      preferredWebHost = result.host;

      console.log(
        "[MovieBox] Search winner=" +
        result.host +
        " title=" +
        result.item.title +
        " score=" +
        result.score
      );
    }

    return result;
  });
}

function extractDetailSubject(payload) {
  return (
    payload &&
    payload.data &&
    payload.data.subject
      ? payload.data.subject
      : null
  );
}

function raceDetailHosts(subjectId, seedHost) {
  var hosts = orderedHosts(seedHost);

  return raceFirstValid(
    hosts.map(function(host) {
      var url =
        host +
        "/wefeed-h5-bff/web/subject/detail?subjectId=" +
        encodeURIComponent(subjectId);

      return fetchJson(
        url,
        {
          headers: {
            "Referer": host + "/"
          }
        },
        3000,
        "MovieBox detail " + host
      ).then(function(payload) {
        var subject =
          extractDetailSubject(payload);

        if (!subject) return null;

        return {
          host: host,
          subject: subject
        };
      });
    }),
    DETAIL_RACE_MS,
    "detail"
  );
}

function buildPlayReferer(host, item, subjectId) {
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

  var streams = [];

  if (Array.isArray(data.streams)) {
    streams = data.streams;
  } else if (
    data.playInfo &&
    Array.isArray(data.playInfo.streams)
  ) {
    streams = data.playInfo.streams;
  }

  return streams.filter(function(stream) {
    return (
      stream &&
      String(stream.url || "").trim()
    );
  });
}

function racePlayHosts(
  item,
  subjectId,
  mediaType,
  season,
  episode,
  seedHost
) {
  var hosts = orderedHosts(seedHost);

  var requestedSeason =
    mediaType === "tv"
      ? Number(season || 1)
      : 0;

  var requestedEpisode =
    mediaType === "tv"
      ? Number(episode || 1)
      : 0;

  console.log(
    "[MovieBox] Racing play mirrors for subject=" +
    subjectId +
    (
      mediaType === "tv"
        ? " S" +
          requestedSeason +
          "E" +
          requestedEpisode
        : ""
    )
  );

  return raceFirstValid(
    hosts.map(function(host) {
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
        encodeURIComponent(requestedSeason) +
        "&ep=" +
        encodeURIComponent(requestedEpisode);

      return fetchJson(
        url,
        {
          headers: {
            "Referer": referer
          }
        },
        4600,
        "MovieBox play " + host
      ).then(function(payload) {
        var streams =
          extractStreams(payload);

        if (!streams.length) {
          return null;
        }

        return {
          host: host,
          referer: referer,
          streams: streams
        };
      });
    }),
    PLAY_RACE_MS,
    "play"
  ).then(function(result) {
    if (result) {
      preferredWebHost = result.host;

      console.log(
        "[MovieBox] Play winner=" +
        result.host +
        " streams=" +
        result.streams.length
      );
    }

    return result;
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
        .replace(/_/g, "-")
        .replace(/\s+/g, " ");
    });

  function hasCode(codes) {
    return values.some(function(value) {
      return codes.some(function(code) {
        return (
          value === code ||
          value.indexOf(code + "-") === 0 ||
          value.indexOf(code + " ") === 0 ||
          value.indexOf(code + "(") === 0 ||
          value.indexOf(code + "[") === 0
        );
      });
    });
  }

  function hasName(names) {
    return values.some(function(value) {
      return names.some(function(name) {
        return (
          value === name ||
          value.indexOf(name) !== -1
        );
      });
    });
  }

  if (
    hasCode(["ms", "msa", "may"]) ||
    hasName([
      "bahasa melayu",
      "bahasa malaysia",
      "malay",
      "melayu",
      "malaysian"
    ])
  ) {
    return {
      code: "ms",
      label: "Malay"
    };
  }

  if (
    hasCode(["en", "eng"]) ||
    hasName(["english"])
  ) {
    return {
      code: "en",
      label: "English"
    };
  }

  if (
    hasCode(["id", "ind", "in"]) ||
    hasName([
      "bahasa indonesia",
      "indonesian"
    ])
  ) {
    return {
      code: "id",
      label: "Indonesian"
    };
  }

  return null;
}

function extractCaptions(payload) {
  var data =
    payload &&
    payload.data &&
    typeof payload.data === "object"
      ? payload.data
      : {};

  return Array.isArray(data.captions)
    ? data.captions
    : [];
}

function raceCaptionHosts(
  subjectId,
  streamId,
  format,
  winningHost
) {
  if (!streamId || !format) {
    return Promise.resolve([]);
  }

  var hosts = orderedHosts(winningHost);

  return raceFirstValid(
    hosts.map(function(host) {
      var url =
        host +
        "/wefeed-h5-bff/web/subject/caption" +
        "?format=" +
        encodeURIComponent(format) +
        "&id=" +
        encodeURIComponent(streamId) +
        "&subjectId=" +
        encodeURIComponent(subjectId);

      return fetchJson(
        url,
        {
          headers: {
            "Referer": host + "/"
          }
        },
        2200,
        "MovieBox captions " + host
      ).then(function(payload) {
        var captions =
          extractCaptions(payload)
            .filter(function(caption) {
              return (
                caption &&
                caption.url &&
                subtitleLanguage(caption)
              );
            });

        return captions.length
          ? captions
          : null;
      });
    }),
    CAPTION_RACE_MS,
    "captions"
  ).then(function(captions) {
    return captions || [];
  });
}

function buildSubtitles(captions) {
  var seen = {};

  return (captions || [])
    .map(function(caption) {
      var url =
        String(caption && caption.url || "").trim();

      if (!url || seen[url]) return null;

      var language =
        subtitleLanguage(caption);

      if (!language) return null;

      seen[url] = true;

      var lowerUrl =
        url.toLowerCase();

      var format =
        lowerUrl.indexOf(".srt") !== -1
          ? "srt"
          : lowerUrl.indexOf(".vtt") !== -1
            ? "vtt"
            : "";

      return {
        label: language.label,
        language: language.label,
        lang: language.code,
        url: url,
        default: false,
        format: format
      };
    })
    .filter(Boolean);
}

function qualityNumber(value) {
  var text =
    String(value || "").toLowerCase();

  var match =
    text.match(/(\d{3,4})\s*p?/);

  if (match) {
    return Number(match[1]) || 0;
  }

  if (text.indexOf("4k") !== -1) {
    return 2160;
  }

  return 0;
}

function formatQuality(value) {
  var number =
    qualityNumber(value);

  return number
    ? number + "p"
    : "Auto";
}

function buildStreams(
  playResult,
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
        String(season || 1).padStart(2, "0") +
        "E" +
        String(episode || 1).padStart(2, "0")
      : "";

  return playResult.streams
    .slice()
    .sort(function(a, b) {
      return (
        qualityNumber(b && b.resolutions) -
        qualityNumber(a && a.resolutions)
      );
    })
    .map(function(source, index) {
      var url =
        String(
          source &&
          source.url ||
          ""
        ).trim();

      if (!url || seen[url]) return null;
      seen[url] = true;

      var quality =
        formatQuality(
          source &&
          (
            source.resolutions ||
            source.resolution ||
            source.quality
          )
        );

      var format =
        String(
          source &&
          source.format ||
          ""
        ).trim();

      return {
        name:
          PROVIDER_NAME +
          (
            quality !== "Auto"
              ? " " + quality
              : ""
          ),
        title:
          (info.title || PROVIDER_NAME) +
          episodeLabel +
          (
            format
              ? " • " + format.toUpperCase()
              : ""
          ),
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

  var info;
  var searchResult;
  var selectedItem;

  var work =
    getTmdbInfo(
      tmdbId,
      type
    )
    .then(function(value) {
      info = value;

      if (!info.title) {
        throw new Error(
          "TMDB title is empty"
        );
      }

      return raceSearchHosts(
        info,
        type
      );
    })
    .then(function(result) {
      if (!result) {
        throw new Error(
          "MovieBox search returned no confident match"
        );
      }

      searchResult = result;
      selectedItem =
        Object.assign(
          {},
          result.item
        );

      /*
       * Search results normally include detailPath. Only spend time on a
       * detail race when it is absent, because VUEO only needs playback data.
       */
      if (
        selectedItem.detailPath ||
        selectedItem.detail_path
      ) {
        return null;
      }

      return raceDetailHosts(
        selectedItem.subjectId,
        result.host
      );
    })
    .then(function(detailResult) {
      if (
        detailResult &&
        detailResult.subject
      ) {
        selectedItem =
          Object.assign(
            {},
            selectedItem,
            detailResult.subject
          );

        if (detailResult.host) {
          preferredWebHost =
            detailResult.host;
        }
      }

      var subjectId =
        String(
          selectedItem &&
          selectedItem.subjectId ||
          ""
        ).trim();

      if (!subjectId) {
        throw new Error(
          "MovieBox subjectId is missing"
        );
      }

      return racePlayHosts(
        selectedItem,
        subjectId,
        type,
        requestedSeason,
        requestedEpisode,
        searchResult.host
      ).then(function(playResult) {
        return {
          subjectId: subjectId,
          playResult: playResult
        };
      });
    })
    .then(function(state) {
      if (
        !state.playResult ||
        !state.playResult.streams ||
        !state.playResult.streams.length
      ) {
        throw new Error(
          "MovieBox returned no playable streams"
        );
      }

      var captionSeed =
        state.playResult.streams.find(
          function(source) {
            return (
              source &&
              source.id &&
              source.format
            );
          }
        );

      if (!captionSeed) {
        return {
          playResult: state.playResult,
          subtitles: []
        };
      }

      return raceCaptionHosts(
        state.subjectId,
        captionSeed.id,
        captionSeed.format,
        state.playResult.host
      )
      .catch(function() {
        return [];
      })
      .then(function(captions) {
        return {
          playResult: state.playResult,
          subtitles:
            buildSubtitles(captions)
        };
      });
    })
    .then(function(state) {
      var streams =
        buildStreams(
          state.playResult,
          state.subtitles,
          info,
          type,
          requestedSeason,
          requestedEpisode
        );

      console.log(
        "[MovieBox] Direct streams found=" +
        streams.length +
        " subtitles=" +
        state.subtitles.length
      );

      return streams;
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
