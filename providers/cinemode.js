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
  "doubleclick",
  "googlesyndication",
  "/ads/",
  "/vast"
];

var PROVIDER_BUDGET_MS = 18800;
var PRIMARY_WEBVIEW_MS = 11800;
var ALIAS_WEBVIEW_MS = 6200;

function withSoftTimeout(
  promise,
  timeoutMs,
  label
) {
  return new Promise(function(resolve, reject) {
    var settled = false;

    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;

      reject(
        new Error(
          (label || "Operation") +
          " timed out"
        )
      );
    }, Math.max(1, Number(timeoutMs || 1)));

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

function fetchJson(
  url,
  timeoutMs
) {
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
    timeoutMs || 1600,
    "CineMode metadata"
  );
}

function getTmdbInfo(
  tmdbId,
  mediaType
) {
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

  return fetchJson(
    url,
    1600
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
        )
          .split("-")[0],
      aliases:
        collectTmdbAliasesCine(data)
    };
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/* VUEO_TITLE_PROFILE_V1 */
function collectTmdbAliasesCine(data) {
  var output = [];
  var seen = {};

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);

    if (!text || !key || seen[key]) {
      return;
    }

    seen[key] = true;
    output.push({
      title: text,
      priority: Number(priority || 0)
    });
  }

  add(data && (data.title || data.name), 100);
  add(data && (data.original_title || data.original_name), 95);

  var alt = data && data.alternative_titles;
  var altItems =
    alt && Array.isArray(alt.titles)
      ? alt.titles
      : alt && Array.isArray(alt.results)
        ? alt.results
        : [];

  altItems.forEach(function(item) {
    add(
      item && (item.title || item.name),
      82
    );
  });

  var translations =
    data &&
    data.translations &&
    Array.isArray(data.translations.translations)
      ? data.translations.translations
      : [];

  translations.forEach(function(item) {
    add(
      item &&
      item.data &&
      (
        item.data.title ||
        item.data.name
      ),
      item && item.iso_639_1 === "en" ? 88 : 68
    );
  });

  output.sort(function(a, b) {
    return b.priority - a.priority;
  });

  return output
    .map(function(item) {
      return item.title;
    })
    .slice(0, 10);
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

function isDirectPlayable(url) {
  var value =
    String(url || "")
      .toLowerCase();

  return (
    value.indexOf(".m3u8") !== -1 ||
    value.indexOf(".mp4") !== -1 ||
    value.indexOf(".m4v") !== -1
  );
}

function isIntermediate(url) {
  return (
    String(url || "")
      .toLowerCase()
      .indexOf("/sora/") !== -1
  );
}

function sanitiseHeaders(
  input,
  fallbackReferer
) {
  var output = {};

  var source =
    input &&
    typeof input === "object"
      ? input
      : {};

  Object.keys(source)
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
        String(source[key]);
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

  /*
   * Do not overwrite a player/CDN Referer captured by the native bridge.
   * Some CineMode servers reject BASE_URL as Referer.
   */
  output["Referer"] =
    capturedReferer ||
    fallbackReferer ||
    BASE_URL + "/";

  return output;
}

function nativeAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function episodeInteractions(
  mediaType,
  season,
  episode
) {
  if (mediaType !== "tv") {
    return [];
  }

  var s =
    Math.max(
      1,
      Number(season || 1)
    );

  var e =
    Math.max(
      1,
      Number(episode || 1)
    );

  var s2 =
    String(s).padStart(2, "0");

  var e2 =
    String(e).padStart(2, "0");

  return [
    "season " + s,
    "season " + s2,
    "s" + s,
    "s" + s2,
    "episode " + e,
    "episode " + e2,
    "ep " + e,
    "ep" + e,
    "e" + e,
    "e" + e2
  ];
}

function buildInteractionTexts(
  searchTitle,
  info,
  mediaType,
  season,
  episode
) {
  var output = [];
  var seen = {};

  function add(value) {
    var text =
      String(value || "")
        .trim();

    var key =
      text.toLowerCase();

    if (
      !text ||
      seen[key]
    ) {
      return;
    }

    seen[key] = true;
    output.push(text);
  }

  /*
   * Search result selection first.
   */
  add(searchTitle);
  add(info.title);
  add(info.originalTitle);

  /*
   * Then TV season/episode controls, before generic Watch/Play buttons.
   * This prevents opening episode 1 when Nuvio requested another episode.
   */
  episodeInteractions(
    mediaType,
    season,
    episode
  ).forEach(add);

  [
    "watch now",
    "start watching",
    "watch",
    "play now",
    "play",
    "continue",
    "server",
    "change server",
    "skip ad",
    "skip",
    "close ad",
    "close"
  ].forEach(add);

  return output;
}

function runUiSearch(
  searchTitle,
  info,
  mediaType,
  season,
  episode,
  timeoutMs
) {
  var interactions =
    buildInteractionTexts(
      searchTitle,
      info,
      mediaType,
      season,
      episode
    );

  console.log(
    "[CineMode] UI search title=" +
    searchTitle +
    (
      mediaType === "tv"
        ? " S" +
          season +
          "E" +
          episode
        : ""
    )
  );

  return globalThis.webviewResolve(
    BASE_URL + "/",
    {
      referer:
        BASE_URL + "/",

      directLoad: true,

      searchText:
        searchTitle,

      timeoutMs:
        timeoutMs,

      finishAfterFirstMs: 850,

      suppressPopups: true,

      /*
       * Keep ads/popups from hijacking the main PWA. External player/CDN
       * requests are still visible to the native capture hook.
       */
      lockMainFrameHost: true,

      interactionTexts:
        interactions,

      viewportWidth: 1080,
      viewportHeight: 1080,

      /*
       * Centre clicks are only a secondary assist for players whose controls
       * have no useful text. Text interactions remain the primary path.
       */
      clickX: 540,
      clickY: 540,

      clickDelaysMs: [
        650,
        1300,
        2200,
        3300,
        4700,
        6300,
        8200,
        10400
      ].filter(function(delay) {
        return delay < timeoutMs;
      }),

      match:
        MATCH_PARTS,

      blocked:
        BLOCKED_PARTS,

      injectAbyssHook: true
    }
  )
    .then(function(result) {
      return (
        result &&
        Array.isArray(result.streams)
          ? result.streams
          : []
      );
    })
    .catch(function(error) {
      console.log(
        "[CineMode] UI attempt failed title=" +
        searchTitle +
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

function buildStreams(
  captured,
  info,
  mediaType,
  season,
  episode
) {
  var direct = [];
  var intermediate = [];
  var seen = {};

  (captured || [])
    .forEach(function(item) {
      if (
        !item ||
        !item.url
      ) {
        return;
      }

      var url =
        String(item.url)
          .trim();

      if (
        !url ||
        seen[url]
      ) {
        return;
      }

      if (
        !isDirectPlayable(url) &&
        !isIntermediate(url)
      ) {
        return;
      }

      seen[url] = true;

      var entry = {
        item: item,
        url: url
      };

      if (isDirectPlayable(url)) {
        direct.push(entry);
      } else {
        intermediate.push(entry);
      }
    });

  /*
   * /sora/ is an intermediate capture on some servers. Only expose it when
   * no direct HLS/MP4/M4V request was captured.
   */
  var selected =
    direct.length
      ? direct
      : intermediate;

  var suffix =
    mediaType === "tv"
      ? " S" +
        String(season).padStart(2, "0") +
        "E" +
        String(episode).padStart(2, "0")
      : "";

  return selected
    .map(function(entry, index) {
      var item =
        entry.item;

      var fallbackReferer =
        String(
          item &&
          (
            item.referer ||
            item.referrer
          ) ||
          ""
        ).trim() ||
        BASE_URL + "/";

      return {
        name:
          PROVIDER_NAME +
          (
            selected.length > 1
              ? " " + (index + 1)
              : ""
          ),

        title:
          (info.title || PROVIDER_NAME) +
          suffix,

        url:
          entry.url,

        quality:
          inferQuality(
            entry.url,
            item && item.label
          ),

        type: "direct",

        headers:
          sanitiseHeaders(
            item && item.headers,
            fallbackReferer
          )
      };
    })
    .sort(function(a, b) {
      function score(stream) {
        var value =
          String(stream.quality || "");

        if (value === "2160p") return 2160;
        if (value === "1440p") return 1440;
        if (value === "1080p") return 1080;
        if (value === "720p") return 720;
        if (value === "480p") return 480;
        if (value === "360p") return 360;
        return 0;
      }

      return score(b) - score(a);
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
    String(tmdbId || "")
      .trim();

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

  var work =
    getTmdbInfo(
      id,
      type
    )
      .then(function(info) {
        if (!info.title) {
          throw new Error(
            "TMDB title is empty"
          );
        }

        return runUiSearch(
          info.title,
          info,
          type,
          requestedSeason,
          requestedEpisode,
          PRIMARY_WEBVIEW_MS
        )
          .then(function(primaryCaptured) {
            var primaryStreams =
              buildStreams(
                primaryCaptured,
                info,
                type,
                requestedSeason,
                requestedEpisode
              );

            if (primaryStreams.length) {
              return primaryStreams;
            }

            var fallbackTitle = "";

            (info.aliases || [])
              .some(function(alias) {
                var value =
                  String(alias || "")
                    .trim();

                if (
                  !value ||
                  normalizeTitle(value) ===
                    normalizeTitle(info.title)
                ) {
                  return false;
                }

                fallbackTitle = value;
                return true;
              });

            if (!fallbackTitle) {
              return [];
            }

            /*
             * Use the highest-priority TMDB alias only when the primary title
             * produced no media. One fallback keeps CineMode inside its 20s
             * runtime while covering alternate/localized title cases.
             */
            return runUiSearch(
              fallbackTitle,
              info,
              type,
              requestedSeason,
              requestedEpisode,
              ALIAS_WEBVIEW_MS
            ).then(function(aliasCaptured) {
              return buildStreams(
                aliasCaptured,
                info,
                type,
                requestedSeason,
                requestedEpisode
              );
            });
          });
      });

  return withSoftTimeout(
    work,
    PROVIDER_BUDGET_MS,
    "CineMode provider"
  )
    .then(function(streams) {
      console.log(
        "[CineMode] streams=" +
        (
          Array.isArray(streams)
            ? streams.length
            : 0
        )
      );

      return (
        Array.isArray(streams)
          ? streams
          : []
      );
    })
    .catch(function(error) {
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
