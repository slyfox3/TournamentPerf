// digitalpool.js
// DigitalPool data source for Tournament Performance Calculator.
// Loaded as a classic script (not ES module) so it works with file:/// protocol.

(function() {
  'use strict';

  // =====================================================
  // DigitalPool Data Source
  // =====================================================
  var DigitalPool = (function() {
    var GRAPHQL_ENDPOINT = 'https://api-cached.digitalpool.com/';

    var GRAPHQL_QUERY = 'query tournament_brackets($slug: String!) {\n'
      + '  tournament_brackets(\n'
      + '    where: {tournament: {slug: {_eq: $slug}}}\n'
      + '    order_by: {match_number: asc}\n'
      + '  ) {\n'
      + '    challenger1 {\n'
      + '      id\n'
      + '      name\n'
      + '      skill_level\n'
      + '      fargo_id\n'
      + '      place\n'
      + '      __typename\n'
      + '    }\n'
      + '    challenger2 {\n'
      + '      id\n'
      + '      name\n'
      + '      skill_level\n'
      + '      fargo_id\n'
      + '      place\n'
      + '      __typename\n'
      + '    }\n'
      + '    challenger1_score\n'
      + '    challenger2_score\n'
      + '    challenger1_is_winner\n'
      + '    challenger2_is_winner\n'
      + '    challenger1_is_forfeit\n'
      + '    challenger1_is_withdraw\n'
      + '    challenger2_is_forfeit\n'
      + '    challenger2_is_withdraw\n'
      + '    status\n'
      + '    is_bye\n'
      + '    match_number\n'
      + '    tournament {\n'
      + '      name\n'
      + '      start_date_time\n'
      + '      venue {\n'
      + '        name\n'
      + '        city\n'
      + '        region\n'
      + '        __typename\n'
      + '      }\n'
      + '      __typename\n'
      + '    }\n'
      + '    __typename\n'
      + '  }\n'
      + '}';

    function resolveSkillLevel(challenger) {
      if (challenger.skill_level != null && Number.isInteger(challenger.skill_level)) {
        return challenger.skill_level;
      }
      var nameMatch = challenger.name.match(/\b(\d{2,4})\b/);
      if (nameMatch) {
        return parseInt(nameMatch[1], 10);
      }
      return null;
    }

    return {
      id: 'digitalpool',
      name: 'DigitalPool',
      urlPlaceholder: 'https://digitalpool.com/tournaments/your-tournament',
      jsonPlaceholder: '{"data":{"tournament_brackets":[...]}}',

      matchesUrl: function(url) {
        return /digitalpool\.com\/tournaments\//i.test(url);
      },

      extractIdentifier: function(url) {
        var match = url.match(/\/tournaments\/([^\/\?#]+)/);
        if (!match) return null;
        try { return decodeURIComponent(match[1]); } catch(e) { return match[1]; }
      },

      fetchData: async function(identifier) {
        var response = await fetch(GRAPHQL_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationName: 'tournament_brackets',
            variables: { slug: identifier },
            query: GRAPHQL_QUERY,
          }),
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var json = await response.json();
        if (json.errors) throw new Error(json.errors[0].message);
        return json;
      },

      parseData: function(json) {
        var brackets = json.data.tournament_brackets;

        // Extract tournament info
        var tournamentInfo = {};
        if (brackets.length > 0 && brackets[0].tournament) {
          var t = brackets[0].tournament;
          tournamentInfo.name = t.name || null;
          tournamentInfo.date = t.start_date_time
            ? new Date(t.start_date_time).toLocaleDateString(undefined, {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
              })
            : null;
          if (t.venue) {
            var parts = [t.venue.name, t.venue.city, t.venue.region].filter(Boolean);
            tournamentInfo.venue = parts.length > 0 ? parts.join(', ') : null;
          }
        }

        var playerMap = new Map();
        var validMatches = [];

        for (var i = 0; i < brackets.length; i++) {
          var m = brackets[i];
          if (m.status !== 'COMPLETED') continue;
          if (m.is_bye) continue;
          if (!m.challenger1 || !m.challenger2) continue;
          if (m.challenger1_is_forfeit || m.challenger1_is_withdraw) continue;
          if (m.challenger2_is_forfeit || m.challenger2_is_withdraw) continue;
          if (m.challenger1_score == null || m.challenger2_score == null) continue;
          if (m.challenger1_score === 0 && m.challenger2_score === 0) continue;

          var challengers = [m.challenger1, m.challenger2];
          for (var j = 0; j < challengers.length; j++) {
            var c = challengers[j];
            if (!playerMap.has(c.id)) {
              playerMap.set(c.id, {
                id: c.id,
                name: c.name,
                skillLevel: resolveSkillLevel(c),
                fargoId: c.fargo_id,
                place: c.place,
              });
            }
          }

          validMatches.push({
            player1Id: m.challenger1.id,
            player2Id: m.challenger2.id,
            score1: m.challenger1_score,
            score2: m.challenger2_score,
            player1Won: !!m.challenger1_is_winner,
            matchNumber: m.match_number,
          });
        }

        // Assign indices
        var players = [];
        var idx = 0;
        for (var entry of playerMap) {
          entry[1].index = idx++;
          players.push(entry[1]);
        }

        return { players: players, matches: validMatches, playerMap: playerMap, tournamentInfo: tournamentInfo };
      },

      buildShareUrl: function(identifier) {
        return 'https://digitalpool.com/tournaments/' + identifier;
      },

      corsHelp: function(identifier) {
        return 'CORS blocked. Use the "paste JSON manually" option instead. Run this in your terminal:\n'
          + "curl -s 'https://api-cached.digitalpool.com/' "
          + "-H 'content-type: application/json' "
          + '-d \'{"operationName":"tournament_brackets","variables":{"slug":"'
          + identifier
          + '"},"query":"'
          + GRAPHQL_QUERY.replace(/\n/g, '\\n')
          + '"}\'';
      },
    };
  })();

  // =====================================================
  // Registry
  // =====================================================
  window.TournamentDataSources = window.TournamentDataSources || [];
  window.TournamentDataSources.push(DigitalPool);
})();
