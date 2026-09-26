/** Page wrapper. Previously faded pages in; pages now render immediately (no entrance animation). */
export default function PageMotion({ className, children }) {
  return <div className={className}>{children}</div>;
}
