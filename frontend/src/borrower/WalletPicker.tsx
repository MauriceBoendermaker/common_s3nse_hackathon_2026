/**
 * One button per injected Ethereum wallet. BORROWER-ONLY.
 *
 * Exists because Phantom and MetaMask both inject an EVM provider, and the
 * viewing key is derived from a signature: signing with the wrong wallet
 * yields a key that cannot recover payouts made to the one ENS publishes.
 * The user picks; the app never guesses when there is more than one.
 */

import { Wallet } from "lucide-react";

import { Button, Spinner } from "../components/ui";
import { listEthereumWallets } from "../shared/wallets";
import { useEnsIdentity } from "./ensIdentity";

export function WalletPicker({ label = "Connect" }: { label?: string }) {
  const ens = useEnsIdentity();
  const wallets = listEthereumWallets();
  const busy = ens.walletStatus === "connecting" || ens.walletStatus === "signing";

  if (wallets.length === 0) {
    return (
      <Button type="button" disabled={busy} icon={<Wallet size={16} />} onClick={() => void ens.connectWallet()}>
        Connect Ethereum wallet
      </Button>
    );
  }

  return (
    <>
      {wallets.map((wallet, index) => (
        <Button
          key={wallet.id}
          type="button"
          variant={index === 0 ? "primary" : "secondary"}
          disabled={busy}
          icon={busy ? <Spinner /> : <Wallet size={16} />}
          onClick={() => void ens.connectWallet(wallet.id)}
        >
          {ens.walletStatus === "signing"
            ? "Sign in your wallet"
            : `${label} ${wallet.name}`}
        </Button>
      ))}
    </>
  );
}
