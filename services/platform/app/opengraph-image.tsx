import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'Tale - AI that automates your workflows';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
          backgroundImage: 'radial-gradient(circle at 25% 25%, #1a1a1a 0%, #000000 50%)',
        }}
      >
        {/* Logo */}
        <svg
          width="120"
          height="120"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="#ffffff"
            d="M5.53 14.987A5 5 0 0 0 7.1 18.63l.008.007a5.01 5.01 0 0 0 6.293.47l4.934-3.81A4.29 4.29 0 0 0 20 11.902v-4.6l-7.594 5.865a3.988 3.988 0 0 1-5.85-1.225 5 5 0 0 0-1.027 3.044m8.943-9.976a4.98 4.98 0 0 0-1.57-3.643h-.008A5.01 5.01 0 0 0 6.603.89L1.666 4.7A4.29 4.29 0 0 0-.001 8.095v4.6L7.596 6.83a3.987 3.987 0 0 1 5.85 1.225 5 5 0 0 0 1.026-3.044"
          />
        </svg>

        {/* Title */}
        <div
          style={{
            display: 'flex',
            fontSize: 72,
            fontWeight: 700,
            color: '#ffffff',
            marginTop: 40,
            letterSpacing: '-0.02em',
          }}
        >
          Tale
        </div>

        {/* Tagline */}
        <div
          style={{
            display: 'flex',
            fontSize: 32,
            color: '#a1a1aa',
            marginTop: 20,
          }}
        >
          AI that automates your workflows
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
