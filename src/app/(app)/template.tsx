// Re-mounts on every navigation inside the app shell: the new page's sections rise in with a
// short stagger. Disabled automatically under prefers-reduced-motion.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="motion-page">{children}</div>;
}
