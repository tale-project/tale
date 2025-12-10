import { NextRequest, NextResponse } from 'next/server';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, organizationId, pageSize = 10 } = body;

    if (!query || !organizationId) {
      return NextResponse.json(
        { error: 'Query and organizationId are required' },
        { status: 400 },
      );
    }

    const result = await fetchQuery(api.products.getProducts, {
      organizationId: organizationId as string,
      searchQuery: query,
      pageSize,
      currentPage: 1,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error searching products:', error);
    return NextResponse.json(
      { error: 'Failed to search products' },
      { status: 500 },
    );
  }
}
