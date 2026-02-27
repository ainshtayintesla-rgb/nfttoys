import { NextRequest } from 'next/server';

import { proxyToBackend } from '../../_utils/proxy';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ tokenId: string }> },
) {
    const { tokenId } = await params;
    return proxyToBackend(request, `/nft/${encodeURIComponent(tokenId)}`);
}
