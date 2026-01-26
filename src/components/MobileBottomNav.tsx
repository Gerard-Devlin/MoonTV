/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Film, HeartPulse, Home, PartyPopper, Search, Tv } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface MobileBottomNavProps {
  /**
   * Active path override. When omitted, it falls back to usePathname().
   */
  activePath?: string;
  isOpen: boolean;
  onClose: () => void;
}

const MobileBottomNav = ({
  activePath,
  isOpen,
  onClose,
}: MobileBottomNavProps) => {
  const pathname = usePathname();

  const currentActive = activePath ?? pathname;

  const [navItems, setNavItems] = useState([
    { icon: Home, label: '\u9996\u9875', href: '/' },
    { icon: Search, label: '\u641c\u7d22', href: '/search' },
    { icon: Film, label: '\u7535\u5f71', href: '/douban?type=movie' },
    { icon: Tv, label: '\u5267\u96c6', href: '/douban?type=tv' },
    { icon: HeartPulse, label: '\u7efc\u827a', href: '/douban?type=show' },
  ]);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setNavItems((prevItems) => [
        ...prevItems,
        {
          icon: PartyPopper,
          label: '\u81ea\u5b9a\u4e49',
          href: '/douban?type=custom',
        },
      ]);
    }
  }, []);

  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];

    const decodedActive = decodeURIComponent(currentActive);
    const decodedItemHref = decodeURIComponent(href);

    return (
      decodedActive === decodedItemHref ||
      (decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  return (
    <>
      {isOpen && (
        <button
          type='button'
          aria-label='\u5173\u95ed\u83dc\u5355'
          onClick={onClose}
          className='md:hidden fixed inset-0 z-[690] bg-black/30'
        />
      )}

      <nav
        className={`md:hidden fixed top-0 left-0 z-[700] h-full w-56 bg-white/95 backdrop-blur-xl border-r border-gray-200/60 shadow-2xl transition-transform duration-300 ease-out dark:bg-gray-900/90 dark:border-gray-700/60 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 3.5rem)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <ul className='flex flex-col gap-1 px-3 py-4'>
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5'
                  }`}
                >
                  <item.icon
                    className={`h-5 w-5 ${
                      active
                        ? 'text-blue-600 dark:text-blue-300'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
};

export default MobileBottomNav;
