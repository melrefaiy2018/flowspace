import { useId } from 'react';

interface Props {
  size?: number;
  className?: string;
}

/**
 * FlowSpace icon mark — stylized green "F" with gradient strokes and a dot.
 */
export default function FlowSpaceLogo({ size = 48, className }: Props) {
  const id = useId().replace(/:/g, '');
  const gTop = `fs-top-${id}`;
  const gMid = `fs-mid-${id}`;
  const gBot = `fs-bot-${id}`;
  const gDot = `fs-dot-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id={gTop} x1="10" y1="22" x2="90" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#a3e635" />
        </linearGradient>
        <linearGradient id={gMid} x1="10" y1="50" x2="78" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
        <linearGradient id={gBot} x1="10" y1="78" x2="60" y2="78" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
        <linearGradient id={gDot} x1="79" y1="43" x2="91" y2="57" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
      </defs>

      {/* Top bar — longest */}
      <path
        d="M22 10 L78 10 Q90 10 90 22 Q90 34 78 34 L22 34 Q10 34 10 22 Q10 10 22 10 Z"
        fill={`url(#${gTop})`}
      />

      {/* Middle bar — medium */}
      <path
        d="M22 42 L66 42 Q78 42 78 50 Q78 58 66 58 L22 58 Q10 58 10 50 Q10 42 22 42 Z"
        fill={`url(#${gMid})`}
      />

      {/* Dot beside middle bar */}
      <circle cx="85" cy="50" r="7" fill={`url(#${gDot})`} />

      {/* Bottom bar — shortest */}
      <path
        d="M22 66 L50 66 Q62 66 62 74 Q62 82 50 82 L22 82 Q10 82 10 74 Q10 66 22 66 Z"
        fill={`url(#${gBot})`}
      />
    </svg>
  );
}
