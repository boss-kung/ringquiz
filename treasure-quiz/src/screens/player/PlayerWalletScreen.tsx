import { useEffect, useState } from 'react';
import type { PlayerActionCaller } from '../../domain/types';
import { baht } from './PlayerChestOpeningScreen';

interface PlayerWalletScreenProps { action: PlayerActionCaller; }

export default function PlayerWalletScreen({ action }: PlayerWalletScreenProps) {
  const [wallet, setWallet] = useState<{ balanceSatang: number; entries: Array<{ amount_satang: number; reason?: string | null }> } | null>(null);
  useEffect(() => { void action<{ wallet: typeof wallet }>('get_wallet').then((response) => setWallet(response.wallet)); }, [action]);
  return <main className="player-screen wallet-screen"><p className="eyebrow">PERSISTENT WALLET</p><h1>เงินรางวัลสะสม</h1><div className="wallet-total"><span>ยอดคงเหลือ</span><strong>{baht(wallet?.balanceSatang ?? 0)}</strong></div><div className="wallet-entries">{wallet?.entries?.length ? wallet.entries.map((entry, index) => <div className="wallet-row" key={`${entry.amount_satang}-${index}`}><span>{entry.reason ?? 'รางวัลจากหีบ'}</span><strong>+{baht(entry.amount_satang)}</strong></div>) : <p className="muted">ยังไม่มีรายการเงินรางวัล</p>}</div></main>;
}
