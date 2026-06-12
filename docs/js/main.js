/* ============================================
   KOVIX Landing Page — Main JS
   ============================================ */

(function () {
  'use strict';

  // ---- Mobile Navigation Toggle ----
  var toggle = document.getElementById('nav-toggle');
  var mobileMenu = document.getElementById('nav-mobile');

  if (toggle && mobileMenu) {
    toggle.addEventListener('click', function () {
      var expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      mobileMenu.hidden = expanded;
    });

    // Close mobile menu on link click
    var mobileLinks = mobileMenu.querySelectorAll('a');
    for (var i = 0; i < mobileLinks.length; i++) {
      mobileLinks[i].addEventListener('click', function () {
        toggle.setAttribute('aria-expanded', 'false');
        mobileMenu.hidden = true;
      });
    }
  }

  // ---- Scroll-triggered Lazy Reveal ----
  var lazySections = document.querySelectorAll('[data-lazy]');

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            entries[i].target.classList.add('is-visible');
            observer.unobserve(entries[i].target);
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    for (var i = 0; i < lazySections.length; i++) {
      observer.observe(lazySections[i]);
    }
  } else {
    // Fallback: show everything
    for (var i = 0; i < lazySections.length; i++) {
      lazySections[i].classList.add('is-visible');
    }
  }

  // ---- Smooth scroll for nav links ----
  var navLinks = document.querySelectorAll('.nav__links a, .nav__mobile a');
  for (var i = 0; i < navLinks.length; i++) {
    navLinks[i].addEventListener('click', function (e) {
      var href = this.getAttribute('href');
      if (href && href.charAt(0) === '#') {
        e.preventDefault();
        var target = document.querySelector(href);
        if (target) {
          var offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'), 10) || 64;
          var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
          window.scrollTo({ top: top, behavior: 'smooth' });
        }
      }
    });
  }

  // ---- Nav background on scroll ----
  var nav = document.getElementById('nav');
  var scrolled = false;

  function onScroll() {
    if (window.scrollY > 20 && !scrolled) {
      nav.style.background = 'rgba(13,17,23,0.95)';
      scrolled = true;
    } else if (window.scrollY <= 20 && scrolled) {
      nav.style.background = 'rgba(13,17,23,0.8)';
      scrolled = false;
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
