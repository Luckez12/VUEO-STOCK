# VUEO-STOCK

Official JavaScript provider repository for VUEO.

## Install URL

`https://raw.githubusercontent.com/Luckez12/VUEO-STOCK/refs/heads/main/manifest.json`

## Provider contract

Distribution files use the Nuvio-compatible CommonJS contract already supported by VUEO:

```javascript
async function getStreams(tmdbId, mediaType, season, episode) {
  return [];
}

module.exports = { getStreams };
```

Each stream may include `name`, `title`, `url`, `quality` and optional playback `headers`.

Run `npm run validate` before publishing changes.
