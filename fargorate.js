// fargorate.js
// Fargo Rate lookup utility for Tournament Performance Calculator.

(function() {
  'use strict';

  var API_BASE = 'https://dashboard.fargorate.com/api/indexsearch?q=';

  // Lookups cost ~2.3s each and a 256-player field needs one per player, so
  // responses are cached in localStorage. What is cached is the raw candidate
  // list, not the resolved rating: disambiguation below picks between
  // same-name players using the states present in the current field, and that
  // decision does not transfer to a different tournament.
  var CACHE_KEY = 'tp_fargo_cache_v1';
  var HIT_TTL = 7 * 24 * 3600 * 1000;   // ratings move slowly
  var MISS_TTL = 24 * 3600 * 1000;      // a missing player may get added
  var MAX_ENTRIES = 5000;

  var memCache = null;

  function loadCache() {
    if (memCache) return memCache;
    try {
      memCache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch (e) {
      memCache = {};
    }
    return memCache;
  }

  var saveTimer = null;
  function scheduleSave() {
    // A 256-player load would otherwise serialise the cache 256 times.
    if (saveTimer) return;
    saveTimer = setTimeout(function() {
      saveTimer = null;
      var cache = loadCache();
      var keys = Object.keys(cache);
      if (keys.length > MAX_ENTRIES) {
        keys.sort(function(a, b) { return cache[a].t - cache[b].t; });
        for (var i = 0; i < keys.length - MAX_ENTRIES; i++) delete cache[keys[i]];
      }
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch (e) { /* quota exceeded — the cache is an optimisation only */ }
    }, 250);
  }

  function cacheKeyFor(name) { return name.trim().toLowerCase(); }

  function cacheGet(name) {
    var e = loadCache()[cacheKeyFor(name)];
    if (!e) return null;
    var ttl = (e.v && e.v.length) ? HIT_TTL : MISS_TTL;
    if (Date.now() - e.t > ttl) return null;
    return e.v;
  }

  function cachePut(name, candidates) {
    // Keep only the fields makeResult() and disambiguation read.
    loadCache()[cacheKeyFor(name)] = {
      t: Date.now(),
      v: candidates.map(function(c) {
        return {
          id: c.id,
          effectiveRating: c.effectiveRating,
          rating: c.rating,
          location: c.location,
        };
      }),
    };
    scheduleSave();
  }

  function extractState(location) {
    if (!location) return null;
    var trimmed = location.trim();
    var match = trimmed.match(/\b([A-Z]{2})$/);
    return match ? match[1] : null;
  }

  function fetchOne(name) {
    return fetch(API_BASE + encodeURIComponent(name), {
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Origin': 'https://fairmatch.fargorate.com',
        'Referer': 'https://fairmatch.fargorate.com/',
      },
    })
      .then(function(r) { return r.json(); })
      .then(function(json) {
        var value = json.value || [];
        cachePut(name, value);
        return { name: name, value: value };
      })
      // Do not cache failures — a transient network error is not a "no such
      // player", and caching it would suppress the retry.
      .catch(function() { return { name: name, value: [] , error: true }; });
  }

  function makeResult(c) {
    return {
      rating: parseInt(c.effectiveRating, 10) || parseInt(c.rating, 10) || null,
      fargoId: c.id,
      location: (c.location || '').trim(),
    };
  }

  /**
   * Look up Fargo ratings for multiple player names.
   * Cached names resolve without a request; the rest go out `concurrency` at
   * a time. onProgress fires after each individual player (not per batch).
   *
   * Options:
   *   onProgress(done, total, results) — called after each player
   *   concurrency — max parallel requests (default 24)
   *
   * Returns a Map of name → { rating, fargoId, location } or null.
   */
  async function resolveAll(names, options) {
    options = options || {};
    var onProgress = options.onProgress || null;
    // Measured against the live API: 6 took ~98s for 256 names, 24 took ~23s
    // with no throttling or errors.
    var concurrency = options.concurrency || 24;

    var results = new Map();
    if (!names || names.length === 0) return results;

    var total = names.length;
    var done = 0;
    var pending = []; // for disambiguation
    var knownStates = new Set();

    function classifyResponse(resp) {
      var candidates = resp.value;
      if (candidates.length === 0) {
        results.set(resp.name, null);
      } else if (candidates.length === 1) {
        var c = candidates[0];
        var state = extractState(c.location);
        results.set(resp.name, makeResult(c));
        if (state) knownStates.add(state);
      } else {
        pending.push({ name: resp.name, candidates: candidates });
      }
    }

    // Serve whatever the cache already holds before opening any connections.
    var toFetch = [];
    for (var i = 0; i < names.length; i++) {
      var cached = cacheGet(names[i]);
      if (cached) {
        classifyResponse({ name: names[i], value: cached });
        done++;
      } else {
        toFetch.push(names[i]);
      }
    }
    // Report the cache burst separately: it resolves at t=0, so a caller
    // measuring throughput has to exclude it or every rate looks fictional.
    if (options.onCached) options.onCached(done);
    if (onProgress && done > 0) onProgress(done, total, results);

    var nextIndex = 0;

    // Sliding window: keep up to `concurrency` requests in flight
    if (toFetch.length > 0) {
      await new Promise(function(resolve) {
        var inFlight = 0;

        function launch() {
          while (inFlight < concurrency && nextIndex < toFetch.length) {
            var name = toFetch[nextIndex++];
            inFlight++;
            fetchOne(name).then(function(resp) {
              classifyResponse(resp);
              done++;
              inFlight--;
              if (onProgress) onProgress(done, total, results);
              if (done >= total) {
                resolve();
              } else {
                launch();
              }
            });
          }
        }

        launch();
      });
    }

    // Disambiguation passes
    var changed = true;
    while (changed && pending.length > 0) {
      changed = false;
      var stillPending = [];

      for (var pi = 0; pi < pending.length; pi++) {
        var entry = pending[pi];
        var filtered = entry.candidates.filter(function(c) {
          var st = extractState(c.location);
          return st && knownStates.has(st);
        });

        if (filtered.length === 1) {
          var fc = filtered[0];
          var fState = extractState(fc.location);
          results.set(entry.name, makeResult(fc));
          if (fState) knownStates.add(fState);
          changed = true;
        } else {
          stillPending.push(entry);
        }
      }

      pending = stillPending;
    }

    // Remaining ambiguous names → null
    for (var k = 0; k < pending.length; k++) {
      results.set(pending[k].name, null);
    }

    return results;
  }

  function cacheStats() {
    var cache = loadCache();
    var keys = Object.keys(cache);
    var hits = 0, misses = 0, expired = 0;
    var now = Date.now();
    for (var i = 0; i < keys.length; i++) {
      var e = cache[keys[i]];
      var ttl = (e.v && e.v.length) ? HIT_TTL : MISS_TTL;
      if (now - e.t > ttl) expired++;
      else if (e.v && e.v.length) hits++;
      else misses++;
    }
    var bytes = 0;
    try { bytes = (localStorage.getItem(CACHE_KEY) || '').length * 2; } catch (e) {}
    return { entries: keys.length, withRating: hits, notFound: misses, expired: expired, bytes: bytes };
  }

  function clearCache() {
    memCache = {};
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  window.FargoRateLookup = {
    resolveAll: resolveAll,
    cacheStats: cacheStats,
    clearCache: clearCache,
  };
})();
