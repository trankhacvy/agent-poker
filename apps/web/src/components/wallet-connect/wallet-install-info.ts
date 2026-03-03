export const RECENT_WALLETS_KEY = "shadcn-solana-wallets:recent-wallets";
export const MAX_RECENT_WALLETS = 3;
export const MOBILE_BREAKPOINT = 768;

export interface WalletInstallLink {
  label: string; // "Chrome", "iOS", "Android"
  url: string;
}

export interface WalletInstallInfo {
  match: string; // substring match against connector.id
  name: string;
  installLinks: WalletInstallLink[];
  description?: string;
  gettingStartedSteps?: string[];
  website?: string;
}

export const POPULAR_WALLET_IDS = ["phantom", "backpack", "solflare"];

const BUILT_IN_INSTALL_INFO: WalletInstallInfo[] = [
  {
    match: "phantom",
    name: "Phantom",
    website: "https://phantom.com",
    description: "Your home for trading crypto, predictions, and more.",
    installLinks: [
      {
        label: "Chrome",
        url: "https://chromewebstore.google.com/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa",
      },
      {
        label: "iOS",
        url: "https://apps.apple.com/app/phantom-trade-markets/id1598432977",
      },
      {
        label: "Android",
        url: "https://play.google.com/store/apps/details?id=app.phantom",
      },
    ],
    gettingStartedSteps: [
      "Install the Phantom browser extension or mobile app.",
      "Create a new wallet or import an existing one.",
      "Come back to this page and connect your wallet.",
    ],
  },
  {
    match: "backpack",
    name: "Backpack",
    website: "https://backpack.app",
    description: "The All-in-One Crypto App.",
    installLinks: [
      {
        label: "Chrome",
        url: "https://chromewebstore.google.com/detail/backpack/aflkmfhebedbjioipglgcbcmnbpgliof",
      },
      {
        label: "iOS",
        url: "https://apps.apple.com/app/backpack-buy-sol-btc-crypto/id6445964121",
      },
      {
        label: "Android",
        url: "https://play.google.com/store/apps/details?id=app.backpack.mobile",
      },
    ],
    gettingStartedSteps: [
      "Install the Backpack browser extension or mobile app.",
      "Create a new wallet or import an existing one.",
      "Come back to this page and connect your wallet.",
    ],
  },
  {
    match: "solflare",
    name: "Solflare",
    website: "https://solflare.com",
    description: "What banking should feel like.",
    installLinks: [
      {
        label: "Chrome",
        url: "https://chromewebstore.google.com/detail/solflare-wallet/bhhhlbepdkbapadjdnnojkbgioiodbic",
      },
      {
        label: "iOS",
        url: "https://apps.apple.com/app/solflare-solana-wallet/id1580902717",
      },
      {
        label: "Android",
        url: "https://play.google.com/store/apps/details?id=com.solflare.mobile&hl=en",
      },
    ],
    gettingStartedSteps: [
      "Install the Solflare browser extension or mobile app.",
      "Create a new wallet or import an existing one.",
      "Come back to this page and connect your wallet.",
    ],
  },
];

export function getWalletInstallInfo(
  connectorId: string,
  overrides?: WalletInstallInfo[]
): WalletInstallInfo | undefined {
  const id = connectorId.toLowerCase();

  if (overrides) {
    const override = overrides.find((info) => id.includes(info.match.toLowerCase()));
    if (override) return override;
  }

  return BUILT_IN_INSTALL_INFO.find((info) => id.includes(info.match.toLowerCase()));
}
