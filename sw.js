// ═══════════════════════════════════════════════
// Task Planner — Service Worker
// ═══════════════════════════════════════════════
const CACHE = 'taskplanner-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

// ── Install: cache app shell ──
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(cache){
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE; })
            .map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── Fetch: serve from cache, fallback to network ──
self.addEventListener('fetch', function(e){
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(response){
        // Cache successful GET requests
        if(e.request.method === 'GET' && response.status === 200){
          var copy = response.clone();
          caches.open(CACHE).then(function(cache){ cache.put(e.request, copy); });
        }
        return response;
      });
    }).catch(function(){
      return caches.match('/index.html');
    })
  );
});

// ── Message from app: schedule notifications ──
var scheduledTimers = [];

self.addEventListener('message', function(e){
  if(!e.data || e.data.type !== 'SCHEDULE') return;

  // Clear existing timers
  scheduledTimers.forEach(function(t){ clearTimeout(t); });
  scheduledTimers = [];

  var prayers = e.data.prayers || {};
  var events  = e.data.events  || [];
  var today   = e.data.today   || '';

  var now = new Date();
  var nowMin = now.getHours() * 60 + now.getMinutes();

  // ── Schedule prayer notifications ──
  var prayerNames = {
    Fajr:    'Fajr-Gebet',
    Shuruk:  'Sonnenaufgang (Shuruk)',
    Dhuhr:   'Dhuhr-Gebet',
    Asr:     'Asr-Gebet',
    Maghrib: 'Maghrib-Gebet',
    Isha:    'Isha-Gebet'
  };

  Object.entries(prayers).forEach(function(entry){
    var name = entry[0];
    var time = entry[1];
    if(!time) return;
    var parts = time.split(':');
    var pMin  = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    var diffMs = (pMin - nowMin) * 60 * 1000;

    // Only schedule future prayers (within next 24h)
    if(diffMs > 0 && diffMs < 24 * 60 * 60 * 1000){
      var t = setTimeout(function(){
        self.registration.showNotification('🕌 ' + prayerNames[name], {
          body: 'Es ist jetzt ' + time + ' Uhr — Zeit für das ' + prayerNames[name] + '.',
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          tag: 'prayer-' + name,
          requireInteraction: true,
          vibrate: [200, 100, 200],
          actions: [
            { action: 'ok',   title: 'Verstanden' },
            { action: 'snooze', title: '5 Min später' }
          ]
        });
      }, diffMs);
      scheduledTimers.push(t);

      // Also schedule a 10-minute warning
      var warnMs = diffMs - 10 * 60 * 1000;
      if(warnMs > 0){
        var tw = setTimeout(function(){
          self.registration.showNotification('⏰ ' + prayerNames[name] + ' in 10 Min', {
            body: 'Das ' + prayerNames[name] + ' beginnt um ' + time + ' Uhr.',
            icon: 'icon-192.png',
            tag: 'prayer-warn-' + name,
            vibrate: [100, 50, 100],
            silent: false
          });
        }, warnMs);
        scheduledTimers.push(tw);
      }
    }
  });

  // ── Schedule event/appointment notifications ──
  events.forEach(function(ev){
    if(!ev.start || !ev.date) return;

    // Handle recurring events
    var evDate = ev.date;
    var shouldNotify = false;

    if(ev.repeat === 'none' || !ev.repeat){
      shouldNotify = (evDate === today);
    } else if(ev.repeat === 'daily'){
      shouldNotify = (evDate <= today);
    } else if(ev.repeat === 'weekly'){
      var evD   = new Date(evDate + 'T12:00');
      var todD  = new Date(today + 'T12:00');
      var diff  = Math.round((todD - evD) / 86400000);
      shouldNotify = (evDate <= today && diff >= 0 && diff % 7 === 0);
    } else if(ev.repeat === 'monthly'){
      var evDay  = parseInt(evDate.split('-')[2]);
      var todDay = parseInt(today.split('-')[2]);
      shouldNotify = (evDate <= today && evDay === todDay);
    }

    if(!shouldNotify) return;

    var parts = ev.start.split(':');
    var eMin  = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    var diffMs = (eMin - nowMin) * 60 * 1000;

    // Notify 15 minutes before
    var notifyMs = diffMs - 15 * 60 * 1000;
    if(notifyMs > 0 && notifyMs < 24 * 60 * 60 * 1000){
      var t = setTimeout(function(){
        self.registration.showNotification('📅 Termin in 15 Min: ' + ev.title, {
          body: (ev.note ? ev.note + ' — ' : '') + 'Beginnt um ' + ev.start + ' Uhr.',
          icon: 'icon-192.png',
          tag: 'event-' + ev.id,
          requireInteraction: true,
          vibrate: [300, 100, 300],
          actions: [
            { action: 'open',  title: 'Öffnen' },
            { action: 'ok',    title: 'OK' }
          ]
        });
      }, notifyMs);
      scheduledTimers.push(t);
    }

    // Notify exactly at event time
    if(diffMs > 0 && diffMs < 24 * 60 * 60 * 1000){
      var t2 = setTimeout(function(){
        self.registration.showNotification('📅 Jetzt: ' + ev.title, {
          body: 'Dein Termin hat begonnen' + (ev.note ? ': ' + ev.note : '.'),
          icon: 'icon-192.png',
          tag: 'event-now-' + ev.id,
          requireInteraction: true,
          vibrate: [400, 200, 400]
        });
      }, diffMs);
      scheduledTimers.push(t2);
    }
  });

  console.log('[SW] Scheduled', scheduledTimers.length, 'notifications');
});

// ── Notification click handler ──
self.addEventListener('notificationclick', function(e){
  e.notification.close();

  if(e.action === 'snooze'){
    // Re-show in 5 minutes
    var n = e.notification;
    setTimeout(function(){
      self.registration.showNotification(n.title, {
        body: n.body,
        icon: n.icon,
        tag: n.tag + '-snoozed',
        requireInteraction: true
      });
    }, 5 * 60 * 1000);
    return;
  }

  // Open or focus the app
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients){
      for(var i = 0; i < clients.length; i++){
        if(clients[i].url.includes('index.html') || clients[i].url.endsWith('/')){
          return clients[i].focus();
        }
      }
      return self.clients.openWindow('./');
    })
  );
});

// ── Push event (for future server-side pushes) ──
self.addEventListener('push', function(e){
  if(!e.data) return;
  var data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'Task Planner', {
      body: data.body || '',
      icon: 'icon-192.png',
      tag: data.tag || 'push',
      requireInteraction: true
    })
  );
});
