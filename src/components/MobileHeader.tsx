'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

import { BackButton } from './BackButton';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
  isMenuOpen?: boolean;
  onMenuToggle?: () => void;
}

const MobileHeader = ({
  showBackButton = false,
  isMenuOpen = false,
  onMenuToggle,
}: MobileHeaderProps) => {
  return (
    <header className='md:hidden relative w-full bg-white/70 backdrop-blur-xl border-b border-gray-200/50 shadow-sm dark:bg-gray-900/70 dark:border-gray-700/50'>
      <div className='h-12 flex items-center justify-between px-4'>
        <div className='flex items-center gap-2'>
          {onMenuToggle && (
            <button
              type='button'
              aria-label={isMenuOpen ? '\u5173\u95ed\u83dc\u5355' : '\u6253\u5f00\u83dc\u5355'}
              onClick={onMenuToggle}
              className='p-2 -ml-2 text-gray-600 hover:text-gray-900 transition-colors dark:text-gray-300 dark:hover:text-white'
            >
              {isMenuOpen ? (
                <X className='h-5 w-5' />
              ) : (
                <Menu className='h-5 w-5' />
              )}
            </button>
          )}
          {showBackButton && <BackButton />}
        </div>

        <div className='flex items-center gap-2'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>

      <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
        <Link href='/' className='block hover:opacity-90 transition-opacity'>
          <Image src='/logo.png' alt='logo' width={28} height={28} priority />
        </Link>
      </div>
    </header>
  );
};

export default MobileHeader;
