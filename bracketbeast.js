// bracketbeast.js
// BracketBeast data source for Tournament Performance Calculator.

(function() {
  'use strict';

  var API_ENDPOINT = 'https://bracket-beast-prod-app.azurewebsites.net/api/external/viewbracket?disableTimeZoneConversion=false';
  var CORS_PROXY = 'https://corsproxy.io/?url=';

  var BracketBeast = {
    id: 'bracketbeast',
    name: 'BracketBeast',
    urlPlaceholder: 'https://player.bracketbeast.com/tournament/.../brackets/644',
    needsRatingLookup: true,

    matchesUrl: function(url) {
      return /player\.bracketbeast\.com\/tournament\//i.test(url);
    },

    extractIdentifier: function(url) {
      var match = url.match(/\/brackets\/(\d+)/);
      return match ? match[1] : null;
    },

    fetchData: async function(identifier) {
      var response = await fetch(CORS_PROXY + encodeURIComponent(API_ENDPOINT), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'tenantid': '1.',
        },
        body: JSON.stringify({ divisionBracketId: parseInt(identifier, 10) }),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    },

    parseData: function(json) {
      var tournamentInfo = {
        name: [json.tournamentName, json.divisionName].filter(Boolean).join(' \u2014 '),
        date: null,
        venue: null,
      };

      var playerMap = new Map();
      var validMatches = [];

      function registerPlayer(id, name) {
        if (!id || !name) return;
        if (!playerMap.has(id)) {
          playerMap.set(id, {
            id: id,
            name: name,
            skillLevel: null,
            fargoId: null,
            place: null,
          });
        }
      }

      for (var ri = 0; ri < json.rounds.length; ri++) {
        var round = json.rounds[ri];
        for (var mi = 0; mi < round.matches.length; mi++) {
          var m = round.matches[mi];

          // Only completed matches with a winner
          if (m.matchStatus !== 'WinnerPlayer1' && m.matchStatus !== 'WinnerPlayer2') continue;

          // Skip if either player is missing
          if (!m.divisionPlayerId1 || !m.divisionPlayerId2) continue;
          if (!m.divisionPlayer1Name || !m.divisionPlayer2Name) continue;

          // Skip forfeits
          if (m.matchStatusId === 14 || m.matchStatusId === 15) continue;

          var score1 = parseInt(m.divisionPlayerId1Score, 10);
          var score2 = parseInt(m.divisionPlayerId2Score, 10);
          if (isNaN(score1) || isNaN(score2)) continue;
          if (score1 === 0 && score2 === 0) continue;

          registerPlayer(m.divisionPlayerId1, m.divisionPlayer1Name);
          registerPlayer(m.divisionPlayerId2, m.divisionPlayer2Name);

          validMatches.push({
            player1Id: m.divisionPlayerId1,
            player2Id: m.divisionPlayerId2,
            score1: score1,
            score2: score2,
            player1Won: m.matchStatus === 'WinnerPlayer1',
            matchNumber: m.id,
          });
        }
      }

      // Assign indices
      var players = [];
      var idx = 0;
      for (var pEntry of playerMap) {
        pEntry[1].index = idx++;
        players.push(pEntry[1]);
      }

      return { players: players, matches: validMatches, playerMap: playerMap, tournamentInfo: tournamentInfo };
    },

    buildShareUrl: function(identifier) {
      return 'https://player.bracketbeast.com/tournament/0/divisions/0/brackets/' + identifier;
    },

    corsHelp: function(identifier) {
      var localUrl = 'http://localhost:8080/?bracketbeast=' + identifier;
      return 'BracketBeast requires a local server. Run this in your terminal:'
        + '\n'
        + 'cd /tmp && git clone https://github.com/slyfox3/TournamentPerf.git 2>/dev/null; cd /tmp/TournamentPerf && git pull -q && python3 -m http.server 8080'
        + '\n'
        + 'Then open: ' + localUrl;
    },
  };

  window.TournamentDataSources = window.TournamentDataSources || [];
  window.TournamentDataSources.push(BracketBeast);
})();
