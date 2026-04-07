interface Props {
  size?: number;
  className?: string;
}

/**
 * FlowSpace icon mark — three green lines of decreasing width
 * on a dark green rounded rectangle.
 */
export default function FlowSpaceLogo({ size = 48, className }: Props) {
  // The original viewBox is 48x48; we scale via width/height
  const r = (12 / 48) * size; // proportional border radius
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
    >
      <rect width="48" height="48" rx="12" fill="#0d2818" />
      <path d="M16 16H32" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" />
      <path d="M16 24H28" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" />
      <circle cx="34" cy="24" r="2" fill="#22c55e" />
      <path d="M16 32H24" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
