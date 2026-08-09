// ===== AirFlow AI — About Page JS =====
// Theme, Particles, Scroll Animations, 3D Tilt

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

    // ===== Scroll Reveal =====
    function initScrollFX() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) entry.target.classList.add('visible');
            });
        }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
        document.querySelectorAll('.section-block').forEach(el => observer.observe(el));
    }

    // ===== 3D tilt on mouse =====
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

        setTimeout(init3DTilt, 800);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
