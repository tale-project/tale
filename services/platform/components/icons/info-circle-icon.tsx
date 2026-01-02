export const InfoCircleIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 16 16"
    aria-label="Info icon"
  >
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
    <path
      d="M8 6v3m0 2h.01"
      stroke="currentColor"
      strokeLinecap="round"
    />
  </svg>
);
