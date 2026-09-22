export default function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return <span className={`badge badge-difficulty-${difficulty}`}>{difficulty}</span>;
}
