// wnt.js
// WNT Live Scores data source for Tournament Performance Calculator.
// Loaded as a classic script (not ES module) so it works with file:/// protocol.
//
// wntlivescores.com puts every page behind a login, including the JSON its live
// scores page polls. Reads go through the wnt-proxy Cloudflare Worker, which
// holds the session server-side:
//
//   GET /wnt/event/<slug>  every stage and group of an event, merged
//
// The Worker answers only browsers on an allowlisted origin. Its source lives
// in the PoolRadar repo under worker/.

(function() {
  'use strict';

  var WNT_PROXY = 'https://wnt-proxy.slyfox3.workers.dev/wnt';

  // 0 not started, 1 players called to the table, 2 under way, 3 complete.
  var STATUS_COMPLETE = 3;

  function playerName(p) {
    // nameReversed marks players written surname-first; the site swaps which
    // field holds which rather than reordering the output.
    var first = p.nameReversed ? p.surname : p.name;
    var last = p.nameReversed ? p.name : p.surname;
    return ((first || '') + (last ? ' ' + last : '')).trim();
  }

  // Losing a match whose loserDest is 0 ends the run; rankIni/rankEnd give the
  // finishing band, e.g. "193-256", which formatPlace() already renders.
  // Sign is not meaningful, only magnitude.
  function placeBand(sd) {
    var a = Math.abs(sd.rankIni || 0), b = Math.abs(sd.rankEnd || 0);
    if (!a && !b) return null;
    var lo = Math.min(a, b), hi = Math.max(a, b);
    return lo === hi ? String(lo) : lo + '-' + hi;
  }

  // Match numbers restart at 1 in every stage, so stage 2+ is offset out of the
  // way. Stage 1 keeps its natural numbers since brackets never reach 1000.
  function matchNum(stage, n) { return stage === 1 ? n : stage * 1000 + n; }

  // Flatten the Worker's stage/group nesting into one list, tagged with stage.
  function flattenRows(json) {
    var rows = [];
    var stages = json.stages || [];
    for (var si = 0; si < stages.length; si++) {
      var groups = stages[si].groups || [];
      for (var gi = 0; gi < groups.length; gi++) {
        var ms = groups[gi].matches || [];
        for (var mi = 0; mi < ms.length; mi++) {
          rows.push({ stage: stages[si].stage, m: ms[mi] });
        }
      }
    }
    return rows;
  }

  var WNT = {
    id: 'wnt',
    name: 'WNT Live Scores',
    urlPlaceholder: 'https://www.wntlivescores.com/events/your-event',

    matchesUrl: function(url) {
      return /wntlivescores\.com\/events\//i.test(url);
    },

    extractIdentifier: function(url) {
      var match = url.match(/\/events\/([^\/\?#]+)/);
      if (!match) return null;
      try { return decodeURIComponent(match[1]); } catch(e) { return match[1]; }
    },

    fetchData: async function(identifier) {
      var response = await fetch(WNT_PROXY + '/event/' + encodeURIComponent(identifier));
      var json;
      try {
        json = await response.json();
      } catch (e) {
        throw new Error('Proxy returned HTTP ' + response.status);
      }
      if (!response.ok) {
        if (json && json.error === 'auth') {
          throw new Error('The WNT proxy could not authenticate — its session has likely '
            + 'expired. Check ' + WNT_PROXY + '/health');
        }
        throw new Error((json && (json.message || json.error)) || ('HTTP ' + response.status));
      }
      return json;
    },

    parseData: function(json) {
      var tournamentInfo = {
        name: json.name || null,
        // WNT publishes a display range ("Aug 25 - 30, 2026") rather than a
        // timestamp, so pass it through instead of reformatting.
        date: json.dates || null,
        venue: [json.venue, json.city].filter(Boolean).join(', ') || null,
      };

      var rows = flattenRows(json);
      var playerMap = new Map();
      var validMatches = [];

      function registerPlayer(p) {
        // player.id is a stable slug ("aloysius-yapp"), so two entrants sharing
        // a display name stay distinct.
        if (!playerMap.has(p.id)) {
          playerMap.set(p.id, {
            id: p.id,
            name: playerName(p),
            skillLevel: null,  // WNT publishes no rating; FargoRate fills it in by name
            fargoId: null,
            place: null,
          });
        }
        return playerMap.get(p.id);
      }

      for (var i = 0; i < rows.length; i++) {
        var stage = rows[i].stage, m = rows[i].m, sd = m.schemaData || {};
        var p1 = m.players[0], p2 = m.players[1];

        // Undecided slots are bracket structure, not matches.
        if (!p1 || !p2) continue;
        if (m.status !== STATUS_COMPLETE) continue;
        // Walkovers carry no real score, same as DigitalPool forfeits.
        if (m.walkOver) continue;

        var scores = m.scores || [];
        var s1 = scores[0], s2 = scores[1];
        if (s1 == null || s2 == null) continue;
        if (s1 === 0 && s2 === 0) continue;

        var rec1 = registerPlayer(p1);
        var rec2 = registerPlayer(p2);

        // A losing side with nowhere to go is eliminated here, so this match
        // fixes where that player finished.
        if (!sd.loserDest && m.winner) {
          var band = placeBand(sd);
          if (band) {
            if (m.winner === 1) rec2.place = band;
            else rec1.place = band;
          }
        }

        validMatches.push({
          player1Id: p1.id,
          player2Id: p2.id,
          score1: s1,
          score2: s2,
          player1Won: m.winner === 1,
          matchNumber: matchNum(stage, m.matchNumberInSchema),
        });
      }

      var players = [];
      var idx = 0;
      for (var entry of playerMap) {
        entry[1].index = idx++;
        players.push(entry[1]);
      }

      return { players: players, matches: validMatches, playerMap: playerMap, tournamentInfo: tournamentInfo };
    },

    needsRatingLookup: true,

    buildShareUrl: function(identifier) {
      return 'https://www.wntlivescores.com/events/' + identifier + '/matches-list/1';
    },

    corsHelp: function() {
      return 'Could not reach the WNT proxy. Check ' + WNT_PROXY + '/health — if it '
        + 'reports ok:false the proxy session has expired.';
    },
  };

  window.TournamentDataSources = window.TournamentDataSources || [];
  window.TournamentDataSources.push(WNT);
})();
