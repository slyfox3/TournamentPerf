// wnt.js
// WNT Live Scores data source for Tournament Performance Calculator.
// Uses a Cloudflare CORS proxy to bypass CORS restrictions.
// User pastes a curl command to extract the session cookie, then both stages
// are fetched automatically.

(function() {
  'use strict';

  var CORS_PROXY = 'https://cors-proxy.slyfox3.workers.dev/?';
  var sessionCookie = null;

  function extractCookieFromCurl(curlCmd) {
    var match = curlCmd.match(/wnt\.live\.sid=([^\s;'"]+)/);
    return match ? 'wnt.live.sid=' + match[1] : null;
  }

  function escapeHtmlWnt(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showCookieModal(identifier) {
    var eventUrl = 'https://www.wntlivescores.com/events/' + identifier + '/matches-list/1';
    return new Promise(function(resolve, reject) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;';

      var modal = document.createElement('div');
      modal.style.cssText = 'background:#1e293b;border-radius:10px;padding:28px 32px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.4);position:relative;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

      // Build modal content using DOM APIs to avoid XSS from identifier
      var h2 = document.createElement('h2');
      h2.style.cssText = 'margin:0 0 8px 0;font-size:18px;color:#f1f5f9;';
      h2.textContent = 'WNT Live Scores Authentication';
      modal.appendChild(h2);

      var p = document.createElement('p');
      p.style.cssText = 'font-size:13px;color:#94a3b8;margin:0 0 16px 0;line-height:1.6;';
      p.textContent = 'WNT requires a free account. Log in and then:';
      modal.appendChild(p);

      var ol = document.createElement('ol');
      ol.style.cssText = 'font-size:13px;color:#94a3b8;margin:0 0 16px 0;line-height:2;padding-left:20px;';

      var li1 = document.createElement('li');
      li1.appendChild(document.createTextNode('Open '));
      var link = document.createElement('a');
      link.href = eventUrl;
      link.target = '_blank';
      link.style.color = '#60a5fa';
      link.textContent = eventUrl;
      li1.appendChild(link);
      li1.appendChild(document.createTextNode(' in Chrome'));
      ol.appendChild(li1);

      var stepsText = [
        'Open DevTools (F12 or Cmd+Option+I)',
        'Go to the Network tab',
        'Refresh the page (Cmd+R)',
        'Right-click the first request (named "1") → Copy → Copy as cURL',
        'Paste below'
      ];
      for (var si = 0; si < stepsText.length; si++) {
        var li = document.createElement('li');
        li.textContent = stepsText[si];
        ol.appendChild(li);
      }
      modal.appendChild(ol);

      // Static form content (no user input), safe as innerHTML
      var formDiv = document.createElement('div');
      formDiv.innerHTML = '<textarea id="wnt-curl-input" style="width:100%;height:120px;background:#0f172a;color:#e2e8f0;border:1px solid #475569;border-radius:4px;padding:8px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;" placeholder="curl \'https://www.wntlivescores.com/events/...\'  -H \'...\' -b \'wnt.live.sid=...\' ..."></textarea>'
        + '<div id="wnt-curl-error" style="color:#fca5a5;font-size:12px;margin-top:6px;display:none;"></div>'
        + '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">'
        + '<button id="wnt-curl-cancel" style="padding:8px 16px;border-radius:4px;background:#334155;color:#e2e8f0;border:none;cursor:pointer;font-size:13px;">Cancel</button>'
        + '<button id="wnt-curl-submit" style="padding:8px 16px;border-radius:4px;background:#2563eb;color:white;border:none;cursor:pointer;font-size:13px;font-weight:600;">Connect</button>'
        + '</div>';
      modal.appendChild(formDiv);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      document.getElementById('wnt-curl-cancel').onclick = function() {
        document.body.removeChild(overlay);
        reject(new Error('Authentication cancelled'));
      };

      overlay.onclick = function(e) {
        if (e.target === overlay) {
          document.body.removeChild(overlay);
          reject(new Error('Authentication cancelled'));
        }
      };

      document.getElementById('wnt-curl-submit').onclick = function() {
        var curlText = document.getElementById('wnt-curl-input').value.trim();
        var cookie = extractCookieFromCurl(curlText);
        if (!cookie) {
          var errEl = document.getElementById('wnt-curl-error');
          errEl.textContent = 'Could not find wnt.live.sid cookie in the curl command. Make sure you copied the full curl command.';
          errEl.style.display = 'block';
          return;
        }
        sessionCookie = cookie;
        document.body.removeChild(overlay);
        resolve(cookie);
      };

      setTimeout(function() { document.getElementById('wnt-curl-input').focus(); }, 50);
    });
  }

  function fetchViaProxy(pageUrl, cookie) {
    return fetch(CORS_PROXY + pageUrl, {
      headers: { 'x-custom-cookie': cookie },
    }).then(function(r) {
      if (!r.ok) throw new Error('Proxy returned HTTP ' + r.status);
      return r.text();
    });
  }

  // Safe HTML entity decoding via string replacement (no innerHTML)
  function decodeHtmlEntities(str) {
    return str
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, function(_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      })
      .replace(/&#(\d+);/g, function(_, dec) {
        return String.fromCharCode(parseInt(dec, 10));
      });
  }

  function parseMatchesFromHtml(html) {
    var text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<[^>]+>/g, '\n');

    var lines = [];
    var rawLines = text.split('\n');
    for (var i = 0; i < rawLines.length; i++) {
      var l = rawLines[i].trim();
      l = decodeHtmlEntities(l).trim();
      if (l && l !== ' ') lines.push(l);
    }

    var matches = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] !== 'vs') continue;
      if (i < 2 || i + 2 >= lines.length) continue;

      var score1 = null, name1 = null;
      for (var j = i - 1; j >= Math.max(i - 5, 0); j--) {
        if (/^\d+$/.test(lines[j]) && score1 === null) {
          score1 = parseInt(lines[j], 10);
        } else if (score1 !== null && name1 === null
          && lines[j] !== 'bye' && lines[j] !== 'vs'
          && !/^\d+$/.test(lines[j])
          && !/^#/.test(lines[j]) && !/^May\b/.test(lines[j]) && !/^Jun\b/.test(lines[j])
          && !/^Date\b/.test(lines[j]) && lines[j].length > 2
          && !/^W#/.test(lines[j]) && !/^T\d/.test(lines[j])
          && !/^L#/.test(lines[j])) {
          name1 = lines[j];
          break;
        }
      }

      var score2 = null, name2 = null;
      for (var j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (name2 === null
          && lines[j] !== 'bye' && lines[j] !== 'vs'
          && !/^\d+$/.test(lines[j])
          && !/^#/.test(lines[j]) && !/^May\b/.test(lines[j]) && !/^Jun\b/.test(lines[j])
          && !/^Date\b/.test(lines[j]) && lines[j].length > 2
          && !/^W#/.test(lines[j]) && !/^T\d/.test(lines[j])
          && !/^L#/.test(lines[j])) {
          name2 = lines[j];
        } else if (/^\d+$/.test(lines[j]) && name2 !== null && score2 === null) {
          score2 = parseInt(lines[j], 10);
          break;
        }
      }

      if (name1 && name2 && score1 !== null && score2 !== null) {
        matches.push({
          player1Name: name1,
          player2Name: name2,
          score1: score1,
          score2: score2,
        });
      }
    }
    return matches;
  }

  function extractEventName(html) {
    var match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (match) {
      var title = match[1].replace(/<[^>]+>/g, '').trim();
      if (title && title !== 'World Nineball Tour live scores') return title;
    }
    return null;
  }

  function extractStageLinks(html, baseUrl) {
    var maxStage = 0;
    var matches = html.match(/matches-list\/(\d+)/g);
    if (matches) {
      for (var i = 0; i < matches.length; i++) {
        var num = parseInt(matches[i].replace('matches-list/', ''), 10);
        if (num > maxStage) maxStage = num;
      }
    }
    var stageLinks = [];
    var base = baseUrl.replace(/\/$/, '');
    for (var s = 1; s <= maxStage; s++) {
      stageLinks.push(base + '/matches-list/' + s);
    }
    return stageLinks;
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
      return match ? match[1] : null;
    },

    fetchData: async function(identifier) {
      var cookie = sessionCookie;
      if (!cookie && window._wntCookieReady) {
        cookie = await window._wntCookieReady;
        if (cookie) sessionCookie = cookie;
        delete window._wntCookieReady;
      }
      if (!cookie) {
        cookie = await showCookieModal(identifier);
      }

      // Reset fetch timer after modal interaction
      this._fetchT0 = performance.now();

      var baseUrl = 'https://www.wntlivescores.com/events/' + identifier;

      // First fetch the event page to discover stage links
      var eventHtml = await fetchViaProxy(baseUrl, cookie);

      // Check if we got a login page
      if (eventHtml.indexOf('form action="/login"') !== -1 && eventHtml.indexOf('matches-list') === -1) {
        sessionCookie = null;
        throw new Error('Session expired. Please reload and paste a fresh curl command.');
      }

      var eventName = extractEventName(eventHtml) || identifier.replace(/-/g, ' ');
      var stageLinks = extractStageLinks(eventHtml, baseUrl);

      if (stageLinks.length === 0) {
        stageLinks = [baseUrl];
      }

      // Fetch all stages in parallel
      var allMatches = [];
      var stageHtmls = await Promise.all(stageLinks.map(function(link) {
        return fetchViaProxy(link, cookie);
      }));

      for (var i = 0; i < stageHtmls.length; i++) {
        var stageMatches = parseMatchesFromHtml(stageHtmls[i]);
        allMatches = allMatches.concat(stageMatches);
      }

      return {
        eventName: eventName,
        matches: allMatches,
        stageCount: stageLinks.length,
      };
    },

    parseData: function(json) {
      var tournamentInfo = {
        name: json.eventName,
        date: null,
        venue: null,
      };

      var playerMap = new Map();
      var validMatches = [];

      function getOrCreatePlayer(name) {
        if (!playerMap.has(name)) {
          playerMap.set(name, {
            id: name,
            name: name,
            skillLevel: null,
            fargoId: null,
            place: null,
            index: 0,
          });
        }
        return playerMap.get(name);
      }

      for (var i = 0; i < json.matches.length; i++) {
        var m = json.matches[i];
        if (m.score1 === 0 && m.score2 === 0) continue;

        getOrCreatePlayer(m.player1Name);
        getOrCreatePlayer(m.player2Name);

        validMatches.push({
          player1Id: m.player1Name,
          player2Id: m.player2Name,
          score1: m.score1,
          score2: m.score2,
          player1Won: m.score1 > m.score2,
          matchNumber: i + 1,
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
      return 'https://www.wntlivescores.com/events/' + identifier;
    },

    corsHelp: function() {
      return 'CORS proxy could not reach WNT. Check that cors-proxy.slyfox3.workers.dev is running.';
    },
  };

  window.TournamentDataSources = window.TournamentDataSources || [];
  window.TournamentDataSources.push(WNT);
})();
