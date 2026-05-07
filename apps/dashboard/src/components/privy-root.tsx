'use client';

import { PrivyProvider } from '@privy-io/react-auth';

export function PrivyRoot({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <main className="missing-config">
        <h1>Privy app id missing</h1>
        <p>Set NEXT_PUBLIC_PRIVY_APP_ID before starting the dashboard.</p>
      </main>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email'],
        appearance: {
          theme: 'light',
          accentColor: '#14532d',
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
