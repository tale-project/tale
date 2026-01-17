export const WebsiteIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 16 16"
    aria-label="Website icon"
  >
    <path
      d="M2 4.5C2 3.67157 2.67157 3 3.5 3H12.5C13.3284 3 14 3.67157 14 4.5V11.5C14 12.3284 13.3284 13 12.5 13H3.5C2.67157 13 2 12.3284 2 11.5V4.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path d="M2 6.5H14" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="4.5" cy="4.75" r="0.5" fill="currentColor" />
    <circle cx="6" cy="4.75" r="0.5" fill="currentColor" />
  </svg>
);
