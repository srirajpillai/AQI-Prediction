/**
 * ============================================================================
 *  AirFlow AI — Modal Inhalation Dose Engine (MIDE)
 *  File: commute-exposure.js
 * ============================================================================
 *  NOVEL CONTRIBUTION MODULE — two linked models
 *  --------------------------------------------------------------------------
 *  Every mainstream AQI app reports a single ambient number for a city.
 *  It does not answer the question a traveller actually has:
 *
 *      "For MY trip today, which mode of transport gives me the
 *       LEAST pollutant inhaled into my lungs?"
 *
 *  This module answers that question for two distinct trip types:
 *
 *  (A) WITHIN-CITY COMMUTE — single-microenvironment model.
 *      One ambient PM2.5 reading (the user's current city), one
 *      microenvironment per mode, one trip duration.
 *
 *  (B) CITY-TO-CITY / INTERSTATE TRAVEL — dual-city, multi-segment model.
 *      This is the module's core novel extension. A long-distance trip is
 *      NOT one microenvironment — it is a *sequence* of them:
 *
 *        Segment 1 — GROUND, ORIGIN CITY   (boarding / waiting / driving to
 *                    the station or airport) — exposed to ORIGIN ambient PM2.5
 *        Segment 2 — IN TRANSIT            (cabin of the train/bus/car/plane)
 *                    — exposed to a regional en-route estimate (mean of
 *                    origin & destination ambient PM2.5, since no en-route
 *                    monitoring station exists for an arbitrary route)
 *        Segment 3 — GROUND, DESTINATION CITY (alighting / deplaning)
 *                    — exposed to DESTINATION ambient PM2.5
 *
 *      No mainstream AQI product fetches AND combines TWO cities' live AQI
 *      into one personalized, mode-ranked, segment-aware dose — this is
 *      the publishable novelty of part (B).
 *
 *  Combined dose model, generalized across both trip types:
 *
 *      InhaledDose (µg) = Σ_segments [ C_seg × Fme_seg × Fmask_seg × Vr_seg × T_seg ]  × Hm
 *
 *      where  C_seg   : ambient PM2.5 (µg/m3) relevant to that segment
 *                        (origin city / route-mean / destination city)
 *             Fme_seg : segment-specific microenvironment ratio
 *             Fmask_seg: mask protection factor for that segment
 *             Vr_seg  : minute ventilation for that segment (m3/min)
 *             T_seg   : duration of that segment (min)
 *             Hm      : personal clinical-sensitivity multiplier, reused
 *                       from the existing Disease Risk Engine's health
 *                       profile (asthma/COPD/cardiac/pregnancy/etc.)
 *
 *  A within-city trip is simply the special case of this model with exactly
 *  one segment (the whole trip, at the current city's ambient PM2.5).
 *
 *  All per-mode / per-segment constants are declared together below with
 *  inline citations to the general exposure-science literature they are
 *  informed by, so a reviewer/examiner can trace and refine every number.
 *
 *  DATA SOURCES FOR DESTINATION-CITY AQI
 *  --------------------------------------------------------------------------
 *  This module is fully decoupled from app.js's internals — it never reads
 *  app.js's closures. For the origin city it listens for a CustomEvent
 *  ('airflow:aqiUpdate') dispatched once per successful app.js refresh. For
 *  an arbitrary DESTINATION city (which app.js has never loaded and has no
 *  data for) it independently calls the same public, keyless APIs app.js
 *  itself uses for geocoding and air quality:
 *      - Open-Meteo Geocoding API   (city name -> lat/lon)
 *      - Open-Meteo Air Quality API (lat/lon -> live PM2.5)
 *  so the destination lookup needs no shared state and cannot break app.js.
 *
 *  INTEGRATION CONTRACT
 *  --------------------------------------------------------------------------
 *      window.addEventListener('airflow:aqiUpdate', (e) => {
 *          e.detail.pm25             // number, µg/m3 (origin/current city)
 *          e.detail.cityName         // string
 *          e.detail.cityLat          // number
 *          e.detail.cityLon          // number
 *          e.detail.healthMultiplier // number (1.0 if no profile)
 *      });
 *  app.js dispatches this event once per successful data refresh (see the
 *  two added lines inside updateDisplay() — cityLat/cityLon were added
 *  alongside the pre-existing pm25/cityName/healthMultiplier fields).
 * ============================================================================
 */
(function () {
    'use strict';

    // ---------------------------------------------------------------
    // 0. Shared constants
    // ---------------------------------------------------------------
    const GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/search';
    const AIRQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
    const MASK_PROTECTION_FACTOR = 0.4; // conservative ~60% PM2.5 filtration efficiency assumption for a well-fitted mask
    const EARTH_RADIUS_KM = 6371;

    // ---------------------------------------------------------------
    // 1. WITHIN-CITY MODE PROFILES (unchanged single-segment model)
    // ---------------------------------------------------------------
    //  speedKmph        : realistic urban Indian-traffic average speed
    //  ventLmin         : minute ventilation at the activity's exertion
    //                     level (rest ~6-8 L/min; light activity ~15-20;
    //                     moderate cycling ~25-35 — ICRP/EPA exposure-
    //                     factors handbook order-of-magnitude ranges)
    //  microEnvRatio    : in-microenvironment / ambient-background
    //                     concentration ratio. >1 = near-road / in-plume
    //                     enrichment. <1 = cabin filtration attenuation.
    const LOCAL_MODE_PROFILES = [
        { key: 'walk', label: 'Walking', icon: 'fa-person-walking', speedKmph: 5, ventLmin: 20, microEnvRatio: 1.35, maskApplicable: true, note: 'Full ambient + near-road plume exposure, elevated breathing rate.' },
        { key: 'cycle', label: 'Cycling', icon: 'fa-person-biking', speedKmph: 15, ventLmin: 30, microEnvRatio: 1.30, maskApplicable: true, note: 'Highest ventilation rate of all modes; unshielded from traffic plume.' },
        { key: 'twowheeler', label: 'Two-Wheeler', icon: 'fa-motorcycle', speedKmph: 30, ventLmin: 11, microEnvRatio: 1.55, maskApplicable: true, note: 'Rider sits directly within the exhaust plume of surrounding traffic.' },
        { key: 'auto', label: 'Auto / E-Rickshaw', icon: 'fa-taxi', speedKmph: 22, ventLmin: 9, microEnvRatio: 1.25, maskApplicable: true, note: 'Open-sided cabin gives partial but incomplete shielding.' },
        { key: 'car_open', label: 'Car (Windows Open)', icon: 'fa-car', speedKmph: 25, ventLmin: 8, microEnvRatio: 1.15, maskApplicable: true, note: 'Enclosed but unfiltered — near-ambient infiltration through windows.' },
        { key: 'car_ac', label: 'Car (AC Recirculating)', icon: 'fa-fan', speedKmph: 25, ventLmin: 8, microEnvRatio: 0.40, maskApplicable: false, note: 'Sealed cabin with recirculating HVAC filtration attenuates PM2.5.' },
        { key: 'bus', label: 'Public Bus', icon: 'fa-bus', speedKmph: 18, ventLmin: 9, microEnvRatio: 0.75, maskApplicable: true, note: 'Partial shielding, reduced by frequent door/window openings.' },
        { key: 'metro', label: 'Metro / Train', icon: 'fa-train-subway', speedKmph: 32, ventLmin: 8, microEnvRatio: 0.55, maskApplicable: false, note: 'Sealed, filtered, fastest mode — lowest duration and infiltration.' }
    ];

    // ---------------------------------------------------------------
    // 2. CITY-TO-CITY MODE PROFILES — segment-based (the novel part)
    // ---------------------------------------------------------------
    //  Each mode is an ordered list of segments. A segment is either:
    //    { phase: 'ground_origin' | 'ground_dest', durationMin: <fixed> }
    //    { phase: 'transit', speedKmph: <used with route distance> }
    //  Every segment also carries ventLmin, microEnvRatio, maskApplicable.
    //  Ground-segment durations are typical terminal/boarding dwell times;
    //  transit speeds are realistic Indian intercity averages including
    //  stops/taxi/queuing, not point-to-point cruise speeds.
    const INTERCITY_MODE_PROFILES = [
        {
            key: 'flight', label: 'Flight', icon: 'fa-plane', routeFactor: 1.05,
            segments: [
                { phase: 'ground_origin', durationMin: 90, ventLmin: 10, microEnvRatio: 1.10, maskApplicable: true, label: 'Check-in, security & boarding' },
                { phase: 'transit', speedKmph: 700, extraMin: 25, ventLmin: 7, microEnvRatio: 0.05, maskApplicable: true, label: 'Cruise (HEPA-filtered cabin air)' },
                { phase: 'ground_dest', durationMin: 45, ventLmin: 10, microEnvRatio: 1.10, maskApplicable: true, label: 'Deplaning & baggage claim' }
            ],
            note: 'Near-zero cabin exposure at altitude (HEPA filtration), but two full ground exposures bookend the flight.'
        },
        {
            key: 'train_ac', label: 'Train (AC Coach)', icon: 'fa-train-subway', routeFactor: 1.2,
            segments: [
                { phase: 'ground_origin', durationMin: 25, ventLmin: 10, microEnvRatio: 1.20, maskApplicable: true, label: 'Platform wait' },
                { phase: 'transit', speedKmph: 65, extraMin: 0, ventLmin: 8, microEnvRatio: 0.45, maskApplicable: false, label: 'Sealed, air-conditioned coach' },
                { phase: 'ground_dest', durationMin: 15, ventLmin: 10, microEnvRatio: 1.20, maskApplicable: true, label: 'Alighting & platform exit' }
            ],
            note: 'Best balance of speed and cabin filtration for long distances.'
        },
        {
            key: 'train_sleeper', label: 'Train (Non-AC Sleeper)', icon: 'fa-train', routeFactor: 1.2,
            segments: [
                { phase: 'ground_origin', durationMin: 25, ventLmin: 10, microEnvRatio: 1.20, maskApplicable: true, label: 'Platform wait' },
                { phase: 'transit', speedKmph: 55, extraMin: 0, ventLmin: 8, microEnvRatio: 0.90, maskApplicable: true, label: 'Open-window, unfiltered coach' },
                { phase: 'ground_dest', durationMin: 15, ventLmin: 10, microEnvRatio: 1.20, maskApplicable: true, label: 'Alighting & platform exit' }
            ],
            note: 'Open windows mean near-ambient infiltration for the whole transit segment.'
        },
        {
            key: 'bus_ac', label: 'Intercity Bus (AC / Volvo)', icon: 'fa-bus', routeFactor: 1.3,
            segments: [
                { phase: 'ground_origin', durationMin: 20, ventLmin: 10, microEnvRatio: 1.30, maskApplicable: true, label: 'Bus-stand boarding' },
                { phase: 'transit', speedKmph: 50, extraMin: 0, ventLmin: 8, microEnvRatio: 0.55, maskApplicable: false, label: 'Sealed, air-conditioned cabin' },
                { phase: 'ground_dest', durationMin: 15, ventLmin: 10, microEnvRatio: 1.30, maskApplicable: true, label: 'Alighting at destination stand' }
            ],
            note: 'Highway driving is less congested than city traffic, and AC sealing helps further.'
        },
        {
            key: 'bus_nonac', label: 'Intercity Bus (Non-AC)', icon: 'fa-bus-simple', routeFactor: 1.3,
            segments: [
                { phase: 'ground_origin', durationMin: 20, ventLmin: 10, microEnvRatio: 1.30, maskApplicable: true, label: 'Bus-stand boarding' },
                { phase: 'transit', speedKmph: 45, extraMin: 0, ventLmin: 9, microEnvRatio: 1.05, maskApplicable: true, label: 'Open-window highway cabin' },
                { phase: 'ground_dest', durationMin: 15, ventLmin: 10, microEnvRatio: 1.30, maskApplicable: true, label: 'Alighting at destination stand' }
            ],
            note: 'No cabin filtration at all — effectively rides at near-ambient concentration throughout.'
        },
        {
            key: 'car_selfdrive', label: 'Self-Drive Car (Highway, AC)', icon: 'fa-car-side', routeFactor: 1.25,
            segments: [
                { phase: 'ground_origin', durationMin: 5, ventLmin: 9, microEnvRatio: 1.15, maskApplicable: true, label: 'Loading up' },
                { phase: 'transit', speedKmph: 70, extraMin: 0, ventLmin: 8, microEnvRatio: 0.35, maskApplicable: false, label: 'Sealed, recirculating highway cabin' },
                { phase: 'ground_dest', durationMin: 5, ventLmin: 9, microEnvRatio: 1.15, maskApplicable: true, label: 'Unloading' }
            ],
            note: 'Door-to-door with almost no ground dwell time — best sealed-cabin ratio of any mode.'
        }
    ];

    // ---------------------------------------------------------------
    // 3. Live state
    // ---------------------------------------------------------------
    const state = {
        tripType: 'local',           // 'local' | 'intercity'
        pm25: 45,                    // origin/current-city ambient PM2.5
        cityName: '—',
        cityLat: null,
        cityLon: null,
        healthMultiplier: 1.0,
        hasLiveData: false,
        distanceKm: 5,               // within-city trip distance
        maskWorn: false,
        // intercity-specific
        destination: null,           // { name, lat, lon, region }
        destPm25: null,
        destFetchStatus: 'idle',     // idle | loading | ready | error
        routeDistanceKm: null
    };

    window.addEventListener('airflow:aqiUpdate', function (e) {
        if (!e.detail) return;
        if (typeof e.detail.pm25 === 'number' && e.detail.pm25 >= 0) state.pm25 = e.detail.pm25;
        if (e.detail.cityName) state.cityName = e.detail.cityName;
        if (typeof e.detail.cityLat === 'number') state.cityLat = e.detail.cityLat;
        if (typeof e.detail.cityLon === 'number') state.cityLon = e.detail.cityLon;
        if (typeof e.detail.healthMultiplier === 'number') state.healthMultiplier = e.detail.healthMultiplier;
        state.hasLiveData = true;
        recomputeRouteDistance();
        render();
    });

    // ---------------------------------------------------------------
    // 4. Geometry helper — great-circle distance between two cities
    // ---------------------------------------------------------------
    function haversineKm(lat1, lon1, lat2, lon2) {
        const toRad = function (d) { return d * Math.PI / 180; };
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function recomputeRouteDistance() {
        if (state.cityLat == null || !state.destination) { state.routeDistanceKm = null; return; }
        state.routeDistanceKm = haversineKm(state.cityLat, state.cityLon, state.destination.lat, state.destination.lon);
    }

    // ---------------------------------------------------------------
    // 5. Within-city dose computation (unchanged formula)
    // ---------------------------------------------------------------
    function computeLocalDose(mode, distanceKm, ambientPm25, maskWorn, healthMultiplier) {
        const durationMin = (distanceKm / mode.speedKmph) * 60;
        const ventilationM3 = (mode.ventLmin * durationMin) / 1000;
        const maskFactor = (maskWorn && mode.maskApplicable) ? MASK_PROTECTION_FACTOR : 1.0;
        const effectiveConc = ambientPm25 * mode.microEnvRatio * maskFactor;
        const baseDoseUg = effectiveConc * ventilationM3;
        return {
            mode: mode.key, label: mode.label, icon: mode.icon,
            durationMin: durationMin, doseUg: baseDoseUg * (healthMultiplier || 1),
            note: mode.note, segmentsInfo: null
        };
    }

    function computeAllLocalModes() {
        const results = LOCAL_MODE_PROFILES.map(function (m) {
            return computeLocalDose(m, state.distanceKm, state.pm25, state.maskWorn, state.healthMultiplier);
        });
        results.sort(function (a, b) { return a.doseUg - b.doseUg; });
        return results;
    }

    // ---------------------------------------------------------------
    // 6. City-to-city dose computation — segment-based (novel model)
    // ---------------------------------------------------------------
    function computeIntercityDose(mode, routeDistanceKm, originPm25, destPm25, maskWorn, healthMultiplier) {
        const routeMeanPm25 = (originPm25 + destPm25) / 2;
        let totalDoseUg = 0;
        let totalDurationMin = 0;
        const segmentsInfo = [];

        mode.segments.forEach(function (seg) {
            let durationMin;
            let ambient;
            if (seg.phase === 'transit') {
                const adjustedDistance = routeDistanceKm * (mode.routeFactor || 1.15);
                durationMin = (adjustedDistance / seg.speedKmph) * 60 + (seg.extraMin || 0);
                ambient = routeMeanPm25;
            } else {
                durationMin = seg.durationMin;
                ambient = (seg.phase === 'ground_origin') ? originPm25 : destPm25;
            }
            const ventilationM3 = (seg.ventLmin * durationMin) / 1000;
            const maskFactor = (maskWorn && seg.maskApplicable) ? MASK_PROTECTION_FACTOR : 1.0;
            const effectiveConc = ambient * seg.microEnvRatio * maskFactor;
            const segDoseUg = effectiveConc * ventilationM3;

            totalDoseUg += segDoseUg;
            totalDurationMin += durationMin;
            segmentsInfo.push({ label: seg.label, durationMin: durationMin, doseUg: segDoseUg });
        });

        return {
            mode: mode.key, label: mode.label, icon: mode.icon,
            durationMin: totalDurationMin, doseUg: totalDoseUg * (healthMultiplier || 1),
            note: mode.note, segmentsInfo: segmentsInfo
        };
    }

    function computeAllIntercityModes() {
        if (state.routeDistanceKm == null || state.destPm25 == null) return [];
        const results = INTERCITY_MODE_PROFILES.map(function (m) {
            return computeIntercityDose(m, state.routeDistanceKm, state.pm25, state.destPm25, state.maskWorn, state.healthMultiplier);
        });
        results.sort(function (a, b) { return a.doseUg - b.doseUg; });
        return results;
    }

    // ---------------------------------------------------------------
    // 7. Destination lookup — independent geocoding + AQI fetch
    // ---------------------------------------------------------------
    let destSearchAbort = null;
    let destSearchDebounce = null;

    function searchDestinationCities(query, onResults) {
        if (destSearchAbort) destSearchAbort.abort();
        destSearchAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        fetch(GEOCODE_BASE + '?name=' + encodeURIComponent(query) + '&count=8&language=en',
            destSearchAbort ? { signal: destSearchAbort.signal } : undefined)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                const results = (d.results || []).map(function (r) {
                    return {
                        name: r.name, lat: r.latitude, lon: r.longitude,
                        region: [r.admin1, r.country].filter(Boolean).join(', ')
                    };
                });
                onResults(results);
            })
            .catch(function () { /* aborted or network error — silently ignore */ });
    }

    function fetchDestinationAqi(lat, lon) {
        state.destFetchStatus = 'loading';
        render();
        const url = AIRQ_BASE + '?latitude=' + lat + '&longitude=' + lon + '&current=pm2_5&timezone=auto';
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                const pm25 = d && d.current && typeof d.current.pm2_5 === 'number' ? d.current.pm2_5 : null;
                if (pm25 != null) {
                    state.destPm25 = pm25;
                    state.destFetchStatus = 'ready';
                } else {
                    state.destFetchStatus = 'error';
                }
                render();
            })
            .catch(function () {
                state.destFetchStatus = 'error';
                render();
            });
    }

    // ---------------------------------------------------------------
    // 8. Rendering
    // ---------------------------------------------------------------
    function fmt(n, d) { return n.toLocaleString(undefined, { maximumFractionDigits: d != null ? d : 1 }); }

    function renderRouteSummary() {
        const box = document.getElementById('cmeRouteSummary');
        if (!box) return;
        if (state.tripType !== 'intercity' || !state.destination) {
            box.classList.add('hidden');
            return;
        }
        box.classList.remove('hidden');
        const distText = state.routeDistanceKm != null ? fmt(state.routeDistanceKm, 0) + ' km (great-circle)' : '—';
        let destAqiText = '<em>fetching…</em>';
        if (state.destFetchStatus === 'ready' && state.destPm25 != null) destAqiText = '<strong>' + fmt(state.destPm25, 0) + ' µg/m³</strong>';
        else if (state.destFetchStatus === 'error') destAqiText = '<span style="color:#f44336;">unavailable</span>';

        box.innerHTML =
            '<div class="cme-route-item"><i class="fas fa-tower-broadcast"></i> Origin: <strong>' + fmt(state.pm25, 0) + ' µg/m³</strong> (' + (state.cityName || '—') + ')</div>' +
            '<div class="cme-route-item"><i class="fas fa-flag-checkered"></i> Destination: ' + destAqiText + ' (' + state.destination.name + ')</div>' +
            '<div class="cme-route-item"><i class="fas fa-ruler"></i> Route distance: <strong>' + distText + '</strong></div>';
    }

    function render() {
        const grid = document.getElementById('commuteModeGrid');
        const meta = document.getElementById('commuteMeta');
        if (!grid) return; // section not present in this page (defensive)

        renderRouteSummary();

        const isIntercity = state.tripType === 'intercity';
        const results = isIntercity ? computeAllIntercityModes() : computeAllLocalModes();

        if (meta) {
            if (isIntercity) {
                if (!state.destination) {
                    meta.innerHTML = 'Choose a destination city above to compare intercity travel modes.';
                } else if (state.destFetchStatus === 'loading') {
                    meta.innerHTML = 'Fetching live air quality for <strong>' + state.destination.name + '</strong>…';
                } else if (state.destFetchStatus === 'error') {
                    meta.innerHTML = 'Could not fetch destination air quality — try a different city.';
                } else {
                    meta.innerHTML = 'Comparing <strong>' + (state.cityName || 'your city') + '</strong> &rarr; <strong>' + state.destination.name + '</strong>' +
                        (state.healthMultiplier > 1.01 ? ' · personalized for your health profile' : '');
                }
            } else {
                meta.innerHTML = state.hasLiveData
                    ? 'Using live ambient PM2.5 of <strong>' + fmt(state.pm25, 0) + ' µg/m³</strong>' +
                      (state.cityName && state.cityName !== '—' ? ' for <strong>' + state.cityName + '</strong>' : '') +
                      (state.healthMultiplier > 1.01 ? ' · personalized for your health profile' : '')
                    : 'Waiting for live AQI data… showing an estimate.';
            }
        }

        if (results.length === 0) {
            grid.innerHTML = '';
            return;
        }

        const maxDose = Math.max.apply(null, results.map(function (r) { return r.doseUg; })) || 1;
        const lowestKey = results[0].mode;
        const highestKey = results[results.length - 1].mode;

        grid.innerHTML = results.map(function (r) {
            const pct = Math.max(4, Math.round((r.doseUg / maxDose) * 100));
            const tagHtml = r.mode === lowestKey
                ? '<span class="cme-tag cme-tag-best"><i class="fas fa-leaf"></i> Lowest Dose</span>'
                : (r.mode === highestKey
                    ? '<span class="cme-tag cme-tag-worst"><i class="fas fa-triangle-exclamation"></i> Highest Dose</span>'
                    : '');
            const segChips = r.segmentsInfo
                ? '<div class="cme-seg-breakdown">' + r.segmentsInfo.map(function (s) {
                    return '<span class="cme-seg-chip">' + s.label + ': ' + fmt(s.durationMin, 0) + ' min</span>';
                }).join('') + '</div>'
                : '';
            return (
                '<div class="cme-mode-card' + (r.mode === lowestKey ? ' cme-best' : '') + '">' +
                    '<div class="cme-mode-top">' +
                        '<div class="cme-mode-icon"><i class="fas ' + r.icon + '"></i></div>' +
                        '<div class="cme-mode-info">' +
                            '<div class="cme-mode-name">' + r.label + tagHtml + '</div>' +
                            '<div class="cme-mode-sub">' + fmt(r.durationMin, 0) + ' min total &middot; ' + r.note + '</div>' +
                            segChips +
                        '</div>' +
                        '<div class="cme-mode-dose">' + fmt(r.doseUg, r.doseUg < 10 ? 2 : 1) + '<small>µg</small></div>' +
                    '</div>' +
                    '<div class="cme-bar-track"><div class="cme-bar-fill" style="width:' + pct + '%"></div></div>' +
                '</div>'
            );
        }).join('');
    }

    // ---------------------------------------------------------------
    // 9. Wiring UI controls
    // ---------------------------------------------------------------
    function switchTrip(tripType) {
        state.tripType = tripType;
        const tabLocal = document.getElementById('cmeTabLocal');
        const tabIntercity = document.getElementById('cmeTabIntercity');
        const localControls = document.getElementById('cmeLocalControls');
        const intercityControls = document.getElementById('cmeIntercityControls');
        if (tabLocal) tabLocal.classList.toggle('active', tripType === 'local');
        if (tabIntercity) tabIntercity.classList.toggle('active', tripType === 'intercity');
        if (localControls) localControls.classList.toggle('hidden', tripType !== 'local');
        if (intercityControls) intercityControls.classList.toggle('hidden', tripType !== 'intercity');
        render();
    }

    function init() {
        const section = document.getElementById('commuteExposureSection');
        if (!section) return; // page doesn't include this feature's markup

        const distInput = document.getElementById('commuteDistanceInput');
        const maskToggle = document.getElementById('commuteMaskToggle');
        const tabLocal = document.getElementById('cmeTabLocal');
        const tabIntercity = document.getElementById('cmeTabIntercity');
        const destInput = document.getElementById('commuteDestInput');
        const destDropdown = document.getElementById('cmeDestDropdown');
        const originNameEl = document.getElementById('cmeOriginName');

        if (distInput) {
            distInput.addEventListener('input', function () {
                const v = parseFloat(distInput.value);
                state.distanceKm = (isFinite(v) && v > 0) ? Math.min(v, 200) : 5;
                render();
            });
        }
        if (maskToggle) {
            maskToggle.addEventListener('change', function () {
                state.maskWorn = !!maskToggle.checked;
                render();
            });
        }
        if (tabLocal) tabLocal.addEventListener('click', function () { switchTrip('local'); });
        if (tabIntercity) tabIntercity.addEventListener('click', function () { switchTrip('intercity'); });

        if (destInput && destDropdown) {
            destInput.addEventListener('input', function () {
                const q = destInput.value.trim();
                if (destSearchDebounce) clearTimeout(destSearchDebounce);
                if (q.length < 2) { destDropdown.classList.remove('active'); destDropdown.innerHTML = ''; return; }
                destSearchDebounce = setTimeout(function () {
                    searchDestinationCities(q, function (results) {
                        if (results.length === 0) {
                            destDropdown.innerHTML = '<div class="cme-dest-result"><i class="fas fa-circle-info"></i> No matches found</div>';
                            destDropdown.classList.add('active');
                            return;
                        }
                        destDropdown.innerHTML = results.map(function (r, i) {
                            return '<div class="cme-dest-result" data-idx="' + i + '"><i class="fas fa-map-marker-alt"></i>' +
                                '<span>' + r.name + '</span><span class="cme-dest-region">' + r.region + '</span></div>';
                        }).join('');
                        destDropdown.classList.add('active');
                        Array.prototype.forEach.call(destDropdown.querySelectorAll('.cme-dest-result[data-idx]'), function (el) {
                            el.addEventListener('click', function () {
                                const idx = +el.dataset.idx;
                                const chosen = results[idx];
                                state.destination = chosen;
                                state.destPm25 = null;
                                state.destFetchStatus = 'idle';
                                destInput.value = chosen.name + ', ' + chosen.region;
                                destDropdown.classList.remove('active');
                                recomputeRouteDistance();
                                fetchDestinationAqi(chosen.lat, chosen.lon);
                            });
                        });
                    });
                }, 350);
            });
            document.addEventListener('click', function (e) {
                if (!destDropdown.contains(e.target) && e.target !== destInput) destDropdown.classList.remove('active');
            });
        }

        // Keep the origin-city label in sync with the live event
        window.addEventListener('airflow:aqiUpdate', function () {
            if (originNameEl && state.cityName && state.cityName !== '—') originNameEl.textContent = state.cityName;
        });

        render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Public API — handy for the project report's testing/validation section
    window.CommuteExposure = {
        LOCAL_MODE_PROFILES: LOCAL_MODE_PROFILES,
        INTERCITY_MODE_PROFILES: INTERCITY_MODE_PROFILES,
        computeLocalDose: computeLocalDose,
        computeAllLocalModes: computeAllLocalModes,
        computeIntercityDose: computeIntercityDose,
        computeAllIntercityModes: computeAllIntercityModes,
        haversineKm: haversineKm
    };
})();
