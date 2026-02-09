import { BackButton } from './BackButton';
import BackToTop from './BackToTop';
import MobileNavController from './MobileNavController';
import Sidebar from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  disableMobileTopPadding?: boolean;
}

const PageLayout = ({
  children,
  activePath = '/',
  disableMobileTopPadding = false,
}: PageLayoutProps) => {
  const isHomePage = activePath === '/';

  return (
    <div className='w-full min-h-screen'>
      <MobileNavController
        activePath={activePath}
        showBackButton={['/play'].includes(activePath)}
        useHeroHeaderStyle={isHomePage || disableMobileTopPadding}
      />

      <div className='flex md:grid md:grid-cols-[auto_1fr] w-full min-h-screen md:min-h-auto'>
        <div className='hidden md:block'>
          <Sidebar activePath={activePath} />
        </div>

        <div className='relative min-w-0 flex-1 transition-all duration-300'>
          {['/play'].includes(activePath) && (
            <div className='absolute top-3 left-1 z-20 hidden md:flex'>
              <BackButton />
            </div>
          )}

          <div className='absolute top-2 right-4 z-20 hidden md:flex items-center gap-2'>
            <ThemeToggle />
            <UserMenu />
          </div>

          <main
            className={`flex-1 md:min-h-0 ${
              isHomePage || disableMobileTopPadding
                ? 'pt-0 md:pt-0'
                : 'pt-[calc(env(safe-area-inset-top)+4rem)] md:pt-0'
            }`}
            style={{
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            {children}
          </main>
          <BackToTop />
        </div>
      </div>
    </div>
  );
};

export default PageLayout;
