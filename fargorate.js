// fargorate.js
// Fargo Rate lookup utility for Tournament Performance Calculator.

(function() {
  'use strict';

  var API_BASE = 'https://dashboard.fargorate.com/api/indexsearch?q=';

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
      .then(function(json) { return { name: name, value: json.value || [] }; })
      .catch(function() { return { name: name, value: [] }; });
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
   * Up to `concurrency` requests fly in parallel, but onProgress fires
   * after each individual player completes (not per batch).
   *
   * Options:
   *   onProgress(done, total, results) — called after each player
   *   concurrency — max parallel requests (default 6)
   *
   * Returns a Map of name → { rating, fargoId, location } or null.
   */
  async function resolveAll(names, options) {
    options = options || {};
    var onProgress = options.onProgress || null;
    var concurrency = options.concurrency || 6;

    var results = new Map();
    if (!names || names.length === 0) return results;

    var total = names.length;
    var done = 0;
    var pending = []; // for disambiguation
    var knownStates = new Set();
    var nextIndex = 0;

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

    // Sliding window: keep up to `concurrency` requests in flight
    await new Promise(function(resolve) {
      var inFlight = 0;

      function launch() {
        while (inFlight < concurrency && nextIndex < total) {
          var name = names[nextIndex++];
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

  window.FargoRateLookup = {
    resolveAll: resolveAll,
  };
})();
