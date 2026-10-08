interface ResourceBarProps { gold: number; gems: number; }

export default function ResourceBar({ gold, gems }: ResourceBarProps) {
  return <div className="resource-bar" aria-label="ทรัพยากรของ Player"><span>🪙 {gold.toLocaleString()} ทอง</span><span>💎 {gems.toLocaleString()} เพชร</span></div>;
}
