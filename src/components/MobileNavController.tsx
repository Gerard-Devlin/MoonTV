'use client';

import { useCallback, useState } from 'react';

import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';

interface MobileNavControllerProps {
  activePath?: string;
  showBackButton?: boolean;
  useHeroHeaderStyle?: boolean;
}

const MobileNavController = ({
  activePath,
  showBackButton = false,
  useHeroHeaderStyle = false,
}: MobileNavControllerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);
  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <>
      <MobileHeader
        showBackButton={showBackButton}
        isMenuOpen={isOpen}
        onMenuToggle={handleToggle}
        isHomePage={activePath === '/' || useHeroHeaderStyle}
      />
      <MobileBottomNav
        activePath={activePath}
        isOpen={isOpen}
        onClose={handleClose}
      />
    </>
  );
};

export default MobileNavController;
