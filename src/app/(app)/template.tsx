// Re-mounts on every navigation inside the app shell, giving each view change the same brief,
// orientation-preserving entrance. Disabled automatically under prefers-reduced-motion.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="motion-enter">{children}</div>;
}
