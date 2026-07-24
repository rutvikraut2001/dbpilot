'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

/**
 * Full-viewport ambient background rendered behind the whole app.
 *  - Light theme  → an underwater scene: rising bubbles + drifting light rays.
 *  - Dark theme   → a night sky: twinkling stars + the occasional shooting star.
 *
 * A CSS gradient (`.sea-bg` / `.sky-bg`) provides the base tone; a transparent
 * canvas draws only the moving particles so it stays cheap and content stays
 * readable. Honors `prefers-reduced-motion`, pauses when the tab is hidden, and
 * is devicePixelRatio-aware.
 */

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  drift: number;
  phase: number;
  alpha: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  baseAlpha: number;
  twinkleSpeed: number;
  phase: number;
}

interface Shooter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  life: number;
  maxLife: number;
}

export function AmbientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    if (!mounted) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return; // CSS gradient base is enough

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let bubbles: Bubble[] = [];
    let stars: Star[] = [];
    let shooters: Shooter[] = [];
    let rays: { x: number; w: number; sway: number; phase: number }[] = [];
    let raf = 0;
    let running = true;
    let t = 0;
    let nextShooter = 200 + Math.floor(Math.random() * 400);

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const seed = () => {
      const area = width * height;
      if (isDark) {
        const count = Math.min(180, Math.floor(area / 9000));
        stars = Array.from({ length: count }, () => ({
          x: Math.random() * width,
          y: Math.random() * height,
          r: rand(0.4, 1.6),
          baseAlpha: rand(0.25, 0.9),
          twinkleSpeed: rand(0.005, 0.02),
          phase: Math.random() * Math.PI * 2,
        }));
        bubbles = [];
        rays = [];
      } else {
        const count = Math.min(46, Math.floor(area / 38000));
        bubbles = Array.from({ length: count }, () => ({
          x: Math.random() * width,
          y: Math.random() * height,
          r: rand(2, 9),
          speed: rand(0.2, 0.8),
          drift: rand(6, 20),
          phase: Math.random() * Math.PI * 2,
          alpha: rand(0.1, 0.4),
        }));
        rays = Array.from({ length: 4 }, (_, i) => ({
          x: (width / 5) * (i + 1) + rand(-40, 40),
          w: rand(60, 140),
          sway: rand(20, 60),
          phase: Math.random() * Math.PI * 2,
        }));
        stars = [];
      }
    };

    const drawDark = () => {
      // Twinkling stars
      for (const s of stars) {
        const a = s.baseAlpha * (0.55 + 0.45 * Math.sin(s.phase + t * s.twinkleSpeed * 60));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.fill();
      }

      // Shooting stars
      if (--nextShooter <= 0 && shooters.length < 2) {
        const fromLeft = Math.random() > 0.5;
        const startX = fromLeft ? rand(0, width * 0.3) : rand(width * 0.7, width);
        shooters.push({
          x: startX,
          y: rand(0, height * 0.4),
          vx: (fromLeft ? 1 : -1) * rand(4, 7),
          vy: rand(2, 3.5),
          len: rand(80, 160),
          life: 0,
          maxLife: rand(50, 90),
        });
        nextShooter = 260 + Math.floor(Math.random() * 500);
      }
      shooters = shooters.filter((sh) => sh.life < sh.maxLife);
      for (const sh of shooters) {
        sh.life += 1;
        sh.x += sh.vx;
        sh.y += sh.vy;
        const prog = sh.life / sh.maxLife;
        const alpha = Math.sin(prog * Math.PI) * 0.8;
        const tailX = sh.x - (sh.vx / Math.hypot(sh.vx, sh.vy)) * sh.len;
        const tailY = sh.y - (sh.vy / Math.hypot(sh.vx, sh.vy)) * sh.len;
        const grad = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
        grad.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }
    };

    const drawLight = () => {
      // Soft descending light rays
      for (const ray of rays) {
        const x = ray.x + Math.sin(t * 0.005 + ray.phase) * ray.sway;
        const grad = ctx.createLinearGradient(x, 0, x + ray.w * 0.4, height);
        grad.addColorStop(0, 'rgba(255,255,255,0.16)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x - ray.w / 2, 0);
        ctx.lineTo(x + ray.w / 2, 0);
        ctx.lineTo(x + ray.w, height);
        ctx.lineTo(x - ray.w * 0.2, height);
        ctx.closePath();
        ctx.fill();
      }

      // Rising bubbles
      for (const b of bubbles) {
        b.y -= b.speed;
        const x = b.x + Math.sin(t * 0.01 + b.phase) * (b.drift * 0.15);
        if (b.y + b.r < 0) {
          b.y = height + b.r;
          b.x = Math.random() * width;
        }
        ctx.beginPath();
        ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(b.alpha * 0.5).toFixed(3)})`;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(255,255,255,${b.alpha.toFixed(3)})`;
        ctx.stroke();
      }
    };

    const frame = () => {
      if (!running) return;
      t += 1;
      ctx.clearRect(0, 0, width, height);
      if (isDark) drawDark();
      else drawLight();
      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mounted, isDark]);

  // Before mount, resolvedTheme is unknown — render a neutral gradient to avoid
  // a flash; the class updates once the theme resolves.
  return (
    <div
      aria-hidden
      className={cn('fixed inset-0 -z-10 overflow-hidden', isDark ? 'sky-bg' : 'sea-bg')}
    >
      {isDark && <div className="absolute inset-0 stars-pattern opacity-60" />}
      <canvas
        ref={canvasRef}
        className={cn('h-full w-full', isDark ? 'opacity-90' : 'opacity-70')}
      />
    </div>
  );
}
