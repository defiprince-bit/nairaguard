export function Skeleton({
  width = '100%',
  height = 16,
  radius = 8,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, var(--border) 25%, #f0f2ef 50%, var(--border) 75%)',
        backgroundSize: '200% 100%',
        animation: 'ng-skel 1.2s ease-in-out infinite',
      }}
    />
  );
}
