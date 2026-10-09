import {
  FileSearch,
  FileText,
  GitBranch,
  Megaphone,
  Workflow,
} from 'lucide-react';

/** Different deliverables enter the same brief, handoff, and review process. */
export function UseCaseHubIllustration() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-xl">
      <svg viewBox="0 0 600 400" fill="none" className="h-auto w-full">
        <ellipse
          cx="310"
          cy="209"
          rx="237"
          ry="159"
          className="fill-demo-gold-soft/50"
        />
        <path
          d="M135 101h152v69m187-69H322v69M135 289h152v-69m187 69H322v-69"
          className="stroke-fg-base/20"
          strokeWidth="2"
          strokeDasharray="4 5"
        />
        {[
          {
            x: 58,
            y: 47,
            Icon: Megaphone,
            color: 'text-demo-coral',
            soft: 'fill-demo-coral-soft',
          },
          {
            x: 386,
            y: 47,
            Icon: GitBranch,
            color: 'text-demo-violet',
            soft: 'fill-demo-violet-soft',
          },
          {
            x: 58,
            y: 260,
            Icon: FileSearch,
            color: 'text-demo-sky',
            soft: 'fill-demo-sky-soft',
          },
          {
            x: 386,
            y: 260,
            Icon: FileText,
            color: 'text-demo-gold',
            soft: 'fill-demo-gold-soft',
          },
        ].map(({ x, y, Icon, color, soft }) => (
          <g key={x + y}>
            <rect
              x={x + 3}
              y={y + 5}
              width="157"
              height="95"
              rx="13"
              className="fill-fg-base/5"
            />
            <rect
              x={x}
              y={y}
              width="157"
              height="95"
              rx="13"
              className="fill-surface-site-raised stroke-border-base"
            />
            <rect
              x={x + 16}
              y={y + 16}
              width="33"
              height="33"
              rx="8"
              className={soft}
            />
            <Icon
              x={x + 24}
              y={y + 24}
              width="17"
              height="17"
              className={color}
              strokeWidth="1.6"
            />
            <path
              d={`M${x + 61} ${y + 26}h73m-73 13h53M${x + 18} ${y + 66}h118m-118 13h79`}
              className="stroke-fg-base/20"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </g>
        ))}
        <rect
          x="196"
          y="155"
          width="210"
          height="89"
          rx="15"
          className="fill-surface-site-raised stroke-border-base"
        />
        <Workflow
          x="218"
          y="181"
          width="34"
          height="34"
          className="text-demo-mint"
          strokeWidth="1.4"
        />
        <path
          d="M271 177h108m-108 14h75"
          className="stroke-fg-base/25"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {[275, 318, 361].map((x) => (
          <rect
            key={x}
            x={x}
            y="208"
            width="29"
            height="16"
            rx="4"
            className="fill-demo-mint-soft stroke-demo-mint/30"
          />
        ))}
        <path
          d="M304 216h14m29 0h14"
          className="stroke-demo-mint/40"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}
