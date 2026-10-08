interface PlayerRoundResultScreenProps { roundNo: number; gold: number; gems: number; onContinue?: () => void; }

export default function PlayerRoundResultScreen({ roundNo, gold, gems, onContinue }: PlayerRoundResultScreenProps) {
  return <main className="player-screen result-screen"><p className="eyebrow">ROUND {roundNo} · RESULT</p><h1>เก็บรางวัลรอบนี้แล้ว</h1><div className="result-total"><strong>🪙 {gold.toLocaleString()}</strong><strong>💎 {gems.toLocaleString()}</strong></div><button className="primary-button" onClick={onContinue}>ไปต่อ</button></main>;
}
