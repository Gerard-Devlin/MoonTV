'use client';

import { AlertCircle, CheckCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Turnstile from 'react-turnstile';

import { checkForUpdates, CURRENT_VERSION, UpdateStatus } from '@/lib/version';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AuroraBackground } from '@/components/ui/shadcn-io/aurora-background';

type RuntimeConfig = {
  STORAGE_TYPE?: string;
  ENABLE_REGISTER?: boolean;
};

function VersionDisplay() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (error) {
        // ignore fetch errors
      } finally {
        setIsChecking(false);
      }
    };

    checkUpdate();
  }, []);

  return (
    <button
      onClick={() =>
        window.open('https://github.com/senshinya/MoonTV', '_blank')
      }
      className='absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
    >
      <span className='font-mono'>v{CURRENT_VERSION}</span>
      {!isChecking && updateStatus !== UpdateStatus.FETCH_FAILED && (
        <div
          className={`flex items-center gap-1.5 ${
            updateStatus === UpdateStatus.HAS_UPDATE
              ? 'text-yellow-600 dark:text-yellow-400'
              : updateStatus === UpdateStatus.NO_UPDATE
              ? 'text-blue-600 dark:text-blue-400'
              : ''
          }`}
        >
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <>
              <AlertCircle className='h-3.5 w-3.5' />
              <span className='text-xs font-semibold'>有新版本</span>
            </>
          )}
          {updateStatus === UpdateStatus.NO_UPDATE && (
            <>
              <CheckCircle className='h-3.5 w-3.5' />
              <span className='text-xs font-semibold'>已是最新</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [enableRegister, setEnableRegister] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
  const isTurnstileEnabled = Boolean(turnstileSiteKey);
  const { siteName } = useSite();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const runtimeConfig = (
        window as typeof window & {
          RUNTIME_CONFIG?: RuntimeConfig;
        }
      ).RUNTIME_CONFIG;
      const storageType = runtimeConfig?.STORAGE_TYPE;
      setShouldAskUsername(
        storageType !== undefined && storageType !== 'localstorage'
      );
      setEnableRegister(Boolean(runtimeConfig?.ENABLE_REGISTER));
    }
  }, []);

  const resetTurnstile = useCallback(() => {
    if (!isTurnstileEnabled) return;
    setTurnstileToken(null);
    setTurnstileKey((prev) => prev + 1);
  }, [isTurnstileEnabled]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;
    if (isTurnstileEnabled && !turnstileToken) {
      setError('请完成人机验证');
      return;
    }

    try {
      setLoading(true);
      const payload: Record<string, unknown> = {
        password,
        ...(shouldAskUsername ? { username } : {}),
      };
      if (isTurnstileEnabled) {
        payload.turnstileToken = turnstileToken;
      }

      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else if (res.status === 401) {
        setError('密码错误');
        resetTurnstile();
      } else {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? '服务器错误');
        resetTurnstile();
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError(null);
    if (!password || !username) return;
    if (isTurnstileEnabled && !turnstileToken) {
      setError('请完成人机验证');
      return;
    }

    try {
      setLoading(true);
      const payload: Record<string, unknown> = {
        username,
        password,
      };
      if (isTurnstileEnabled) {
        payload.turnstileToken = turnstileToken;
      }

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? '服务器错误');
        resetTurnstile();
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuroraBackground className='overflow-hidden px-4'>
      <div className='absolute right-4 top-4'>
        <ThemeToggle />
      </div>
      <div className='relative z-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 p-10 shadow-2xl backdrop-blur-xl dark:border dark:border-zinc-800 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40'>
        <img
          src='/logo.png'
          alt={siteName}
          className='mx-auto mb-8 h-16 w-auto drop-shadow-sm'
        />
        <form onSubmit={handleSubmit} className='space-y-8'>
          {shouldAskUsername && (
            <div>
              <label htmlFor='username' className='sr-only'>
                用户名
              </label>
              <input
                id='username'
                type='text'
                autoComplete='username'
                className='block w-full rounded-lg border-0 bg-white/60 py-3 px-4 text-gray-900 shadow-sm ring-1 ring-white/60 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-800/60 dark:text-gray-100 dark:placeholder:text-gray-400 dark:ring-white/20'
                placeholder='输入用户名'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor='password' className='sr-only'>
              密码
            </label>
            <input
              id='password'
              type='password'
              autoComplete='current-password'
              className='block w-full rounded-lg border-0 bg-white/60 py-3 px-4 text-gray-900 shadow-sm ring-1 ring-white/60 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-800/60 dark:text-gray-100 dark:placeholder:text-gray-400 dark:ring-white/20'
              placeholder='输入访问密码'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {isTurnstileEnabled && (
            <div className='flex justify-center'>
              <Turnstile
                key={turnstileKey}
                sitekey={turnstileSiteKey}
                theme='auto'
                onVerify={(token) => {
                  setTurnstileToken(token);
                  setError(null);
                }}
                onExpire={() => resetTurnstile()}
                onError={() => resetTurnstile()}
              />
            </div>
          )}

          {error && (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          )}

          {shouldAskUsername && enableRegister ? (
            <div className='flex gap-4'>
              <button
                type='button'
                onClick={handleRegister}
                disabled={
                  !password ||
                  !username ||
                  loading ||
                  (isTurnstileEnabled && !turnstileToken)
                }
                className='flex-1 inline-flex justify-center rounded-lg bg-blue-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {loading ? '注册中...' : '注册'}
              </button>
              <button
                type='submit'
                disabled={
                  !password ||
                  loading ||
                  (shouldAskUsername && !username) ||
                  (isTurnstileEnabled && !turnstileToken)
                }
                className='flex-1 inline-flex justify-center rounded-lg bg-blue-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {loading ? '登录中...' : '登录'}
              </button>
            </div>
          ) : (
            <button
              type='submit'
              disabled={
                !password ||
                loading ||
                (shouldAskUsername && !username) ||
                (isTurnstileEnabled && !turnstileToken)
              }
              className='inline-flex w-full justify-center rounded-lg bg-blue-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {loading ? '登录中...' : '登录'}
            </button>
          )}
        </form>
      </div>

      <VersionDisplay />
    </AuroraBackground>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
