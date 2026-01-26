'use client';

import { ArrowUp } from 'lucide-react';

const BackToTop = () => {

  const handleClick = () => {
    const candidates = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      document.querySelector('main'),
    ].filter(Boolean) as Array<HTMLElement>;

    const getWindowScrollY = () =>
      window.scrollY || document.documentElement.scrollTop || 0;

    let target: HTMLElement | 'window' = 'window';
    let maxScroll = getWindowScrollY();

    for (const el of candidates) {
      if (el.scrollTop > maxScroll) {
        maxScroll = el.scrollTop;
        target = el;
      }
    }

    const duration = 250;
    const startTime = performance.now();
    const startY = maxScroll;

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const nextY = Math.round(startY * (1 - easeOutCubic(progress)));

      if (target === 'window') {
        window.scrollTo(0, nextY);
      } else {
        target.scrollTop = nextY;
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    if (startY > 0) {
      requestAnimationFrame(step);
    }
  };

  return (
    <button
      type='button'
      aria-label='Back to top'
      onClick={handleClick}
      className='fixed right-4 bottom-6 z-[600] flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-lg ring-1 ring-black/5 backdrop-blur-xl transition-all duration-200 hover:scale-105 dark:bg-gray-900/80 dark:text-gray-100 dark:ring-white/10'
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ArrowUp className='h-5 w-5' />
    </button>
  );
};

export default BackToTop;
