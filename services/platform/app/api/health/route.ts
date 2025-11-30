import { NextResponse } from 'next/server';

/**
 * Health check endpoint for Docker and monitoring
 * Returns 200 OK if the service is running
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'tale-platform',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}

