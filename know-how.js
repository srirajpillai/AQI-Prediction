// ===== AirFlow AI — Know How It Works Page JS =====
// SHAP Chart, Health Impact Tabs, Theme Toggle

(function () {
    'use strict';

    const $ = id => document.getElementById(id);

    // ===== Theme =====
    function initTheme() {
        const saved = localStorage.getItem('airflowTheme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
    }
    function toggleTheme() {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('airflowTheme', next);
        drawSHAPChart();
    }

    // ===== Particles =====
    function createParticles() {
        const c = $('bgParticles');
        if (!c) return;
        for (let i = 0; i < 10; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.left = Math.random()*100+'%';
            p.style.animationDuration = (Math.random()*18+12)+'s';
            p.style.animationDelay = Math.random()*10+'s';
            const s = Math.random()*2+1;
            p.style.width = s+'px'; p.style.height = s+'px';
            c.appendChild(p);
        }
    }

    // ===== SHAP Chart =====
    function drawSHAPChart() {
        const canvas = $('shapChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = 400 * dpr;
        ctx.scale(dpr, dpr);
        const W = canvas.offsetWidth, H = 400;
        ctx.clearRect(0, 0, W, H);

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const tc = isDark ? '#9898aa' : '#4a4a5e';
        const gc = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
        const ac = getComputedStyle(document.documentElement).getPropertyValue('--aqi-accent').trim() || '#00e676';

        // Representative SHAP values demonstrating factor contributions
        const factors = [
            { n: 'PM2.5 Concentration', v: 48.5 },
            { n: 'Vehicle Emissions', v: 28.7 },
            { n: 'Industrial Activity', v: 22.3 },
            { n: 'Temperature', v: 18.2 },
            { n: 'PM10 Concentration', v: 15.8 },
            { n: 'Humidity', v: 12.4 },
            { n: 'Ozone (O₃)', v: 10.1 },
            { n: 'NO₂ (Traffic)', v: 8.6 },
            { n: 'Wind Speed', v: -22.5 },
            { n: 'Rainfall', v: -15.3 },
            { n: 'Green Cover', v: -9.8 },
            { n: 'Pressure', v: -5.2 }
        ];
        factors.sort((a,b) => Math.abs(b.v) - Math.abs(a.v));

        const m = { t: 38, r: 55, b: 35, l: 160 };
        const cW = W - m.l - m.r, cH = H - m.t - m.b;
        const barH = Math.min(24, cH / factors.length - 5);
        const maxV = Math.max(...factors.map(f => Math.abs(f.v)));

        ctx.fillStyle = tc; ctx.font = '600 13px Inter'; ctx.textAlign = 'left';
        ctx.fillText('SHAP Feature Importance — What Drives AQI', m.l, 18);

        // Grid
        ctx.strokeStyle = gc; ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const x = m.l + cW/2 + (i - 2.5)/2.5 * (cW/2);
            ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, H - m.b); ctx.stroke();
        }

        // Zero line
        const zX = m.l + cW/2;
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(zX, m.t); ctx.lineTo(zX, H - m.b); ctx.stroke();

        factors.forEach((f, i) => {
            const y = m.t + i * (cH / factors.length) + (cH / factors.length - barH) / 2;
            const bW = (Math.abs(f.v) / maxV) * (cW/2 - 15);
            const pos = f.v >= 0;
            ctx.fillStyle = pos ? ac : '#4fc3f7'; ctx.globalAlpha = 0.8;
            rRect(ctx, pos ? zX + 2 : zX - bW - 2, y, bW, barH, 4);
            ctx.globalAlpha = 1;
            ctx.fillStyle = tc; ctx.font = '500 10px Inter';
            ctx.textAlign = pos ? 'left' : 'right';
            ctx.fillText((f.v >= 0 ? '+' : '') + f.v.toFixed(1), pos ? zX + bW + 6 : zX - bW - 6, y + barH/2 + 4);
            ctx.textAlign = 'right'; ctx.font = '500 11px Inter';
            ctx.fillText(f.n, m.l - 6, y + barH/2 + 4);
        });

        ctx.fillStyle = tc; ctx.font = '400 10px Inter'; ctx.textAlign = 'center';
        ctx.fillText('← Decreases AQI', m.l + cW/4, H - 8);
        ctx.fillText('Increases AQI →', m.l + 3*cW/4, H - 8);

        // Explanation
        const expEl = $('shapExplanationText');
        if (expEl) {
            expEl.textContent = `Top contributor: ${factors[0].n} (+${factors[0].v.toFixed(1)}). Wind Speed (${factors.find(f=>f.n==='Wind Speed').v.toFixed(1)}) helps reduce AQI by dispersing pollutants.`;
        }
    }

    function rRect(ctx,x,y,w,h,r) {
        ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
        ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);
        ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();ctx.fill();
    }

    // ===== Health AQI Tabs =====
    const HEALTH_DATA = {
        good: { general:'Air quality ideal for outdoor activities. No health impacts expected.', children:'Safe for outdoor play and sports activities.', elderly:'Safe for all outdoor activities. Enjoy fresh air.', respiratory:'Safe outdoors. Keep medications as precaution.', cardiac:'Minimal cardiovascular risk. Normal activities.', pregnant:'No precautions needed. Outdoor walks encouraged.' },
        moderate: { general:'Most people OK outdoors. Some may notice mild irritation.', children:'Watch for extended exertion during play.', elderly:'Mild discomfort possible during extended outdoor time.', respiratory:'Consider carrying rescue inhaler outdoors.', cardiac:'Low risk, monitor for chest discomfort during exercise.', pregnant:'Avoid heavy traffic areas. Light walking fine.' },
        usg: { general:'Reduce prolonged outdoor exertion. Sensitive groups at risk.', children:'Limit prolonged outdoor play. Take indoor breaks.', elderly:'Reduce outdoors during peak pollution hours (7-10 AM, 5-8 PM).', respiratory:'Use preventive inhaler before going outside. Reduce outdoor time.', cardiac:'Limit strenuous activity. Watch for cardiac symptoms.', pregnant:'Wear N95 mask outdoors. Limit outdoor time to 30 minutes.' },
        unhealthy: { general:'Limit outdoor activities. Use N95 masks when outside.', children:'Keep indoors. No outdoor sports or playground time.', elderly:'Stay indoors with air purification running.', respiratory:'CRITICAL: Stay indoors. Keep emergency meds ready.', cardiac:'HIGH RISK: Stay indoors. Monitor BP and heart rate.', pregnant:'STAY INDOORS. Use air purifier. Keep windows sealed.' },
        'very-bad': { general:'AVOID all outdoor activity. Seal windows and doors.', children:'DO NOT allow outdoors. Run HEPA air purifier.', elderly:'REMAIN INDOORS. Medical monitoring advised.', respiratory:'EMERGENCY: Maximum medication protocol. Consider hospital.', cardiac:'CRITICAL: Continuous BP and ECG monitoring recommended.', pregnant:'EMERGENCY: Stay in HEPA-filtered room. Medical consultation.' },
        hazardous: { general:'HEALTH EMERGENCY: Do not go outside for any reason.', children:'EMERGENCY: Consider temporary relocation to cleaner area.', elderly:'CRITICAL: Monitored indoor environment mandatory.', respiratory:'LIFE-THREATENING: Hospital admission may be needed.', cardiac:'LIFE-THREATENING: Emergency hospitalization may be required.', pregnant:'EXTREME: Consider medical facility admission for monitoring.' }
    };

    function initHealthTabs() {
        const tabs = document.querySelectorAll('.aqi-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const level = tab.dataset.level;
                const data = HEALTH_DATA[level];
                if (data) {
                    if ($('healthGeneral')) $('healthGeneral').textContent = data.general;
                    if ($('healthChildren')) $('healthChildren').textContent = data.children;
                    if ($('healthElderly')) $('healthElderly').textContent = data.elderly;
                    if ($('healthRespiratory')) $('healthRespiratory').textContent = data.respiratory;
                    if ($('healthCardiac')) $('healthCardiac').textContent = data.cardiac;
                    if ($('healthPregnant')) $('healthPregnant').textContent = data.pregnant;
                }
            });
        });
    }

    // ===== Scroll Reveal =====
    function initScrollFX() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) entry.target.classList.add('visible');
            });
        }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
        document.querySelectorAll('.section-block').forEach(el => observer.observe(el));
    }

    // ===== 3D tilt =====
    function init3DTilt() {
        document.querySelectorAll('.hover-3d').forEach(card => {
            card.addEventListener('mousemove', e => {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width - 0.5;
                const y = (e.clientY - rect.top) / rect.height - 0.5;
                card.style.transform = `translateY(-8px) rotateX(${-y*6}deg) rotateY(${x*6}deg) scale(1.01)`;
            });
            card.addEventListener('mouseleave', () => { card.style.transform = ''; });
        });
    }

    // ===== Resize =====
    function initResize() {
        let t;
        window.addEventListener('resize', () => {
            clearTimeout(t); t = setTimeout(drawSHAPChart, 250);
        });
    }

    // ===== Mouse Glow =====
    function initMouseGlow() {
        const mg = $('mouseGlow');
        if (mg) {
            document.addEventListener('mousemove', e => {
                mg.style.transform = `translate(calc(${e.clientX}px - 50%), calc(${e.clientY}px - 50%))`;
            });
        }
    }

    // ===== Init =====
    function init() {
        initTheme();
        createParticles();
        initScrollFX();
        initHealthTabs();
        initResize();
        initMouseGlow();

        const toggle = $('themeToggle');
        if (toggle) toggle.addEventListener('click', toggleTheme);

        // Hamburger menu toggle for mobile
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const navLinksEl = document.getElementById('navLinks');
        if (hamburgerBtn && navLinksEl) {
            hamburgerBtn.addEventListener('click', () => {
                navLinksEl.classList.toggle('mobile-open');
                const icon = hamburgerBtn.querySelector('i');
                if (icon) icon.className = navLinksEl.classList.contains('mobile-open') ? 'fas fa-times' : 'fas fa-bars';
            });
        }

        drawSHAPChart();
        setTimeout(init3DTilt, 800);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
