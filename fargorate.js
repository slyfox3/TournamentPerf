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
  // v2 added `robustness` to each cached candidate. A v1 entry has no such
  // field, and reading one back would look like a robustness of 0 and get the
  // player discarded, so the key change retires the old entries wholesale.
  var CACHE_KEY = 'tp_fargo_cache_v2';
  var LEGACY_CACHE_KEYS = ['tp_fargo_cache_v1'];
  var HIT_TTL = 7 * 24 * 3600 * 1000;   // ratings move slowly
  var MISS_TTL = 24 * 3600 * 1000;      // a missing player may get added
  var MAX_ENTRIES = 5000;

  // FargoRate publishes a number for every record it holds, including ones with
  // no games behind them. Robustness is the rack count that number rests on,
  // and below a few hundred the rating is a guess the solver would nonetheless
  // anchor as hard as one built from thousands of racks. The US Open 2026 field
  // matched a Stephen Fleming to a record carrying robustness 0, and its 203
  // then sat ~490 points below how he actually played. Identifying a player and
  // trusting their rating are separate questions, so this one is asked last —
  // see isRated().
  var MIN_ROBUSTNESS = 200;

  // The state test below assumes a regional field, where a few states account
  // for everyone and a candidate from anywhere else is therefore a namesake.
  // A national open breaks that assumption: with entrants from most of the
  // country the question "is this state represented?" stops discriminating, and
  // which candidate it lands on comes down to whichever states happened to
  // arrive from unique-name players. In the 37-state US Open 2026 field it
  // picked a 484 in Escondido CA over a 672 in WA for Salvador Garcia on
  // exactly that basis, off nothing more than CA having turned up already.
  // Past this many states, leaving the name unrated beats guessing.
  var MAX_FIELD_STATES = 5;

  var memCache = null;

  function loadCache() {
    if (memCache) return memCache;
    try {
      memCache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch (e) {
      memCache = {};
    }
    // A superseded cache is dead weight that still counts against the origin's
    // quota, which is what makes the setItem() below start throwing.
    for (var i = 0; i < LEGACY_CACHE_KEYS.length; i++) {
      try { localStorage.removeItem(LEGACY_CACHE_KEYS[i]); } catch (e) {}
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
          robustness: c.robustness,
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

  // --- name matching -------------------------------------------------------
  // The index is a fuzzy one and always answers with its nearest neighbours,
  // so "no such player" and "a stranger who shares some letters" arrive as the
  // same shape of response. Asking it for "Lin Ta Li" returns "Diem Linh Ta".
  // Comparing the name back tells the two apart.

  // NFD strips the accents that decompose; these are the letters that do not.
  var LETTER_FOLD = { 'ø': 'o', 'æ': 'ae', 'ð': 'd', 'þ': 'th',
                      'ß': 'ss', 'đ': 'd', 'ł': 'l' };

  // "Sam" for Samuel and "Rich" for Richard are the same entrant; "Li" for
  // "Linh" is not. Three characters is where a prefix stops being a coincidence
  // — it admits every nickname in the US Open 2026 field and no false match.
  var NICKNAME_MIN = 3;

  function nameTokens(s) {
    return String(s || '').toLowerCase()
      .replace(/[øæðþßđł]/g, function(c) { return LETTER_FOLD[c]; })
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      // Hyphens split, so the index's "Ta-Li Lin" tokenises the same as the
      // bracket's "Lin Ta Li" and the two compare equal.
      .replace(/[^a-z0-9]+/g, ' ')
      .trim().split(/\s+/).filter(Boolean);
  }

  function tokenAlike(a, b) {
    return a === b
      || (a.length >= NICKNAME_MIN && b.indexOf(a) === 0)
      || (b.length >= NICKNAME_MIN && a.indexOf(b) === 0);
  }

  // Every token of the shorter name must pair with a *distinct* token of the
  // longer one. Distinctness is what rejects "Diem Linh Ta" for "Lin Ta Li":
  // "lin" and "li" would both happily claim "linh", but only one may have it,
  // and nothing is left for the other. Order is ignored throughout, which is
  // the point — a surname-first bracket entry still matches.
  function coverable(short, long) {
    if (short.length === 0) return false;
    var used = new Array(long.length);
    function assign(i) {
      if (i === short.length) return true;
      for (var j = 0; j < long.length; j++) {
        if (used[j] || !tokenAlike(short[i], long[j])) continue;
        used[j] = true;
        if (assign(i + 1)) return true;
        used[j] = false;
      }
      return false;
    }
    return assign(0);
  }

  function matchesName(tokens, c) {
    var ct = nameTokens((c.firstName || '') + ' ' + (c.lastName || ''));
    return tokens.length <= ct.length ? coverable(tokens, ct) : coverable(ct, tokens);
  }

  // Spellings to fall back to when the index cannot match a name as written.
  // Measured against the live index over the eight surname-first entrants in
  // the US Open 2026 field: moving the last token to the front found seven of
  // them, moving the first token to the back found the eighth, and the two
  // hyphenated spellings found none. "Ta-Li Lin" returns nothing for a player
  // the index stores as exactly "Ta-Li Lin", so hyphenating is not worth a
  // request; the hyphens matter when comparing names, not when asking.
  function nameVariants(name) {
    var t = String(name).trim().split(/\s+/);
    if (t.length < 2) return [];
    var out = [];
    var rotRight = [t[t.length - 1]].concat(t.slice(0, -1)).join(' ');
    var rotLeft = t.slice(1).concat([t[0]]).join(' ');
    if (rotRight !== name) out.push(rotRight);
    // Identical to rotRight for a two-token name; one request, not two.
    if (rotLeft !== name && rotLeft !== rotRight) out.push(rotLeft);
    return out;
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

  // Asked last, once the field has been narrowed to a single person. A thin
  // record is still a candidate while we are working out *who* this is —
  // discarding it earlier would let a genuine two-way tie masquerade as a
  // clean single match and resolve with false confidence — and only when one
  // candidate is left do we ask whether its rating is worth anchoring on.
  function isRated(c) {
    return (parseInt(c.robustness, 10) || 0) >= MIN_ROBUSTNESS;
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
   *   concurrency — max outstanding requests (default 72)
   *
   * Returns a Map of name → { rating, fargoId, location } or null.
   */
  async function resolveAll(names, options) {
    options = options || {};
    var onProgress = options.onProgress || null;
    // How many fetches we leave outstanding, which is not how many actually
    // fly: dashboard.fargorate.com is HTTP/1.1 only (no ALPN h2), so the
    // browser holds it to 6 sockets per host no matter what this says. Past
    // that point the number only keeps the socket pool from going idle between
    // a response landing and the next request being queued.
    //
    // Measured against the live API with 80 disjoint names per run, outside
    // the browser so the socket cap does not apply: 6 -> 10.4s, 24 -> 8.2s,
    // 72 -> 3.1s, every request 200, no throttling. Inside the browser expect
    // the 6-socket figure. The localStorage cache above is the real win.
    var concurrency = options.concurrency || 72;

    var results = new Map();
    if (!names || names.length === 0) return results;

    var total = names.length;
    var done = 0;
    var pending = []; // for disambiguation
    var knownStates = new Set();

    // The candidates worth considering for `name`: everyone actually bearing
    // that name, thin records included. Robustness is not asked about here —
    // see resolveTo().
    function poolFor(name, value) {
      var tokens = nameTokens(name);
      return value.filter(function(c) { return matchesName(tokens, c); });
    }

    // One candidate left, so this is the person. The state goes into the field
    // regardless of what happens to the rating: it says where an entrant is
    // from, which is still true of a player whose rating we decline to use.
    function resolveTo(name, c) {
      var state = extractState(c.location);
      if (state) knownStates.add(state);
      results.set(name, isRated(c) ? makeResult(c) : null);
    }

    function place(name, pool) {
      if (pool.length === 1) {
        resolveTo(name, pool[0]);
      } else if (pool.length > 1) {
        pending.push({ name: name, candidates: pool });
      } else {
        results.set(name, null);
      }
    }

    function fetchCached(name) {
      var hit = cacheGet(name);
      if (hit) return Promise.resolve({ name: name, value: hit });
      return fetchOne(name);
    }

    // One player, however many requests that takes: the name as the bracket
    // spells it, then the reordered spellings from nameVariants() if the index
    // could not match it. Counting a player done only once this resolves keeps
    // the progress bar honest — a name that needs three requests takes three
    // requests' worth of the bar.
    async function resolveOne(name) {
      var resp = await fetchCached(name);
      var pool = poolFor(name, resp.value);

      var variants = nameVariants(name);
      for (var vi = 0; pool.length === 0 && vi < variants.length; vi++) {
        var alt = await fetchCached(variants[vi]);
        pool = poolFor(name, alt.value);
      }
      // Carries the name back rather than closing over it: the caller's loop
      // reassigns its `name` before this settles.
      return { name: name, pool: pool };
    }

    // Serve whatever the cache already holds before opening any connections.
    // A cached response that yields no pool is not finished with — the variant
    // spellings still have to be tried — so it goes down the async path, where
    // fetchCached() will replay it from the cache for free.
    var toFetch = [];
    for (var i = 0; i < names.length; i++) {
      var cached = cacheGet(names[i]);
      var cachedPool = cached ? poolFor(names[i], cached) : [];
      if (cachedPool.length > 0) {
        place(names[i], cachedPool);
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
            resolveOne(name).then(function(r) {
              place(r.name, r.pool);
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

    // Disambiguation passes. Checked per pass rather than once up front because
    // each resolution can itself widen the field: a run that starts inside
    // MAX_FIELD_STATES and grows past it has to stop there, not coast on the
    // count it began with. Names still pending fall through to null below.
    var changed = true;
    while (changed && pending.length > 0 && knownStates.size <= MAX_FIELD_STATES) {
      changed = false;
      var stillPending = [];

      for (var pi = 0; pi < pending.length; pi++) {
        var entry = pending[pi];
        var matched = [];      // state extracted and present in this field
        var unreadable = 0;    // no state extracted — neither ruled in nor out

        for (var ci = 0; ci < entry.candidates.length; ci++) {
          var cand = entry.candidates[ci];
          var cState = extractState(cand.location);
          if (!cState) unreadable++;
          else if (knownStates.has(cState)) matched.push(cand);
          // else: a state we can read that nobody in this field is from — out.
        }

        // A location extractState() cannot parse is a country code ("Magalang
        // PHL"), a foreign locality ("Kaunas 16") or blank. Those are the
        // players most likely to share a name with a US namesake, so counting
        // them as eliminated turns a genuine two-way tie into a confident wrong
        // answer. They only stop being candidates once we can read them.
        if (matched.length === 1 && unreadable === 0) {
          resolveTo(entry.name, matched[0]);
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
