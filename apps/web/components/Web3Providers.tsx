'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { WagmiProvider, createConfig } from '@privy-io/wagmi'
import { http } from 'viem'
import { chain } from '@/lib/chain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

const wagmiConfig = createConfig({
  chains: [chain],
  transports: {
    [chain.id]: http(),
  },
  connectors: [],
})

export default function Web3Providers({
  children,
}: {
  children: React.ReactNode
}) {
  const [queryClient] = useState(() => new QueryClient())
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()

  if (!privyAppId || privyAppId.length !== 25) {
    return (
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    )
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ['google', 'email'],
        defaultChain: chain,
        supportedChains: [chain],
        embeddedWallets: {
          showWalletUIs: false,
          ethereum: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider
          config={wagmiConfig}
          setActiveWalletForWagmi={({ wallets }) =>
            wallets.find((wallet) => wallet.walletClientType === 'privy')
          }
        >
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
