import { useSkipEntrance } from '@tale/marketing-ui/entrance';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  Check,
  Code2,
  FileText,
  GitBranch,
  Image,
  ListChecks,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';

const USE_CASE_ART = {
  'marketing-campaigns': CampaignArt,
  'software-development': SoftwareArt,
  research: ResearchArt,
  'document-work': DocumentArt,
  operations: OperationsArt,
} as const;

type IllustrationSlug = keyof typeof USE_CASE_ART;

/** Editorial artwork, not a product screenshot. The adjacent prose carries its meaning. */
export function UseCaseIllustration({ slug }: { slug: string }) {
  if (!Object.hasOwn(USE_CASE_ART, slug)) return null;
  const Art = USE_CASE_ART[slug as IllustrationSlug];
  return (
    <div
      aria-hidden="true"
      className="bg-surface-site-inset/50 border-border-base/60 relative isolate w-full overflow-hidden rounded-3xl border"
    >
      <svg viewBox="0 0 600 420" fill="none" className="h-auto w-full">
        <Art />
      </svg>
    </div>
  );
}

function Paper({
  x,
  y,
  width,
  height,
  children,
  delay = 0,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  children?: ReactNode;
  delay?: number;
}) {
  const skipEntrance = useSkipEntrance();
  return (
    <motion.g
      initial={skipEntrance ? false : { opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{
        duration: skipEntrance ? 0 : 0.6,
        delay: skipEntrance ? 0 : delay,
      }}
    >
      <rect
        x={x + 3}
        y={y + 7}
        width={width}
        height={height}
        rx="16"
        className="fill-fg-base/5"
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="16"
        className="fill-surface-site-raised stroke-border-base"
      />
      {children}
    </motion.g>
  );
}

function Lines({
  x,
  y,
  width = 100,
  count = 3,
}: {
  x: number;
  y: number;
  width?: number;
  count?: number;
}) {
  return (
    <g className="stroke-fg-base/15" strokeWidth="5" strokeLinecap="round">
      {Array.from({ length: count }, (_, index) => (
        <path
          key={index}
          d={`M${x} ${y + index * 15}h${index === count - 1 ? width * 0.65 : width}`}
        />
      ))}
    </g>
  );
}

function Stamp({
  x,
  y,
  color = 'text-demo-mint',
}: {
  x: number;
  y: number;
  color?: string;
}) {
  return (
    <g className={color}>
      <circle cx={x} cy={y} r="17" fill="currentColor" />
      <Check
        x={x - 9}
        y={y - 9}
        width="18"
        height="18"
        className="text-surface-site-raised"
        strokeWidth="2.5"
      />
    </g>
  );
}

function CampaignArt() {
  return (
    <>
      <circle cx="400" cy="205" r="166" className="fill-demo-coral-soft" />
      <path
        d="M61 316C170 346 150 80 510 114"
        className="stroke-demo-coral/30"
        strokeWidth="2"
        strokeDasharray="5 7"
      />
      <Paper x={70} y={63} width={276} height={275}>
        <circle cx="93" cy="85" r="4" className="fill-demo-coral" />
        <Lines x={109} y={85} width={82} count={1} />
        <rect
          x="88"
          y="108"
          width="240"
          height="153"
          rx="9"
          className="fill-demo-coral-soft"
        />
        <circle cx="257" cy="146" r="25" className="fill-demo-gold" />
        <path d="m88 237 74-96 85 120H88Z" className="fill-demo-coral" />
        <path d="m190 261 82-82 56 53v29Z" className="fill-demo-violet/70" />
        <Lines x={92} y={281} width={185} count={2} />
        <Image
          x="297"
          y="278"
          width="17"
          height="17"
          className="text-demo-coral"
        />
      </Paper>
      <Paper x={369} y={100} width={160} height={101} delay={0.12}>
        <Send
          x="388"
          y="120"
          width="21"
          height="21"
          className="text-demo-coral"
        />
        <Lines x={421} y={130} width={85} count={1} />
        <Lines x={390} y={160} width={111} count={2} />
      </Paper>
      <Paper x={311} y={242} width={213} height={113} delay={0.24}>
        <rect
          x="330"
          y="263"
          width="37"
          height="37"
          rx="8"
          className="fill-demo-violet-soft"
        />
        <MessageSquare
          x="340"
          y="273"
          width="18"
          height="18"
          className="text-demo-violet"
        />
        <Lines x={381} y={270} width={106} count={2} />
        <Lines x={333} y={326} width={134} count={1} />
        <Stamp x={503} y={330} />
      </Paper>
    </>
  );
}

function SoftwareArt() {
  return (
    <>
      <rect
        x="49"
        y="52"
        width="483"
        height="318"
        rx="72"
        className="fill-demo-violet-soft"
      />
      <Paper x={78} y={78} width={314} height={257}>
        <Code2
          x="100"
          y="98"
          width="23"
          height="23"
          className="text-demo-violet"
        />
        <Lines x={139} y={110} width={140} count={1} />
        <path d="M95 137h280" className="stroke-border-base" />
        {[0, 1, 2, 3, 4, 5].map((line) => (
          <g key={line}>
            <path
              d={`M105 ${160 + line * 23}h8`}
              className="stroke-fg-base/20"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d={`M${133 + (line % 3) * 14} ${160 + line * 23}h${[112, 148, 91][line % 3]}`}
              className={
                line % 2 ? 'stroke-demo-violet/65' : 'stroke-demo-sky/65'
              }
              strokeWidth="6"
              strokeLinecap="round"
            />
          </g>
        ))}
      </Paper>
      <Paper x={350} y={126} width={169} height={103} delay={0.15}>
        <GitBranch
          x="368"
          y="146"
          width="22"
          height="22"
          className="text-demo-violet"
        />
        <Lines x={404} y={156} width={88} count={1} />
        <path
          d="M378 193h115"
          className="stroke-demo-violet/35"
          strokeWidth="2"
        />
        {[378, 431, 491].map((x) => (
          <circle key={x} cx={x} cy="193" r="5" className="fill-demo-violet" />
        ))}
      </Paper>
      <Paper x={326} y={263} width={204} height={92} delay={0.3}>
        <ShieldCheck
          x="345"
          y="284"
          width="24"
          height="24"
          className="text-demo-mint"
        />
        <Lines x={383} y={295} width={115} count={1} />
        {[350, 385, 420, 455, 490].map((x) => (
          <Check
            key={x}
            x={x}
            y="320"
            width="16"
            height="16"
            className="text-demo-mint"
          />
        ))}
      </Paper>
    </>
  );
}

function ResearchArt() {
  return (
    <>
      <circle cx="303" cy="208" r="161" className="fill-demo-sky-soft" />
      <circle
        cx="303"
        cy="208"
        r="135"
        className="stroke-demo-sky/25"
        strokeDasharray="4 8"
      />
      <path
        d="m147 109 152 95 160-103M299 204 125 313m174-109 163 117"
        className="stroke-demo-sky/40"
        strokeWidth="2"
      />
      <Paper x={49} y={65} width={157} height={111}>
        <FileText
          x="67"
          y="84"
          width="23"
          height="23"
          className="text-demo-sky"
        />
        <Lines x={69} y={124} width={111} count={2} />
      </Paper>
      <Paper x={389} y={50} width={154} height={122} delay={0.1}>
        <Lines x={409} y={77} width={111} count={2} />
        <rect
          x="409"
          y="116"
          width="28"
          height="30"
          rx="4"
          className="fill-demo-gold-soft"
        />
        <rect
          x="445"
          y="100"
          width="28"
          height="46"
          rx="4"
          className="fill-demo-sky-soft"
        />
        <rect
          x="481"
          y="90"
          width="28"
          height="56"
          rx="4"
          className="fill-demo-sky"
        />
      </Paper>
      <Paper x={56} y={266} width={167} height={91} delay={0.2}>
        <Lines x={76} y={291} width={121} count={3} />
      </Paper>
      <Paper x={380} y={273} width={165} height={93} delay={0.3}>
        <Lines x={400} y={298} width={119} count={2} />
        <Stamp x={513} y={341} />
      </Paper>
      <circle
        cx="299"
        cy="206"
        r="62"
        className="fill-surface-site-raised stroke-demo-sky/40"
        strokeWidth="2"
      />
      <Search
        x="268"
        y="175"
        width="62"
        height="62"
        className="text-demo-sky"
        strokeWidth="1.4"
      />
    </>
  );
}

function DocumentArt() {
  return (
    <>
      <path
        d="M89 313C21 186 124 61 275 51c172-10 293 150 237 241-52 85-274 125-423 21Z"
        className="fill-demo-gold-soft"
      />
      <g transform="rotate(-8 271 218)">
        <Paper x={139} y={67} width={251} height={288} />
      </g>
      <Paper x={163} y={58} width={252} height={291} delay={0.1}>
        <FileText
          x="187"
          y="80"
          width="28"
          height="28"
          className="text-demo-gold"
        />
        <Lines x={188} y={132} width={175} count={2} />
        <rect
          x="186"
          y="176"
          width="190"
          height="13"
          rx="3"
          className="fill-demo-gold-soft"
        />
        <Lines x={190} y={181} width={173} count={4} />
        <path
          d="M190 279q15-40 21-11t26-3q5 31 33 7t40 3"
          className="stroke-demo-violet"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path d="M190 298h125" className="stroke-border-base" />
        <Stamp x={367} y={300} />
      </Paper>
      <Paper x={363} y={131} width={173} height={101} delay={0.25}>
        <MessageSquare
          x="381"
          y="150"
          width="20"
          height="20"
          className="text-demo-coral"
        />
        <Lines x={413} y={158} width={98} count={1} />
        <Lines x={384} y={192} width={124} count={2} />
      </Paper>
      <circle cx="117" cy="296" r="27" className="fill-demo-violet-soft" />
      <ArrowUpRight
        x="104"
        y="283"
        width="26"
        height="26"
        className="text-demo-violet"
      />
    </>
  );
}

function OperationsArt() {
  return (
    <>
      <rect
        x="67"
        y="47"
        width="462"
        height="326"
        rx="90"
        className="fill-demo-mint-soft"
      />
      <path
        d="M180 124h92v85h72m-72 0v101h80"
        className="stroke-demo-mint/45"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <Paper x={58} y={73} width={161} height={102}>
        <ListChecks
          x="78"
          y="94"
          width="24"
          height="24"
          className="text-demo-mint"
        />
        <Lines x={115} y={106} width={81} count={1} />
        <Lines x={80} y={140} width={111} count={1} />
      </Paper>
      {[
        { y: 62, tone: 'text-demo-coral', soft: 'fill-demo-coral-soft' },
        { y: 169, tone: 'text-demo-gold', soft: 'fill-demo-gold-soft' },
        { y: 276, tone: 'text-demo-mint', soft: 'fill-demo-mint-soft' },
      ].map(({ y, tone, soft }, index) => (
        <Paper
          key={y}
          x={335}
          y={y}
          width={204}
          height={87}
          delay={0.12 * (index + 1)}
        >
          <rect
            x="353"
            y={y + 20}
            width="38"
            height="38"
            rx="10"
            className={soft}
          />
          <Check x="363" y={y + 30} width="18" height="18" className={tone} />
          <Lines x={407} y={y + 31} width={102} count={2} />
        </Paper>
      ))}
      <Paper x={74} y={253} width={151} height={97} delay={0.4}>
        <path
          d="m94 317 20-19 18 7 21-28 20 6 30-16"
          className="stroke-demo-mint"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M94 329h111" className="stroke-border-base" />
      </Paper>
    </>
  );
}
